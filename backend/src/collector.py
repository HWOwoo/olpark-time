"""수집 Lambda: EventBridge 일정에 따라 공공데이터를 받아 S3에 원본 그대로 쌓습니다.

- 실시간 주차현황: 10분마다 (예측 모델의 학습·검증 데이터, 퇴장 대기 보정에 사용)
- 공연정보·연계 데이터: 하루 1회
응답 항목 구조는 활용신청 후 명세를 확인해 가공 단계에서 다루고, 여기서는 원본 보존에 집중합니다.

이벤트 예: {"sources": ["realtime-parking"], "params": {"numOfRows": "1000"}}
"""
import datetime as dt
import json
import os

import common

KST = dt.timezone(dt.timedelta(hours=9))


def handler(event, context, ssm_client=None, s3_client=None, fetcher=None, now=None):
    bucket = os.environ["DATA_BUCKET"]
    sources = (event or {}).get("sources") or ["realtime-parking"]
    params = common.clean_params((event or {}).get("params") or {"numOfRows": "1000"})
    now = now or dt.datetime.now(KST)
    if s3_client is None:
        import boto3
        s3_client = boto3.client("s3")

    results = []
    for source in sources:
        base = common.endpoint_for(source)
        if base is None:
            results.append({"source": source, "ok": False, "reason": "엔드포인트 미설정"})
            continue
        try:
            key = common.get_service_key(ssm_client)
            body, ctype = (fetcher or common.fetch)(common.build_url(base, params, key), timeout=20)
            data = common.parse_body(body, ctype)
        except Exception as e:
            results.append({"source": source, "ok": False, "reason": type(e).__name__})
            continue
        obj_key = f"raw/{source}/{now:%Y/%m/%d}/{now:%H%M%S}.json"
        s3_client.put_object(
            Bucket=bucket, Key=obj_key,
            Body=json.dumps({"collectedAt": now.isoformat(), "params": params, "data": data}, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
        )
        results.append({"source": source, "ok": True, "key": obj_key})

    failed = [r for r in results if not r["ok"]]
    print(json.dumps({"collected": results}, ensure_ascii=False))  # CloudWatch 로그로 남김
    if failed and len(failed) == len(results):
        raise RuntimeError(f"모든 수집 실패: {failed}")  # 실패 알람이 울리도록 예외 발생
    return {"results": results}
