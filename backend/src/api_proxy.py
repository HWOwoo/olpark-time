"""API 중계 Lambda: GET /api/{source}?pageNo=1&numOfRows=100

- 브라우저에 인증키를 노출하지 않도록 서버에서 serviceKey를 붙여 공공데이터포털을 호출합니다.
- 허용된 데이터 소스와 쿼리 파라미터만 통과시킵니다.
- 같은 요청은 60초 동안 메모리에 캐시해 포털 호출 횟수(일일 트래픽 한도)를 아낍니다.
"""
import os
import time

import common

_cache = {}
CACHE_SEC = int(os.environ.get("CACHE_SECONDS", "60"))


def handler(event, context, ssm_client=None, fetcher=None):
    origin = os.environ.get("ALLOWED_ORIGIN", "*")
    source = (event.get("pathParameters") or {}).get("source", "")
    base = common.endpoint_for(source)
    if base is None:
        return common.response(404, {"error": f"알 수 없거나 아직 설정되지 않은 데이터 소스: {source}",
                                     "available": sorted(common.SOURCES)}, origin)

    params = common.clean_params(event.get("queryStringParameters"))
    cache_key = (source, tuple(sorted(params.items())))
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_SEC:
        return common.response(200, hit[1], origin, CACHE_SEC)

    try:
        key = common.get_service_key(ssm_client)
        body, ctype = (fetcher or common.fetch)(common.build_url(base, params, key))
        data = common.parse_body(body, ctype)
    except Exception as e:  # 포털 장애·형식 오류 시 마지막 캐시라도 돌려줌
        if hit:
            payload = dict(hit[1], stale=True)
            return common.response(200, payload, origin, 10)
        return common.response(502, {"error": "공공데이터포털 호출 실패", "detail": type(e).__name__}, origin)

    payload = {"source": source, "fetchedAt": int(time.time()), "data": data}
    _cache[cache_key] = (time.time(), payload)
    return common.response(200, payload, origin, CACHE_SEC)
