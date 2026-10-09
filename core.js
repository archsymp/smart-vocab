/* Smart Vocab — 학습 로직 (PC v4.7 vocapro_v47.py와 동일한 규칙)
 * 화면과 무관한 순수 함수만 모아둔 파일. 브라우저와 Node(테스트) 양쪽에서 사용. */
(function (global) {
  "use strict";

  const APP_VERSION = "v4.8-android";
  const EF_DEFAULT = 2.5, EF_MIN = 1.3, EF_MAX = 3.0;
  const EF_GAIN = 0.1, EF_PENALTY = 0.2;
  const RELEARN_REQUIRED = 3;
  const RELEARN_STEPS = [1, 3, 7];
  const FOCUS_MAX = 5.0;
  const CSV_FIELDS = ["Word", "Meaning", "Tests", "Correct", "Wrongs", "Interval", "EF",
    "Reps", "Relearn", "Focus", "NextReview", "LastTested", "CreatedAt",
    "Synonyms", "Antonyms", "Related", "Note"];
  // 동의어·반의어·관련어는 ';'로 구분한 문자열, 메모는 자유 텍스트
  const LIST_FIELDS = ["synonyms", "antonyms", "related"];
  const EXTRA_FIELDS = [...LIST_FIELDS, "note"];
  // 앱이 아직 모르는 CSV 열은 버리지 않고 w.extra = {열 이름: 값}에 보관 (나중 기능에서 사용)
  const KNOWN_COLS = new Set([...CSV_FIELDS.map((c) => c.toLowerCase()), "단어", "뜻"]);

  // ── 숫자: Python round()와 같은 결과를 내기 위한 함수 ──
  function pyRound(x) {               // 정수 반올림, .5는 짝수 쪽 (Python과 동일)
    const f = Math.floor(x), diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  /** Python round(x, 2)와 동일: x의 정확한 2진수 값 기준, 딱 절반이면 짝수 쪽 */
  function round2(x) {
    if (!Number.isFinite(x)) return x;
    const sign = x < 0 ? -1 : 1;
    const [ip, fp] = Math.abs(x).toFixed(100).split(".");   // |x|<1e21에서 정확한 10진 전개
    let n = Number(ip + fp.slice(0, 2));
    const rest = fp.slice(2).replace(/0+$/, "");
    if (rest > "5" || (rest[0] === "5" && rest.length > 1)) n += 1;
    else if (rest === "5" && n % 2 === 1) n += 1;
    return sign * n / 100;
  }
  function toInt(v, d = 0) { const n = parseFloat(v); return Number.isFinite(n) ? Math.trunc(n) : d; }
  function toFloat(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }

  // ── 날짜 (로컬 시간 기준, 'YYYY-MM-DD' 문자열로 비교) ──
  const pad = (n) => String(n).padStart(2, "0");
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayStr(now = new Date()) { return ymd(now); }
  function nowStr(now = new Date()) { return `${ymd(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`; }
  function nowStrSec(now = new Date()) { return `${nowStr(now)}:${pad(now.getSeconds())}`; }
  function addDays(dayStr, n) {
    const [y, m, d] = dayStr.split("-").map(Number);
    return ymd(new Date(y, m - 1, d + n));
  }
  function diffDays(a, b) {          // a - b (일)
    const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
  }
  /** 'YYYY-MM-DD HH:MM' 또는 'YYYY-MM-DD' → 'YYYY-MM-DD'. 실패 시 null. */
  function parseDate(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  function dateToStr(day) { return `${day} 00:00`; }   // PC v4.6/v4.7 호환 형식

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function newWord(word, meaning, createdAt) {
    return {
      id: uuid(), word, meaning,
      test_cnt: 0, wrong_cnt: 0, correct_cnt: 0,
      ef: EF_DEFAULT, interval: 0, reps: 0, relearn: 0, focus: 0.0,
      next_review: null, last_tested: null,
      created_at: createdAt || nowStrSec(),
      synonyms: "", antonyms: "", related: "", note: "", extra: {},
    };
  }

  /** 기존 데이터를 v4.7 형식으로 보정 (PC normalize_word와 동일) */
  function normalizeWord(w, createdFallback) {
    if (!w.id) w.id = uuid();
    w.word = String(w.word ?? "").trim();
    w.meaning = String(w.meaning ?? "").trim();

    w.wrong_cnt = toInt(w.wrong_cnt ?? 0);
    if (!("correct_cnt" in w)) w.correct_cnt = Math.max(0, toInt(w.test_cnt ?? 0) - w.wrong_cnt);
    w.correct_cnt = toInt(w.correct_cnt);
    if (toInt(w.test_cnt ?? 0) === 0) w.test_cnt = w.correct_cnt + w.wrong_cnt;
    w.test_cnt = toInt(w.test_cnt);

    w.ef = Math.min(EF_MAX, Math.max(EF_MIN, toFloat(w.ef ?? EF_DEFAULT, EF_DEFAULT)));
    w.interval = Math.max(0, toInt(w.interval ?? 0));

    if (!("relearn" in w)) w.relearn = (w.wrong_cnt > 0 && w.interval === 1) ? RELEARN_REQUIRED : 0;
    w.relearn = Math.min(RELEARN_REQUIRED, Math.max(0, toInt(w.relearn)));
    if (!("reps" in w)) {
      if (w.relearn > 0 || w.interval === 0) w.reps = 0;
      else if (w.interval === 1) w.reps = 1;
      else w.reps = 2;
    }
    w.reps = Math.max(0, toInt(w.reps));
    w.focus = Math.min(FOCUS_MAX, Math.max(0, toFloat(w.focus ?? 0, 0)));

    const nd = parseDate(w.next_review);
    w.next_review = nd ? dateToStr(nd) : null;
    if (!w.last_tested) w.last_tested = null;
    if (!w.created_at) w.created_at = createdFallback || nowStrSec();
    for (const f of LIST_FIELDS) w[f] = normList(w[f]);
    w.note = String(w.note ?? "").trim();
    w.extra = normExtra(w.extra);
    return w;
  }

  /** 'a; b, c;;a' → 'a;b;c' (쉼표·세미콜론 모두 구분자로, 중복 제거) */
  function normList(v) {
    const out = [];
    for (const t of String(v ?? "").split(/[;,]/)) { const x = t.trim(); if (x && !out.includes(x)) out.push(x); }
    return out.join(";");
  }
  function normExtra(x) {
    const out = {};
    if (x && typeof x === "object" && !Array.isArray(x))
      for (const [k, v] of Object.entries(x)) { const kk = String(k).trim(), vv = String(v ?? "").trim(); if (kk && vv) out[kk] = vv; }
    return out;
  }
  /** 이미 있는 단어에 동의어 등을 보충 (목록은 합치고, 메모는 비어 있을 때만). 바뀌면 true */
  function mergeExtras(w, extra) {
    let changed = false;
    for (const f of LIST_FIELDS) {
      const merged = normList([w[f] || "", extra[f] || ""].join(";"));
      if (merged !== (w[f] || "")) { w[f] = merged; changed = true; }
    }
    const note = String(extra.note || "").trim();
    if (note && !(w.note || "").trim()) { w.note = note; changed = true; }
    const ex = normExtra(extra.extra);
    for (const [k, v] of Object.entries(ex)) {
      if (!w.extra || typeof w.extra !== "object") w.extra = {};
      if (!w.extra[k]) { w.extra[k] = v; changed = true; }
    }
    return changed;
  }
  function splitList(v) { return String(v || "").split(";").filter(Boolean); }

  function normalizeAll(words, now = new Date()) {
    const seen = new Set();
    words.forEach((w, idx) => {
      normalizeWord(w, nowStrSec(new Date(now.getTime() - idx * 1000)));
      if (seen.has(w.id)) w.id = uuid();
      seen.add(w.id);
    });
    return words;
  }

  /** JSON 텍스트 → 단어 목록. 형식이 이상하면 Error */
  function parseWordsJson(text) {
    let data;
    try { data = JSON.parse(text.replace(/^﻿/, "")); }
    catch (e) { throw new Error("JSON 형식 오류: " + e.message); }
    if (!Array.isArray(data) || !data.every((w) => w && typeof w === "object" && "word" in w && "meaning" in w))
      throw new Error("단어장 형식이 아닙니다.");
    return data;
  }

  // ── 복습 스케줄 ──
  function isDue(w, today) { const nd = parseDate(w.next_review); return nd === null || nd <= today; }
  function isReviewDue(w, today) { const nd = parseDate(w.next_review); return nd !== null && nd <= today; }

  /** 정식 테스트 결과 반영. 'early'(기한 전 정답: 일정 유지) / 'scheduled' */
  function applyAnswer(w, correct, today, now = new Date()) {
    const firstTime = (w.test_cnt || 0) === 0;
    const due = isDue(w, today);
    w.test_cnt = (w.test_cnt || 0) + 1;
    w.last_tested = nowStr(now);

    if (correct) {
      w.correct_cnt = (w.correct_cnt || 0) + 1;
      w.focus = round2((w.focus || 0) / 2);
      if (w.focus < 0.1) w.focus = 0.0;
      if (!due) return "early";
      if ((w.relearn || 0) > 0) {
        w.relearn -= 1;
        if (w.relearn === 0) {
          w.reps = 2;
          w.interval = Math.max(1, pyRound(RELEARN_STEPS[RELEARN_STEPS.length - 1] * w.ef));
        } else {
          w.interval = RELEARN_STEPS[RELEARN_REQUIRED - w.relearn];
        }
      } else {
        const reps = w.reps || 0;
        if (reps === 0) w.interval = 1;
        else if (reps === 1) w.interval = 6;
        else w.interval = Math.max(1, pyRound((w.interval || 1) * w.ef));
        w.reps = reps + 1;
        w.ef = Math.min(EF_MAX, round2(w.ef + EF_GAIN));
      }
    } else {
      w.wrong_cnt = (w.wrong_cnt || 0) + 1;
      if ((w.relearn || 0) === 0 && !firstTime) w.ef = Math.max(EF_MIN, round2(w.ef - EF_PENALTY));
      w.relearn = RELEARN_REQUIRED;
      w.reps = 0;
      w.interval = RELEARN_STEPS[0];
    }
    w.next_review = dateToStr(addDays(today, w.interval));
    return "scheduled";
  }

  /** 틀린 것만 다시 풀기: 학습 기록은 그대로, 집중도만 */
  function applyPractice(w, correct) {
    if (!correct) w.focus = Math.min(FOCUS_MAX, (w.focus || 0) + 1);
  }

  function errorRate(w) { const t = w.test_cnt || 0; return t > 0 ? (w.wrong_cnt || 0) / t : 0; }

  function cmpTuple(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

  function pickReviewWords(words, today) {
    const key = (w) => {
      const overdue = diffDays(today, parseDate(w.next_review));
      return [(w.relearn || 0) > 0 ? 1 : 0, w.focus || 0, overdue + (3.0 - (w.ef ?? EF_DEFAULT))];
    };
    return words.filter((w) => isReviewDue(w, today))
      .map((w) => [key(w), w]).sort((a, b) => cmpTuple(b[0], a[0])).map((x) => x[1]);
  }

  function pickHighErrorWords(words) {
    return words.filter((w) => (w.wrong_cnt || 0) > 0 || (w.focus || 0) > 0)
      .map((w) => [[errorRate(w) + (w.focus || 0) / 10, w.wrong_cnt || 0], w])
      .sort((a, b) => cmpTuple(b[0], a[0])).map((x) => x[1]);
  }

  function statusText(w) {
    if ((w.test_cnt || 0) === 0) return "신규";
    if ((w.relearn || 0) > 0) return `재학습 ${RELEARN_REQUIRED - w.relearn}/${RELEARN_REQUIRED}`;
    return "학습중";
  }

  // ── CSV ──
  function parseCsvRows(text) {      // RFC4180 (따옴표, 줄바꿈 포함 칸 지원)
    const rows = []; let row = [], field = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** CSV 텍스트 → {added, dup, bad}. 헤더가 있으면 건너뛰고, 내보내기 형식이면 기록 복원 */
  function parseCsvText(text, existingWords, now = new Date()) {
    let rows = parseCsvRows(text);
    let headerMap = null, headerRow = [];
    if (rows.length && rows[0].length && ["word", "단어"].includes(rows[0][0].trim().toLowerCase())) {
      headerMap = {}; headerRow = rows[0].map((h) => h.trim());
      rows[0].forEach((h, i) => { headerMap[h.trim().toLowerCase()] = i; });
      rows = rows.slice(1);
    }
    const seen = new Set(existingWords.map((w) => w.word));
    const existing = new Map(existingWords.map((w) => [w.word, w]));
    const added = [], fills = []; let dup = 0, bad = 0;
    const col = (row, name) => { const i = headerMap ? headerMap[name.toLowerCase()] : undefined; return i !== undefined && i < row.length ? row[i].trim() : ""; };
    const unknownCols = headerMap ? Object.entries(headerMap).filter(([h]) => h && !KNOWN_COLS.has(h)) : [];
    const extrasOf = (row) => {
      const extra = {};
      for (const [, i] of unknownCols) if (i < row.length && row[i].trim()) extra[headerRow[i]] = row[i].trim();
      return { synonyms: col(row, "synonyms"), antonyms: col(row, "antonyms"), related: col(row, "related"), note: col(row, "note"), extra };
    };
    for (const row of rows) {
      if (!row.length || row.every((c) => !c.trim())) continue;
      if (row.length < 2 || !row[0].trim() || !row[1].trim()) { bad++; continue; }
      const word = row[0].trim().toLowerCase(), meaning = row[1].trim();
      if (seen.has(word)) {
        dup++;
        if (headerMap && existing.has(word)) fills.push([existing.get(word), extrasOf(row)]);  // 기존 단어 보충용
        continue;
      }
      seen.add(word);
      const w = newWord(word, meaning, nowStrSec(new Date(now.getTime() + added.length * 1000)));
      if (headerMap) {
        const stats = { test_cnt: "Tests", correct_cnt: "Correct", wrong_cnt: "Wrongs", interval: "Interval", ef: "EF",
          reps: "Reps", relearn: "Relearn", focus: "Focus", next_review: "NextReview", last_tested: "LastTested", created_at: "CreatedAt" };
        for (const [k, name] of Object.entries(stats)) {
          const v = col(row, name);
          if (v !== "") w[k] = v;
          else if (["correct_cnt", "reps", "relearn"].includes(k)) delete w[k];
        }
        Object.assign(w, extrasOf(row));
        normalizeWord(w, w.created_at);
      }
      added.push(w);
    }
    return { added, dup, bad, fills };
  }

  function csvEscape(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function pyNum(v) {                 // Python이 쓰는 숫자 표기와 맞춤 (2.5, 0.0, 3)
    return Number.isInteger(v) ? `${v}.0` : String(v);
  }
  function wordsToCsv(words) {
    const extraKeys = [];
    for (const d of words) for (const k of Object.keys(d.extra || {})) if (!extraKeys.includes(k)) extraKeys.push(k);
    const lines = [[...CSV_FIELDS, ...extraKeys].map(csvEscape).join(",")];
    for (const d of words) {
      lines.push([d.word, d.meaning, d.test_cnt || 0, d.correct_cnt || 0, d.wrong_cnt || 0, d.interval || 0,
        pyNum(d.ef ?? EF_DEFAULT), d.reps || 0, d.relearn || 0, pyNum(d.focus || 0),
        d.next_review || "", d.last_tested || "", d.created_at || "",
        d.synonyms || "", d.antonyms || "", d.related || "", d.note || "",
        ...extraKeys.map((k) => (d.extra || {})[k] || "")].map(csvEscape).join(","));
    }
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  const api = {
    APP_VERSION, EF_DEFAULT, RELEARN_REQUIRED, RELEARN_STEPS, FOCUS_MAX,
    pyRound, todayStr, nowStr, nowStrSec, addDays, diffDays, parseDate, dateToStr,
    newWord, normalizeWord, normalizeAll, parseWordsJson,
    isDue, isReviewDue, applyAnswer, applyPractice, errorRate,
    pickReviewWords, pickHighErrorWords, statusText,
    parseCsvRows, parseCsvText, wordsToCsv, normList, mergeExtras, splitList, EXTRA_FIELDS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.VocabCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
