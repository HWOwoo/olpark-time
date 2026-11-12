"""올팍타임 시연용 데이터 전처리.

입력(공공데이터포털, 한국체육산업개발㈜ 개방 데이터, CP949 → UTF-8 변환본):
  raw/olpark_inout_202407.csv  : 올림픽공원 입출차 정보 (2024년 7월, 동2·남2·북2문)
  raw/parking_congestion.csv   : 주차장 혼잡도 정보

출력:
  ../data/olpark.js  (window.OLPARK_DATA = {...})  — 브라우저에서 file:// 로도 열리도록 JS 로 저장

실행:  python analysis/build_data.py
"""
import csv
import datetime as dt
import json
import os
import statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "data", "olpark.js")
FMT = "%Y-%m-%d %H:%M"

START = dt.datetime(2024, 7, 1)
DAYS = 31
MIN = DAYS * 1440


def load_inout():
    rows = []
    with open(os.path.join(RAW, "olpark_inout_202407.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                a = dt.datetime.strptime(r["입차일시"], FMT)
                b = dt.datetime.strptime(r["출차일시"], FMT)
            except (ValueError, KeyError):
                continue
            # 출차가 입차보다 빠르거나 24시간 초과(장기주차, 기록 불완전)는 제외
            if b < a or (b - a).total_seconds() > 86400:
                continue
            rows.append((a, b))
    return rows


def minute_index(t):
    return int((t - START).total_seconds() // 60)


def main():
    rows = load_inout()

    # 분 단위 재차 대수(동시 주차) — 차분 배열
    diff = [0] * (MIN + 1)
    ent10 = [0] * (MIN // 10)
    ext10 = [0] * (MIN // 10)
    aud = [0] * DAYS
    for a, b in rows:
        ia, ib = minute_index(a), minute_index(b)
        if 0 <= ia < MIN:
            ent10[ia // 10] += 1
        if 0 <= ib < MIN:
            ext10[ib // 10] += 1
        ia, ib = max(ia, 0), min(ib, MIN)
        if ia < ib:
            diff[ia] += 1
            diff[ib] -= 1
        # 공연 관람 추정 차량: 같은 날 15:00~19:30 입차, 20:30 이후 출차, 2.5시간 이상 체류
        am, bm = a.hour * 60 + a.minute, b.hour * 60 + b.minute
        if (a.date() == b.date() and 900 <= am <= 1170 and bm >= 1230
                and (b - a).total_seconds() >= 9000):
            d = (a.date() - START.date()).days
            if 0 <= d < DAYS:
                aud[d] += 1
    occ = []
    cur = 0
    for i in range(MIN):
        cur += diff[i]
        occ.append(cur)

    days = []
    for d in range(DAYS):
        date = (START + dt.timedelta(days=d)).date()
        s = d * 144
        occ10 = [occ[(s + k) * 10 + 5] for k in range(144)]  # 각 10분 구간의 5분 시점 스냅샷
        days.append({
            "date": date.isoformat(),
            "dow": date.weekday(),  # 0=월
            "occ10": occ10,
            "ent10": ent10[s:s + 144],
            "ext10": ext10[s:s + 144],
            "aud": aud[d],
            "entries": sum(ent10[s:s + 144]),
        })

    med_aud = st.median(aud)
    for x in days:
        x["size"] = "large" if x["aud"] >= 400 else ("medium" if x["aud"] >= 200 else "normal")

    # 혼잡도 정보: 구역별 최근 기록 + 등급 분포
    zones = {}
    with open(os.path.join(RAW, "parking_congestion.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            z = r["주차구역"]
            stamp = f'{r["등록일"]} {r["등록시간"]}'
            info = zones.setdefault(z, {"zone": z, "counts": {"원활": 0, "혼잡": 0, "만차": 0}, "last": None, "lastAt": ""})
            info["counts"][r["혼잡도"]] = info["counts"].get(r["혼잡도"], 0) + 1
            if stamp > info["lastAt"]:
                info["lastAt"], info["last"] = stamp, r["혼잡도"]
    zone_list = sorted(zones.values(), key=lambda z: (len(z["zone"]), z["zone"]))

    max_exit10 = max(ext10)
    data = {
        "source": {
            "inout": "한국체육산업개발㈜_올림픽공원 입출차 정보 (2024년 7월, 동2·남2·북2문 주차구역)",
            "congestion": "한국체육산업개발㈜_주차장 혼잡도 정보",
            "records": len(rows),
        },
        "params": {
            # 시연용 등급 임계값(동시 주차 대수). 구역별 면수 확보 후 「주차장 혼잡도 정보」로 보정 예정.
            "busy": 800,
            "full": 1400,
            # 관측된 최대 출차 처리량(10분당) → 분당 처리량
            "maxExit10": max_exit10,
            "exitPerMin": round(max_exit10 / 10, 1),
            "medianAud": med_aud,
        },
        "days": days,
        "zones": zone_list,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 자동 생성 파일: analysis/build_data.py\n")
        f.write("window.OLPARK_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"records={len(rows)} days={len(days)} maxExit10={max_exit10} medianAud={med_aud}")
    for x in days:
        if x["size"] != "normal":
            print(x["date"], x["size"], x["aud"], "peakOcc", max(x["occ10"]))


if __name__ == "__main__":
    main()
