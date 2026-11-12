"""AWS 없이 실행하는 단위 테스트: python -m unittest discover -s tests"""
import datetime as dt
import json
import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import api_proxy  # noqa: E402
import collector  # noqa: E402
import common  # noqa: E402

XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>00</resultCode></header>
<body><items><item><zone>P1</zone><cnt>10</cnt></item><item><zone>P2</zone><cnt>20</cnt></item></items>
<totalCount>2</totalCount></body></response>"""


class FakeSSM:
    def __init__(self):
        self.calls = 0

    def get_parameter(self, Name, WithDecryption):
        self.calls += 1
        assert WithDecryption
        return {"Parameter": {"Value": "abc/def+=="}}


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[(Bucket, Key)] = Body


class Base(unittest.TestCase):
    def setUp(self):
        os.environ.update(SERVICE_KEY_PARAM="/olpark-time/service-key",
                          URL_REALTIME_PARKING="https://example.test/realtime",
                          URL_LINKED_DATA="", URL_PERFORMANCES="https://example.test/perf?x=1",
                          ALLOWED_ORIGIN="https://hwowoo.github.io", DATA_BUCKET="bucket")
        common._key_cache.update(value=None, at=0.0)
        api_proxy._cache.clear()
        self.urls = []

    def fetcher(self, url, timeout=10):
        self.urls.append(url)
        return XML, "text/xml"


class CommonTests(Base):
    def test_clean_params_whitelist_and_cap(self):
        out = common.clean_params({"pageNo": "2", "numOfRows": "99999", "serviceKey": "evil", "x": "1"})
        self.assertEqual(out, {"pageNo": "2", "numOfRows": str(common.MAX_ROWS)})

    def test_build_url_encodes_key_once(self):
        url = common.build_url("https://a.test/b?x=1", {"pageNo": "1"}, "abc/def+==")
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        self.assertEqual(q["serviceKey"], ["abc/def+=="])
        self.assertIn("?x=1&", url)

    def test_xml_repeated_tags_become_list(self):
        data = common.parse_body(XML, "text/xml")
        items = data["response"]["body"]["items"]["item"]
        self.assertEqual([i["zone"] for i in items], ["P1", "P2"])

    def test_json_passthrough(self):
        self.assertEqual(common.parse_body(b'{"a": 1}', "application/json"), {"a": 1})


class ApiProxyTests(Base):
    def call(self, source, qs=None, ssm=None):
        ev = {"pathParameters": {"source": source}, "queryStringParameters": qs}
        return api_proxy.handler(ev, None, ssm_client=ssm or FakeSSM(), fetcher=self.fetcher)

    def test_unknown_or_unconfigured_source_404(self):
        self.assertEqual(self.call("nope")["statusCode"], 404)
        self.assertEqual(self.call("linked")["statusCode"], 404)  # URL 미설정

    def test_proxy_adds_key_and_cors_and_hides_key(self):
        res = self.call("realtime-parking", {"numOfRows": "5", "serviceKey": "evil"})
        self.assertEqual(res["statusCode"], 200)
        self.assertEqual(res["headers"]["Access-Control-Allow-Origin"], "https://hwowoo.github.io")
        self.assertIn("serviceKey=abc%2Fdef%2B%3D%3D", self.urls[0])
        self.assertNotIn("evil", self.urls[0])
        self.assertNotIn("abc/def", res["body"])  # 응답에 키가 섞이지 않음
        self.assertEqual(json.loads(res["body"])["data"]["response"]["body"]["totalCount"], "2")

    def test_cache_avoids_second_fetch(self):
        ssm = FakeSSM()
        self.call("realtime-parking", {"pageNo": "1"}, ssm)
        self.call("realtime-parking", {"pageNo": "1"}, ssm)
        self.assertEqual(len(self.urls), 1)
        self.assertEqual(ssm.calls, 1)

    def test_upstream_failure_returns_stale_cache(self):
        self.call("realtime-parking")

        def broken(url, timeout=10):
            raise TimeoutError()
        k = next(iter(api_proxy._cache))
        api_proxy._cache[k] = (0, api_proxy._cache[k][1])  # 캐시를 만료된 상태로 만듦
        res = api_proxy.handler({"pathParameters": {"source": "realtime-parking"}}, None, ssm_client=FakeSSM(), fetcher=broken)
        self.assertEqual(res["statusCode"], 200)
        self.assertTrue(json.loads(res["body"])["stale"])

    def test_upstream_failure_without_cache_502(self):
        def broken(url, timeout=10):
            raise TimeoutError()
        res = api_proxy.handler({"pathParameters": {"source": "realtime-parking"}}, None, ssm_client=FakeSSM(), fetcher=broken)
        self.assertEqual(res["statusCode"], 502)


class CollectorTests(Base):
    def test_saves_raw_snapshot_to_s3_with_kst_path(self):
        s3 = FakeS3()
        now = dt.datetime(2026, 11, 20, 18, 30, 0, tzinfo=collector.KST)
        out = collector.handler({"sources": ["realtime-parking", "linked"]}, None,
                                ssm_client=FakeSSM(), s3_client=s3, fetcher=self.fetcher, now=now)
        ok = [r for r in out["results"] if r["ok"]]
        self.assertEqual(ok[0]["key"], "raw/realtime-parking/2026/11/20/183000.json")
        self.assertFalse(out["results"][1]["ok"])  # linked URL 미설정은 건너뜀
        body = json.loads(s3.objects[("bucket", ok[0]["key"])])
        self.assertEqual(body["data"]["response"]["header"]["resultCode"], "00")

    def test_all_failed_raises_for_alarm(self):
        def broken(url, timeout=10):
            raise ConnectionError()
        with self.assertRaises(RuntimeError):
            collector.handler({"sources": ["realtime-parking"]}, None, ssm_client=FakeSSM(),
                              s3_client=FakeS3(), fetcher=broken)


if __name__ == "__main__":
    unittest.main()
