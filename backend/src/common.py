"""올팍타임 서버리스 백엔드 공통 모듈.

공공데이터포털(data.go.kr) 인증키는 코드나 프론트엔드에 넣지 않고
AWS SSM Parameter Store(SecureString)에 보관한 뒤 실행 시 읽어 옵니다.
"""
import json
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# 프론트엔드에서 호출할 수 있는 데이터 소스 이름 → 환경변수(엔드포인트 URL) 매핑.
# 실제 엔드포인트 주소는 data.go.kr 활용신청 후 상세 명세를 보고 배포 파라미터로 넣습니다.
SOURCES = {
    "realtime-parking": "URL_REALTIME_PARKING",   # 실시간 주차현황
    "linked": "URL_LINKED_DATA",                   # 차량입출차·공연·날씨 연계 데이터
    "performances": "URL_PERFORMANCES",            # 올림픽공원 공연정보
}

# 프론트엔드가 넘길 수 있는 쿼리 파라미터 화이트리스트(그 외 값은 버림)
ALLOWED_PARAMS = {"pageNo", "numOfRows", "type", "resultType", "startDate", "endDate", "date", "baseDate"}
MAX_ROWS = 1000

_key_cache = {"value": None, "at": 0.0}


def get_service_key(ssm_client=None):
    """SSM에서 인증키를 읽어 10분간 캐시."""
    if _key_cache["value"] and time.time() - _key_cache["at"] < 600:
        return _key_cache["value"]
    name = os.environ.get("SERVICE_KEY_PARAM")
    if not name:
        raise RuntimeError("SERVICE_KEY_PARAM 환경변수가 없습니다")
    if ssm_client is None:
        import boto3  # Lambda 런타임에 기본 포함
        ssm_client = boto3.client("ssm")
    value = ssm_client.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    _key_cache.update(value=value, at=time.time())
    return value


def endpoint_for(source):
    env = SOURCES.get(source)
    if env is None:
        return None
    url = os.environ.get(env, "").strip()
    return url or None


def clean_params(params):
    """허용된 파라미터만 남기고 numOfRows 상한을 둡니다."""
    out = {}
    for k, v in (params or {}).items():
        if k in ALLOWED_PARAMS and v is not None and len(str(v)) <= 40:
            out[k] = str(v)
    if "numOfRows" in out:
        try:
            out["numOfRows"] = str(max(1, min(int(out["numOfRows"]), MAX_ROWS)))
        except ValueError:
            out.pop("numOfRows")
    return out


def build_url(base, params, service_key):
    q = dict(params)
    q["serviceKey"] = service_key
    sep = "&" if "?" in base else "?"
    # data.go.kr 인증키는 이미 인코딩된 키와 디코딩된 키 두 가지가 발급되므로,
    # SSM에는 "디코딩" 키를 저장하고 여기서 한 번만 인코딩합니다.
    return base + sep + urllib.parse.urlencode(q)


def fetch(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "olpark-time/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read(), res.headers.get("Content-Type", "")


def xml_to_dict(elem):
    """XML 요소를 dict로 변환(같은 태그가 여러 번 나오면 리스트)."""
    children = list(elem)
    if not children:
        return (elem.text or "").strip()
    out = {}
    for c in children:
        v = xml_to_dict(c)
        if c.tag in out:
            if not isinstance(out[c.tag], list):
                out[c.tag] = [out[c.tag]]
            out[c.tag].append(v)
        else:
            out[c.tag] = v
    return out


def parse_body(body, content_type=""):
    """JSON이면 그대로, XML이면 dict로 변환."""
    text = body.decode("utf-8", errors="replace").strip()
    if "json" in content_type or text.startswith("{") or text.startswith("["):
        return json.loads(text)
    root = ET.fromstring(text)
    return {root.tag: xml_to_dict(root)}


def response(status, payload, origin="*", max_age=60):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": origin,
            "Cache-Control": f"public, max-age={max_age}" if status == 200 else "no-store",
        },
        "body": json.dumps(payload, ensure_ascii=False),
    }
