/* 올팍타임 시연판 — 의존성 없는 바닐라 JS */
(function () {
  'use strict';
  const DATA = window.OLPARK_DATA;
  const CFG = window.OLPARK_CONFIG || {};
  const DAYS = DATA.days;
  const P = DATA.params;
  const DOW = ['월', '화', '수', '목', '금', '토', '일'];
  const SIZE = { large: '대형 행사일', medium: '중형 행사일', normal: '평소' };
  const GRADE = {
    good: { label: '원활', ic: '●' },
    warn: { label: '혼잡', ic: '▲' },
    crit: { label: '만차', ic: '■' },
  };
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
  const hhmm = (k) => `${String(Math.floor(k / 6)).padStart(2, '0')}:${k % 6}0`;
  const minToStr = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const dayLabel = (d) => { const [, m, dd] = d.date.split('-'); return `${+m}/${+dd}(${DOW[d.dow]})`; };
  const isWeekend = (d) => d.dow >= 5;
  const grade = (v) => (v >= P.full ? 'crit' : v >= P.busy ? 'warn' : 'good');
  const chip = (g) => `<span class="chip ${g}"><span class="ic" aria-hidden="true">${GRADE[g].ic}</span>${GRADE[g].label}</span>`;
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const state = { day: Math.max(0, DAYS.findIndex((d) => d.date === '2024-07-20')), replay: 108, end: null };

  // ---------- 예측 ----------
  function poolFor(i) {
    const d = DAYS[i];
    let pool = DAYS.map((x, j) => j).filter((j) => j !== i && DAYS[j].size === d.size && isWeekend(DAYS[j]) === isWeekend(d));
    if (!pool.length) pool = DAYS.map((x, j) => j).filter((j) => j !== i && DAYS[j].size === d.size);
    if (!pool.length) pool = DAYS.map((x, j) => j).filter((j) => j !== i && isWeekend(DAYS[j]) === isWeekend(d));
    return pool;
  }
  function predict(i) {
    const pool = poolFor(i);
    const pred = new Array(144).fill(0).map((_, k) => mean(pool.map((j) => DAYS[j].occ10[k])));
    return { pool, pred };
  }
  function firstAtLeast(arr, v, from = 54) {
    for (let k = from; k < 144; k++) if (arr[k] >= v) return k;
    return -1;
  }

  // ---------- SVG 차트 ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function lineChart(el, { k0, k1, series, refs, marker, bars, barsColor, tipRows }) {
    const W = 448, H = 210, L = 38, R = 10, T = 12, B = 24;
    const xs = (k) => L + ((k - k0) / (k1 - k0)) * (W - L - R);
    const all = [].concat(...series.map((s) => s.values.slice(k0, k1 + 1)), refs.map((r) => r.v), bars ? bars.slice(k0, k1 + 1) : []);
    const raw = Math.max(...all) * 1.05;
    const step = niceMax(raw / 5);
    const ticks = Math.ceil(raw / step);
    const ymax = step * ticks;
    const ys = (v) => T + (1 - v / ymax) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="시간대별 차트">`;
    for (let i = 0; i <= ticks; i++) {
      const v = step * i, y = ys(v);
      s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--line)" stroke-width="${i ? 0.8 : 1}"/>`;
      s += `<text x="${L - 6}" y="${y + 3}" text-anchor="end">${fmt(v)}</text>`;
    }
    for (let k = Math.ceil(k0 / 18) * 18; k <= k1; k += 18) s += `<text x="${xs(k)}" y="${H - 6}" text-anchor="middle">${k / 6}시</text>`;
    if (bars) {
      const bw = Math.max(2, (W - L - R) / (k1 - k0 + 1) - 2);
      for (let k = k0; k <= k1; k++) {
        const y = ys(bars[k]);
        s += `<rect x="${xs(k) - bw / 2}" y="${y}" width="${bw}" height="${ys(0) - y}" rx="2" style="fill:${barsColor}" opacity="0.85"/>`;
      }
    }
    refs.forEach((r) => {
      s += `<line x1="${L}" x2="${W - R}" y1="${ys(r.v)}" y2="${ys(r.v)}" style="stroke:var(--muted)" stroke-dasharray="4 3" stroke-width="1"/>`;
      s += `<text x="${W - R}" y="${ys(r.v) - 4}" text-anchor="end">${r.label}</text>`;
    });
    if (marker != null) {
      s += `<line x1="${xs(marker.k)}" x2="${xs(marker.k)}" y1="${T}" y2="${ys(0)}" style="stroke:var(--ink-2)" stroke-width="1"/>`;
      s += `<text x="${xs(marker.k) + 4}" y="${T + 9}" text-anchor="start" style="fill:var(--ink-2)">${marker.label}</text>`;
    }
    series.forEach((se) => {
      const pts = [];
      for (let k = k0; k <= k1; k++) pts.push(`${xs(k).toFixed(1)},${ys(se.values[k]).toFixed(1)}`);
      s += `<polyline points="${pts.join(' ')}" fill="none" style="stroke:${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    s += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${ys(0)}" style="stroke:var(--ink-2)" stroke-width="1" visibility="hidden"/>`;
    s += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${ys(0) - T}" fill="transparent"/>`;
    s += '</svg>';
    el.innerHTML = s;
    const svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), hit = svg.querySelector('.hit'), tip = $('#tip');
    function move(ev) {
      const pt = ev.touches ? ev.touches[0] : ev;
      const r = svg.getBoundingClientRect();
      const x = ((pt.clientX - r.left) / r.width) * W;
      const k = Math.min(k1, Math.max(k0, Math.round(k0 + ((x - L) / (W - L - R)) * (k1 - k0))));
      xh.setAttribute('x1', xs(k)); xh.setAttribute('x2', xs(k)); xh.setAttribute('visibility', 'visible');
      tip.innerHTML = tipRows(k);
      tip.hidden = false;
      const tx = Math.min(window.innerWidth - tip.offsetWidth - 8, pt.clientX + 12);
      tip.style.left = `${Math.max(8, tx)}px`;
      tip.style.top = `${pt.clientY - tip.offsetHeight - 12}px`;
    }
    function leave() { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    hit.addEventListener('mousemove', move);
    hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('mouseleave', leave);
    hit.addEventListener('touchend', leave);
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // ---------- 방문 예보 ----------
  function renderForecast() {
    const d = DAYS[state.day];
    const { pool, pred } = predict(state.day);
    const pk = d.occ10.indexOf(Math.max(...d.occ10));

    $('#eventCard').innerHTML = `
      <div class="label">기준일 행사 규모 (공연 관람 추정 차량 기준)</div>
      <div class="title">${dayLabel(d)} · ${SIZE[d.size]}</div>
      <div class="small">관람 추정 차량 <b>${fmt(d.aud)}대</b> · 7월 평소(중앙값) ${fmt(P.medianAud)}대</div>
      <div class="small muted">공연정보 API 연동 시 공연명·공연장·시작 시각이 함께 표시됩니다.</div>`;

    $('#poolInfo').textContent = `유사일 ${pool.length}일 평균`;
    let strip = '';
    for (let h = 9; h <= 23; h++) {
      const g = grade(Math.max(...pred.slice(h * 6, h * 6 + 6)));
      strip += `<div class="${g}" title="${h}시 ${GRADE[g].label}"><span></span>${h}</div>`;
    }
    $('#gradeStrip').innerHTML = strip;

    lineChart($('#forecastChart'), {
      k0: 36, k1: 143,
      series: [{ values: pred, color: 'var(--s1)' }, { values: d.occ10, color: 'var(--s2)' }],
      refs: [{ v: P.busy, label: `혼잡 ${fmt(P.busy)}` }, { v: P.full, label: `만차 ${fmt(P.full)}` }],
      tipRows: (k) => `${hhmm(k)}<br>예측 <b>${fmt(pred[k])}대</b> ${GRADE[grade(pred[k])].label}<br>실제 <b>${fmt(d.occ10[k])}대</b> ${GRADE[grade(d.occ10[k])].label}`,
    });

    let hit = 0, n = 0, err = 0;
    for (let k = 54; k < 138; k++) { n++; if (grade(pred[k]) === grade(d.occ10[k])) hit++; err += Math.abs(pred[k] - d.occ10[k]); }
    $('#accuracy').textContent = `기준일을 뺀 유사일(${pool.map((j) => dayLabel(DAYS[j])).join(', ')})로 예측한 결과, 9~23시 등급 일치율 ${Math.round((hit / n) * 100)}% · 평균 오차 ${fmt(err / n)}대`;

    const busyK = firstAtLeast(pred, P.busy);
    const fullK = firstAtLeast(pred, P.full);
    if (busyK < 0) {
      $('#arrivalCard').innerHTML = `<div class="small muted">도착 권장 시각</div><div class="big">언제 와도 원활</div><div class="small">예측상 혼잡 기준(${fmt(P.busy)}대)을 넘는 시간대가 없습니다.</div>`;
    } else {
      // 만차가 예상되면 만차 30분 전, 아니면 혼잡 30분 전을 권장
      const keyK = fullK >= 0 ? fullK : busyK;
      const rec = Math.max(0, keyK * 10 - 30);
      $('#arrivalCard').innerHTML = `<div class="small muted">도착 권장 시각</div>
        <div class="big">${minToStr(rec)} 이전 도착</div>
        <div class="small">${hhmm(busyK)}부터 혼잡${fullK >= 0 ? `, <b>${hhmm(fullK)}부터 만차</b>` : ''} 예상 · 이후에는 대중교통을 권장해요</div>`;
    }

    let hist = poolFor(state.day).filter((j) => DAYS[j].size === d.size);
    if (d.size === 'normal') hist = hist.sort((a, b) => Math.abs(a - state.day) - Math.abs(b - state.day)).slice(0, 4).sort((a, b) => a - b);
    $('#historyList').innerHTML = hist.map((j) => {
      const x = DAYS[j];
      const m = Math.max(...x.occ10), mk = x.occ10.indexOf(m), bk = firstAtLeast(x.occ10, P.busy);
      return `<li><span class="d">${dayLabel(x)} · ${SIZE[x.size]}</span>${chip(grade(m))}
        <span class="m">최대 ${fmt(m)}대(${hhmm(mk)}) · ${bk >= 0 ? `혼잡 시작 ${hhmm(bk)}` : '혼잡 없음'} · 관람 추정 ${fmt(x.aud)}대</span></li>`;
    }).join('') + `<li><span class="d">기준일 실제: ${dayLabel(d)}</span>${chip(grade(d.occ10[pk]))}<span class="m">최대 ${fmt(d.occ10[pk])}대(${hhmm(pk)})</span></li>`;

    if (d.size === 'normal') {
      $('#regularCard').innerHTML = `<h2>정기 이용자 알림</h2><p class="small">이날은 대형 행사가 없어 스포츠센터·테니스장 정기 이용 시간대에 큰 혼잡이 없을 것으로 예상됩니다.</p>
        <p class="small muted">참고: 7월 기록에서 오전 8시 입차가 하루 중 가장 많습니다(일평균 669대, 정기 이용자로 추정).</p>`;
    } else {
      const t = fullK >= 0 ? hhmm(fullK) : busyK >= 0 ? hhmm(busyK) : '오후';
      $('#regularCard').innerHTML = `<h2>정기 이용자 알림 미리보기</h2>
        <div class="callout">[올팍타임] ${dayLabel(d)} ${SIZE[d.size].replace('일', '')}로 <b>${t} 이후</b> 주차가 어려울 수 있어요. 스포츠센터·테니스장 이용 시 대중교통이나 이른 시간 방문을 권장합니다.</div>
        <p class="small muted">이름·연락처 없이 시설과 이용 시간대만 골라 구독하는 방식으로 제공합니다.</p>`;
    }
  }

  // ---------- 주차 현황 ----------
  function renderParking() {
    const d = DAYS[state.day], k = state.replay, v = d.occ10[k];
    $('#replayClock').textContent = hhmm(k);
    $('#replay').value = k;
    $('#nowBox').innerHTML = `<div><div class="small muted">${dayLabel(d)} ${hhmm(k)} 동시 주차</div><b>${fmt(v)}대</b></div>
      <div style="text-align:right">${chip(grade(v))}<div class="small muted">최근 10분 입차 ${fmt(d.ent10[k])} · 출차 ${fmt(d.ext10[k])}</div></div>`;
    const zones = DATA.zones.map((z) => {
      const tot = z.counts['원활'] + z.counts['혼잡'] + z.counts['만차'];
      return { ...z, tot, fullRate: z.counts['만차'] / tot };
    }).sort((a, b) => a.fullRate - b.fullRate);
    $('#zoneList').innerHTML = zones.map((z, i) => `
      <li class="${i < 2 ? 'rec' : ''}">
        <span class="z">${z.zone}</span>
        <span class="bar" title="원활 ${z.counts['원활']} · 혼잡 ${z.counts['혼잡']} · 만차 ${z.counts['만차']}">
          <i style="width:${(z.counts['원활'] / z.tot) * 100}%;background:var(--good)"></i><i style="width:${(z.counts['혼잡'] / z.tot) * 100}%;background:var(--warn)"></i><i style="width:${(z.counts['만차'] / z.tot) * 100}%;background:var(--crit)"></i>
        </span>
        ${i < 2 ? '<span class="chip good">추천</span>' : `<span class="small muted">만차 ${Math.round(z.fullRate * 100)}%</span>`}
        <span class="meta">만차 비율 ${Math.round(z.fullRate * 100)}% · 최근 기록 ${z.last}(${z.lastAt.slice(0, 10)}) · ${z.tot}건</span>
      </li>`).join('');
  }

  // ---------- 퇴장 타이밍 ----------
  // 시연판: 해당일 야간 출차가 최대치의 70%를 처음 넘는 구간의 10분 전을 "공연 종료"로 추정
  // (공연정보 API 연동 시 실제 공연 종료 예정 시각으로 대체)
  function detectEnd(d) {
    const base = mean(d.ext10.slice(114, 120));
    const night = d.ext10.slice(120, 138), mx = Math.max(...night);
    if (mx < Math.max(2 * base, 100)) return 126;
    for (let k = 120; k <= 137; k++) if (d.ext10[k] >= mx * 0.7) return Math.max(114, k - 1);
    return 126;
  }
  function simulate(d, endK) {
    const N = d.aud, C = P.exitPerMin;
    const b = mean(d.ext10.slice(114, 120)) / 10;
    const q = [], served = [];
    let queue = 0;
    for (let m = 0; m < 120; m++) {
      const share = m < 10 ? 0.45 / 10 : m < 20 ? 0.3 / 10 : m < 30 ? 0.15 / 10 : m < 60 ? 0.1 / 30 : 0;
      queue += N * share + b;
      const s = Math.min(queue, C);
      queue -= s;
      served.push(s); q.push(queue);
    }
    const waits = [0, 10, 20, 30, 40, 50, 60].map((o) => ({ o, w: Math.round(mean(q.slice(o, o + 10)) / C) }));
    const modelExit10 = new Array(144).fill(0).map((_, k) => {
      if (k < endK) return b * 10; // 종료 전: 19시대 평균 출차 수준 유지
      const m = (k - endK) * 10;
      return m < 120 ? served.slice(m, m + 10).reduce((a, c) => a + c, 0) : b * 10;
    });
    return { waits, modelExit10, N, b };
  }
  function renderExit() {
    const d = DAYS[state.day];
    if (state.end == null) state.end = detectEnd(d);
    const sel = $('#endSelect');
    sel.innerHTML = '';
    for (let k = 114; k <= 135; k++) sel.add(new Option(hhmm(k), k, false, k === state.end));
    const { waits, modelExit10, N } = simulate(d, state.end);
    $('#audCount').textContent = `${fmt(N)}대`;
    const wmax = Math.max(10, ...waits.map((x) => x.w));
    const best = waits.find((x) => x.o >= 10 && x.w <= 2) || waits.reduce((a, x) => (x.w < a.w ? x : a));
    $('#waitBars').innerHTML = waits.map((x) => {
      const g = x.w >= 10 ? 'crit' : x.w >= 5 ? 'warn' : 'good';
      const lbl = x.o === 0 ? '종료 직후' : `${x.o}분 후`;
      return `<div class="wrow ${x === best ? 'best' : ''}"><span class="lbl">${lbl} <span class="muted small">${minToStr(state.end * 10 + x.o)}</span></span>
        <span class="track"><span class="fill" style="display:block;width:${(x.w / wmax) * 100}%;background:var(--${g === 'good' ? 'good' : g === 'warn' ? 'warn' : 'crit'})"></span></span>
        <span class="v">약 ${Math.round(x.w)}분</span></div>`;
    }).join('');
    const w0 = waits[0].w, peak = waits.reduce((a, x) => (x.w > a.w ? x : a));
    $('#exitAdvice').innerHTML = peak.w < 3
      ? `출차 몰림이 크지 않을 것으로 예상됩니다. 편한 시간에 출차하세요.`
      : `종료 직후 바로 나가면 대기 약 <b>${Math.round(w0)}분</b>, ${peak.o}~${peak.o + 10}분 뒤가 가장 붐빕니다(약 ${Math.round(peak.w)}분).<br>몰림을 피하려면 <b>${minToStr(state.end * 10 + best.o)} 이후 출차</b>를 권장해요. 기다리는 동안 공원 산책도 좋아요.`;
    lineChart($('#exitChart'), {
      k0: 114, k1: 143,
      series: [{ values: modelExit10, color: 'var(--s1)' }],
      bars: d.ext10, barsColor: 'var(--s2)',
      refs: [{ v: P.maxExit10, label: `관측 최대 ${fmt(P.maxExit10)}대/10분` }],
      marker: { k: state.end, label: '종료' },
      tipRows: (k) => `${hhmm(k)}~<br>실제 출차 <b>${fmt(d.ext10[k])}대</b><br>모델 출차 <b>${fmt(modelExit10[k])}대</b>`,
    });
  }

  // ---------- 예보 카드 ----------
  function renderCard() {
    const d = DAYS[state.day];
    const { pred } = predict(state.day);
    const busyK = firstAtLeast(pred, P.busy), fullK = firstAtLeast(pred, P.full);
    const endK = state.end ?? detectEnd(d);
    const { waits } = simulate(d, endK);
    const best = waits.find((x) => x.o >= 10 && x.w <= 2) || waits[waits.length - 1];
    const peakW = Math.max(...waits.map((x) => x.w));
    const cv = $('#shareCanvas'), c = cv.getContext('2d');
    const F = '"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1080, 1350);
    c.fillStyle = '#1f3864'; roundRect(c, 0, 0, 1080, 300, 0); c.fill();
    c.fillStyle = '#dbe4f3'; c.font = `500 40px ${F}`; c.fillText('올팍타임 · 오늘의 올팍 교통예보', 72, 110);
    c.fillStyle = '#ffffff'; c.font = `800 84px ${F}`; c.fillText(`2024. ${dayLabel(d).replace('/', '. ')}`, 72, 220);
    const g = grade(Math.max(...pred.slice(54, 138)));
    const gc = { good: '#0ca30c', warn: '#fab219', crit: '#d03b3b' }[g];
    c.fillStyle = gc; roundRect(c, 72, 350, 300, 110, 55); c.fill();
    c.fillStyle = g === 'warn' ? '#0b0b0b' : '#ffffff'; c.font = `800 56px ${F}`; c.textAlign = 'center'; c.fillText(`${GRADE[g].ic} ${GRADE[g].label}`, 222, 425); c.textAlign = 'left';
    c.fillStyle = '#0b0b0b'; c.font = `700 46px ${F}`; c.fillText(SIZE[d.size], 410, 425);
    // 시간대 띠
    for (let h = 9; h <= 23; h++) {
      const gg = grade(Math.max(...pred.slice(h * 6, h * 6 + 6)));
      c.fillStyle = { good: '#0ca30c', warn: '#fab219', crit: '#d03b3b' }[gg];
      roundRect(c, 72 + (h - 9) * 62, 520, 54, 70, 10); c.fill();
      c.fillStyle = '#52514e'; c.font = `500 26px ${F}`; c.textAlign = 'center'; c.fillText(String(h), 99 + (h - 9) * 62, 630); c.textAlign = 'left';
    }
    const rows = [
      ['도착 권장', busyK < 0 ? '언제 와도 원활' : `${minToStr(Math.max(0, (fullK >= 0 ? fullK : busyK) * 10 - 30))} 이전 도착`],
      ['만차 예상', fullK < 0 ? '만차 없음' : `${hhmm(fullK)}부터`],
      ['퇴장 권장', peakW < 3 ? '편한 시간에 출차' : `${minToStr(endK * 10 + best.o)} 이후 출차`],
    ];
    rows.forEach(([k, v], i) => {
      const y = 700 + i * 150;
      c.fillStyle = '#f4f6fa'; roundRect(c, 72, y, 936, 120, 24); c.fill();
      c.fillStyle = '#52514e'; c.font = `500 36px ${F}`; c.fillText(k, 112, y + 74);
      c.fillStyle = '#1f3864'; c.font = `800 52px ${F}`; c.textAlign = 'right'; c.fillText(v, 968, y + 78); c.textAlign = 'left';
    });
    c.fillStyle = '#6f6d68'; c.font = `500 26px ${F}`;
    c.fillText('공공데이터(한국체육산업개발㈜ 올림픽공원 입출차 정보) 기반 시연 예보', 72, 1230);
    c.fillText('개인 출품작 시연판 · 실제 운영 정보와 다를 수 있습니다', 72, 1275);
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---------- 공통 ----------
  function renderAll() { renderForecast(); renderParking(); renderExit(); renderCard(); }
  function init() {
    if (CFG.API_BASE) $('#modeBadge').textContent = 'API 연동';
    const sel = $('#daySelect');
    DAYS.forEach((d, i) => sel.add(new Option(`2024. ${dayLabel(d).replace('/', '. ')} · ${SIZE[d.size]}`, i, false, i === state.day)));
    sel.addEventListener('change', () => { state.day = +sel.value; state.end = null; renderAll(); });
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
      try { localStorage.setItem('olpark-tab', b.dataset.tab); } catch (e) { /* 저장소 사용 불가 시 무시 */ }
    }));
    $('#replay').addEventListener('input', (e) => { state.replay = +e.target.value; renderParking(); });
    $('#endSelect').addEventListener('change', (e) => { state.end = +e.target.value; renderExit(); renderCard(); });
    $('#downloadBtn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.download = `olpark-forecast-${DAYS[state.day].date}.png`;
      a.href = $('#shareCanvas').toDataURL('image/png');
      a.click();
    });
    renderAll();
    try {
      const t = localStorage.getItem('olpark-tab');
      if (t) { const b = document.querySelector(`.tabs button[data-tab="${t}"]`); if (b) b.click(); }
    } catch (e) { /* 무시 */ }
  }
  init();
})();
