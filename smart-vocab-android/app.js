/* Smart Vocab — 안드로이드(웹앱) 화면 */
(function () {
  "use strict";
  const C = window.VocabCore;
  const $app = document.getElementById("app");

  // ─────────────────────────────────────────
  // 저장소: IndexedDB (안 되면 localStorage)
  //  - words: 현재 단어장 / words_prev: 직전 저장본(손상 시 복구용) / meta: 마지막 백업 시각 등
  // ─────────────────────────────────────────
  const Store = (() => {
    let db = null, mode = "idb";
    function open() {
      return new Promise((resolve) => {
        if (!("indexedDB" in window)) { mode = "local"; return resolve(); }
        let req;
        try { req = indexedDB.open("smartvocab", 1); } catch (e) { mode = "local"; return resolve(); }
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => { db = req.result; resolve(); };
        req.onerror = () => { mode = "local"; resolve(); };
      });
    }
    function get(key) {
      if (mode === "local") {
        try { const v = localStorage.getItem("sv_" + key); return Promise.resolve(v ? JSON.parse(v) : undefined); }
        catch (e) { return Promise.resolve(undefined); }
      }
      return new Promise((resolve, reject) => {
        const r = db.transaction("kv").objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    }
    function put(key, val) {
      if (mode === "local") { localStorage.setItem("sv_" + key, JSON.stringify(val)); return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(val, key);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    }
    /** 단어장 저장: 직전 저장본을 words_prev로 옮기고 새 목록 저장 (한 트랜잭션 = 중간 상태 없음) */
    function saveWords(words) {
      const data = JSON.parse(JSON.stringify(words));
      if (mode === "local") {
        const cur = localStorage.getItem("sv_words");
        if (cur) localStorage.setItem("sv_words_prev", cur);
        localStorage.setItem("sv_words", JSON.stringify(data));
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite"), st = tx.objectStore("kv");
        const r = st.get("words");
        r.onsuccess = () => { if (Array.isArray(r.result)) st.put(r.result, "words_prev"); st.put(data, "words"); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    }
    return { open, get, put, saveWords, get mode() { return mode; } };
  })();

  // ─────────────────────────────────────────
  // 상태
  // ─────────────────────────────────────────
  const S = {
    words: [], meta: {}, screen: "home", persisted: null, readOnly: false,
    testCount: null, test: null, manage: { q: "", sort: "최신순", limit: 100 },
  };
  let saveChain = Promise.resolve();
  function save() {
    if (S.readOnly) { toast("저장이 막혀 있습니다 (단어장 손상)"); return Promise.resolve(false); }
    saveChain = saveChain.then(() => Store.saveWords(S.words)).then(() => true).catch((e) => {
      dialog({ title: "저장 실패", msg: "저장 중 오류가 발생했습니다.\n" + (e && e.message || e), buttons: [{ label: "확인", value: true, kind: "primary" }] });
      return false;
    });
    return saveChain;
  }
  function saveMeta() { return Store.put("meta", S.meta).catch(() => {}); }
  const today = () => C.todayStr();

  // ─────────────────────────────────────────
  // 공통 UI 도구
  // ─────────────────────────────────────────
  /** 한글 조합 중 Enter로 제출되면 마지막 글자가 빠질 수 있어, 조합이 끝난 뒤 제출 */
  function guardSubmit(form, inputs, onSubmit) {
    let composing = false, pending = false;
    inputs.forEach((i) => {
      i.addEventListener("compositionstart", () => { composing = true; });
      i.addEventListener("compositionend", () => {
        composing = false;
        if (pending) { pending = false; setTimeout(onSubmit, 0); }
      });
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (composing) { pending = true; return; }
      onSubmit();
    });
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qs = (sel, root = document) => root.querySelector(sel);

  function toast(msg, ms = 2200) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms);
  }

  /** 대화상자: buttons=[{label, value, kind}] → 누른 버튼의 value (바깥 탭/뒤로가기 = null) */
  let dialogClose = null;
  function dialog({ title, msg, buttons }) {
    return new Promise((resolve) => {
      const ov = document.createElement("div"); ov.className = "overlay center";
      ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
        <h2>${esc(title)}</h2><p>${esc(msg)}</p>
        <div class="actions">${buttons.map((b, i) => `<button class="btn small ${b.kind || ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
      const done = (v) => { ov.remove(); dialogClose = null; resolve(v); };
      ov.addEventListener("click", (e) => {
        if (e.target === ov) return done(null);
        const b = e.target.closest("[data-i]"); if (b) done(buttons[+b.dataset.i].value);
      });
      dialogClose = () => done(null);
      document.body.appendChild(ov);
      const first = ov.querySelector(".btn.primary") || ov.querySelector(".btn"); first && first.focus();
    });
  }
  const confirmBox = (title, msg, okLabel = "확인", cancelLabel = "취소", danger = false) =>
    dialog({ title, msg, buttons: [{ label: okLabel, value: true, kind: danger ? "danger" : "primary" }, { label: cancelLabel, value: false }] }).then((v) => v === true);
  const alertBox = (title, msg) => dialog({ title, msg, buttons: [{ label: "확인", value: true, kind: "primary" }] });

  // ─────────────────────────────────────────
  // 화면 이동 + 안드로이드 뒤로가기
  //  홈 → 다른 화면: 기록 1개 추가 / 화면끼리 이동: 교체 / 뒤로가기 → 화면별 처리
  // ─────────────────────────────────────────
  let ignorePop = false;
  function go(screen) {
    const fromHome = S.screen === "home";
    S.screen = screen;
    if (screen !== "home") {
      if (fromHome && !(history.state && history.state.sv)) history.pushState({ sv: 1 }, "");
    } else if (history.state && history.state.sv) {
      ignorePop = true; history.back();
    }
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", async () => {
    if (ignorePop) { ignorePop = false; return; }
    if (dialogClose) { dialogClose(); history.pushState({ sv: 1 }, ""); return; }
    if (sheetClose) { sheetClose(); history.pushState({ sv: 1 }, ""); return; }
    if (S.screen === "test") {
      history.pushState({ sv: 1 }, "");
      stopTest();
      return;
    }
    if (S.screen === "paste" && S.paste.preview) {   // 미리보기에서 뒤로가기 → 입력 화면 (붙여넣은 텍스트 유지)
      history.pushState({ sv: 1 }, "");
      S.paste.preview = null; render();
      return;
    }
    S.screen = "home"; render();
  });

  function render() {
    ({ home: renderHome, test: renderTest, result: renderResult, manage: renderManage, data: renderData, paste: renderPaste })[S.screen]();
  }

  // ─────────────────────────────────────────
  // 홈
  // ─────────────────────────────────────────
  function counts() {
    const t = today();
    return {
      total: S.words.length,
      fresh: S.words.filter((w) => (w.test_cnt || 0) === 0).length,
      wrong: S.words.filter((w) => (w.wrong_cnt || 0) > 0).length,
      relearn: S.words.filter((w) => (w.relearn || 0) > 0).length,
      due: S.words.filter((w) => C.isReviewDue(w, t)).length,
    };
  }
  function backupNotice() {
    if (!S.words.length) return "";
    const lb = S.meta.lastBackup;
    if (!lb) return `<div class="notice warn">아직 백업한 적이 없어요. <button data-go="data">백업하기</button></div>`;
    const days = C.diffDays(today(), lb.slice(0, 10));
    if (days >= 7) return `<div class="notice warn">마지막 백업이 ${days}일 전이에요. <button data-go="data">백업하기</button></div>`;
    return `<div class="notice">마지막 백업: ${days === 0 ? "오늘" : days + "일 전"}</div>`;
  }

  function renderHome() {
    const c = counts();
    if (S.testCount === null) S.testCount = c.due > 0 ? c.due : 10;
    $app.innerHTML = `
      <div class="brand"><h1>Smart Vocab</h1><small>${esc(C.APP_VERSION)}</small></div>
      ${S.readOnly ? `<div class="notice warn" style="margin:0 0 12px">단어장이 손상되어 저장이 막혀 있습니다. 백업 화면에서 백업 파일을 불러와 주세요.</div>` : ""}
      ${Store.mode === "local" ? `<div class="notice warn" style="margin:0 0 12px">이 브라우저는 IndexedDB를 쓸 수 없어 임시 저장소를 사용 중입니다. 백업을 자주 해주세요.</div>` : ""}
      <div class="stats">
        <div class="stat hero"><div class="l">오늘 복습</div><div class="n">${c.due}</div></div>
        <div class="stat relearn"><div class="n">${c.relearn}</div><div class="l">재학습 중</div></div>
        <div class="stat new"><div class="n">${c.fresh}</div><div class="l">미학습</div></div>
      </div>
      <div class="mini-stats"><span>전체 ${c.total}개</span><span>오답 기록 ${c.wrong}개</span></div>

      <div class="section-label">테스트</div>
      <div class="stepper">
        <div><div>문항 수</div>${c.due > 0 ? `<div class="hint">오늘 복습 추천 ${c.due}개</div>` : ""}</div>
        <div class="ctl">
          <button data-step="-1" aria-label="줄이기">−</button>
          <input id="count" type="number" inputmode="numeric" min="1" value="${S.testCount}" aria-label="문항 수">
          <button data-step="1" aria-label="늘리기">+</button>
        </div>
      </div>
      <div class="stack" style="margin-top:10px">
        <button class="btn primary" data-mode="normal">🔥 추천 복습 <span class="sub">망각 곡선</span></button>
        <button class="btn" data-mode="high_error">🎯 오답률 집중 테스트</button>
        <button class="btn" data-mode="new_only">✨ 새 단어 학습 <span class="sub">${c.fresh}개</span></button>
      </div>

      <div class="section-label">관리</div>
      <button class="btn soft" data-go="paste" style="margin-bottom:10px">📋 붙여넣기로 단어 추가</button>
      <div class="row2">
        <button class="btn soft" data-go="manage">단어 관리</button>
        <button class="btn soft" data-go="data">백업 · 가져오기</button>
      </div>
      ${backupNotice()}`;

    const $count = qs("#count");
    $count.addEventListener("change", () => { S.testCount = Math.max(1, parseInt($count.value, 10) || 1); $count.value = S.testCount; });
    $app.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      S.testCount = Math.max(1, (parseInt($count.value, 10) || 0) + +b.dataset.step); $count.value = S.testCount;
    }));
    $app.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      S.testCount = Math.max(1, parseInt($count.value, 10) || 1); startTest(b.dataset.mode);
    }));
    bindGo();
  }
  function bindGo() {
    $app.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  }

  // ─────────────────────────────────────────
  // 테스트
  // ─────────────────────────────────────────
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function startTest(mode) {
    if (!S.words.length) return alertBox("알림", "단어가 없습니다. 단어 관리에서 추가하거나 백업 화면에서 가져와 주세요.");
    const num = S.testCount;
    const fresh = S.words.filter((w) => (w.test_cnt || 0) === 0);
    let queue;
    if (mode === "new_only") {
      if (!fresh.length) return alertBox("알림", "새 단어가 없습니다.");
      queue = shuffle(fresh).slice(0, num);
    } else if (mode === "high_error") {
      const c = C.pickHighErrorWords(S.words);
      if (!c.length) return alertBox("알림", "오답 기록이 있는 단어가 없습니다.");
      queue = c.slice(0, num);
    } else {
      queue = C.pickReviewWords(S.words, today()).slice(0, num);
      const short = num - queue.length;
      if (short > 0 && fresh.length) {
        const fill = Math.min(short, fresh.length);
        const msg = queue.length ? `오늘 복습할 단어가 ${queue.length}개뿐입니다.\n나머지 ${fill}개를 새 단어로 채울까요?`
                                 : `오늘 복습할 단어가 없습니다.\n새 단어 ${fill}개로 테스트할까요?`;
        if (await confirmBox("알림", msg, "채우기", queue.length ? "복습만 하기" : "취소")) queue = queue.concat(shuffle(fresh).slice(0, fill));
      }
      if (!queue.length) return alertBox("알림", "오늘 복습할 단어가 없습니다.");
    }
    S.testCount = null;   // 홈으로 돌아오면 그때의 '오늘 복습' 수로 다시 추천
    S.test = { queue: shuffle(queue), idx: 0, wrong: [], practice: false, pq: [], attempts: 0, step: "ask", input: "" };
    go("test");
  }

  function startPractice() {
    const t = S.test;
    t.practice = true; t.pq = shuffle(t.wrong.slice()); t.attempts = 0; t.step = "ask"; t.input = "";
    go("test");
  }

  function currentWord() { const t = S.test; return t.practice ? t.pq[0] : t.queue[t.idx]; }

  function wordSize(s) { const n = [...s].length; return n <= 8 ? 44 : n <= 12 ? 36 : n <= 18 ? 28 : 22; }

  function testHeader() {
    const t = S.test;
    if (t.practice) {
      return `<div class="topbar"><button class="icon-btn" id="stop">✕ 그만</button>
        <span class="practice-tag">다시 풀기 · 기록 미반영</span><span style="flex:1"></span>
        <span class="counter">남은 ${t.pq.length}개</span></div>`;
    }
    const pct = Math.round((t.idx / t.queue.length) * 100);
    return `<div class="topbar"><button class="icon-btn" id="stop">✕ 중단</button>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <span class="counter">${t.idx + 1} / ${t.queue.length}</span></div>`;
  }

  function renderTest() {
    const t = S.test;
    if (!t.practice && t.idx >= t.queue.length) { S.screen = "result"; return render(); }
    if (t.practice && !t.pq.length) return finishPractice(true);
    const w = currentWord();
    const meta = t.practice ? "" : `<div class="word-meta">${esc(C.statusText(w))}${w.test_cnt ? ` · 오답 ${w.wrong_cnt}/${w.test_cnt}` : ""}</div>`;

    if (t.step === "ask") {
      $app.innerHTML = `${testHeader()}
        <div class="card"><div class="word" style="font-size:${wordSize(w.word)}px">${esc(w.word)}</div>${meta}</div>
        <form id="f" autocomplete="off">
          <input class="answer-input" id="ans" lang="ko" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false"
                 placeholder="뜻 입력 (비워도 됨)" value="${esc(t.input)}">
          <button class="btn primary" style="margin-top:10px">정답 확인</button>
        </form>`;
      const $ans = qs("#ans");
      guardSubmit(qs("#f"), [$ans], () => {
        if (S.screen !== "test" || t.step !== "ask") return;
        t.input = $ans.value.trim(); t.step = "judge"; $ans.blur(); render();
      });
      setTimeout(() => $ans.focus(), 30);
    } else {
      $app.innerHTML = `${testHeader()}
        <div class="card" style="padding:20px">
          <div class="word" style="font-size:${Math.min(28, wordSize(w.word))}px">${esc(w.word)}</div>
          <div class="compare">
            <div class="k">내 입력</div><div class="mine">${t.input ? esc(t.input) : "(미입력)"}</div>
            <div class="k">실제 뜻</div><div class="real">${esc(w.meaning)}</div>
            ${extrasHtml(w)}
          </div>
        </div>
        <div class="judge">
          <div class="row2">
            <button class="btn ok" id="ok">맞음</button>
            <button class="btn no" id="no">틀림</button>
          </div>
          <div class="kbd-hint">키보드 1 = 맞음, 2 = 틀림</div>
        </div>`;
      qs("#ok").addEventListener("click", () => judge(true));
      qs("#no").addEventListener("click", () => judge(false));
    }
    qs("#stop").addEventListener("click", stopTest);
  }

  const EXTRA_LABELS = { synonyms: "동의어", antonyms: "반의어", related: "관련어" };
  function extrasHtml(w) {
    const rows = Object.entries(EXTRA_LABELS).filter(([f]) => w[f])
      .map(([f, l]) => `<div class="ex"><span class="exk">${l}</span>${C.splitList(w[f]).map(esc).join(", ")}</div>`);
    if (w.note) rows.push(`<div class="ex"><span class="exk">메모</span>${esc(w.note)}</div>`);
    return rows.length ? `<div class="extras">${rows.join("")}</div>` : "";
  }

  document.addEventListener("keydown", (e) => {
    if (S.screen !== "test" || !S.test || S.test.step !== "judge" || dialogClose) return;
    if (e.key === "1") judge(true); else if (e.key === "2") judge(false);
  });

  let judging = false;
  async function judge(correct) {
    if (judging) return; judging = true;
    try {
      const t = S.test, w = currentWord();
      if (t.practice) {
        t.attempts++; C.applyPractice(w, correct);
        t.pq.shift(); if (!correct) t.pq.push(w);
      } else {
        C.applyAnswer(w, correct, today());
        if (!correct) t.wrong.push(w);
        t.idx++;
      }
      t.step = "ask"; t.input = "";
      await save();                 // 한 문제마다 바로 저장 (앱이 꺼져도 기록 유지)
      render();
    } finally { judging = false; }
  }

  async function stopTest() {
    const t = S.test;
    if (t.practice) return finishPractice(false);
    if (await confirmBox("테스트 중단", `여기서 그만할까요?\n지금까지 푼 ${t.idx}문제의 기록은 이미 저장되어 있습니다.`, "그만하기", "계속 풀기")) {
      if (t.wrong.length) { S.screen = "result"; t.stopped = true; render(); } else go("home");
    } else if (t.step === "ask") { const a = qs("#ans"); a && a.focus(); }
  }

  function finishPractice(completed) {
    const t = S.test;
    if (completed) toast(`모두 맞혔습니다! (총 ${t.attempts}번 풀이, 기록 미반영)`, 3000);
    S.test = null; go("home");
  }

  // ─────────────────────────────────────────
  // 결과
  // ─────────────────────────────────────────
  function renderResult() {
    const t = S.test, done = t.idx, score = done - t.wrong.length;
    $app.innerHTML = `
      <div class="topbar"><h1>테스트 결과</h1></div>
      <div class="score"><div class="big">${score}<span> / ${done}</span></div>
        <div class="cap">${t.stopped ? "중단됨 · " : ""}정답률 ${done ? Math.round((score / done) * 100) : 0}%</div></div>
      ${t.wrong.length ? `
        <div class="section-label">틀린 단어 ${t.wrong.length}개 <span style="font-weight:400">· 연속 ${C.RELEARN_REQUIRED}번 맞히면 재학습 졸업</span></div>
        <div class="list wrong-list">${t.wrong.map((w) => `<div class="item"><div class="w">${esc(w.word)}</div><div class="m">${esc(w.meaning)}</div></div>`).join("")}</div>
        <div class="stack" style="margin-top:16px">
          <button class="btn primary" id="retry">🔁 틀린 것만 다시 풀기 (${t.wrong.length}개)</button>
          <button class="btn" id="home">홈으로</button>
        </div>` : `
        <div class="empty">모두 맞혔어요 🎉</div>
        <button class="btn primary" id="home">홈으로</button>`}`;
    const r = qs("#retry"); r && r.addEventListener("click", startPractice);
    qs("#home").addEventListener("click", () => { S.test = null; go("home"); });
  }

  // ─────────────────────────────────────────
  // 단어 관리
  // ─────────────────────────────────────────
  const SORTS = ["최신순", "오답갯수순", "오답률순", "집중도순", "복습기한순", "단어순"];
  function filteredWords() {
    const q = S.manage.q.toLowerCase();
    const list = S.words.filter((w) => w.word.includes(q) || w.meaning.toLowerCase().includes(q));
    const by = {
      "최신순": (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
      "오답갯수순": (a, b) => (b.wrong_cnt || 0) - (a.wrong_cnt || 0),
      "오답률순": (a, b) => C.errorRate(b) - C.errorRate(a),
      "집중도순": (a, b) => (b.focus || 0) - (a.focus || 0),
      "복습기한순": (a, b) => (a.next_review || "9999").localeCompare(b.next_review || "9999"),
      "단어순": (a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
    }[S.manage.sort];
    return list.sort(by);   // Array.sort는 안정 정렬 → PC와 같은 순서
  }

  function itemHtml(w) {
    const t = today(), st = C.statusText(w);
    const cls = st === "신규" ? "new" : st.startsWith("재학습") ? "relearn" : "";
    const nd = C.parseDate(w.next_review);
    const due = nd && nd <= t;
    const meta = [w.test_cnt ? `오답 ${w.wrong_cnt}/${w.test_cnt}` : null, nd ? `다음 ${nd.slice(5)}` : null,
                  w.test_cnt ? `EF ${(+w.ef).toFixed(2)}` : null].filter(Boolean).join(" · ");
    return `<button class="item" data-id="${esc(w.id)}">
      <div class="top"><span class="w">${esc(w.word)}</span><span class="badge ${cls}">${esc(st)}</span>
        ${due ? `<span class="badge due">복습</span>` : ""}${w.focus > 0 ? `<span class="badge focus">집중 ${(+w.focus).toFixed(1)}</span>` : ""}</div>
      <div class="m">${esc(w.meaning)}</div>${meta ? `<div class="meta">${meta}</div>` : ""}</button>`;
  }

  function renderManage() {
    $app.innerHTML = `
      <div class="topbar"><button class="icon-btn" data-go="home">← 홈</button><h1>단어 관리 <small style="color:var(--text-3);font-weight:400">${S.words.length}</small></h1>
        <button class="icon-btn" id="add" style="color:var(--accent);font-weight:700">＋ 추가</button></div>
      <div class="search">
        <input id="q" type="search" placeholder="🔍 단어 또는 뜻 검색" value="${esc(S.manage.q)}" autocomplete="off">
        <select id="sort" aria-label="정렬">${SORTS.map((s) => `<option ${s === S.manage.sort ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      <div class="list" id="list"></div>`;
    const drawList = () => {
      const all = filteredWords(), shown = all.slice(0, S.manage.limit);
      qs("#list").innerHTML = (shown.length ? shown.map(itemHtml).join("") : `<div class="empty">${S.words.length ? "검색 결과가 없습니다" : "단어가 없습니다. ＋ 추가를 눌러 시작하세요"}</div>`)
        + (all.length > shown.length ? `<button class="btn small" id="more" style="margin-top:4px">더 보기 (${all.length - shown.length}개 남음)</button>` : "");
      const m = qs("#more"); m && m.addEventListener("click", () => { S.manage.limit += 200; drawList(); });
    };
    drawList();
    qs("#q").addEventListener("input", (e) => { S.manage.q = e.target.value; S.manage.limit = 100; drawList(); });
    qs("#sort").addEventListener("change", (e) => { S.manage.sort = e.target.value; drawList(); });
    qs("#list").addEventListener("click", (e) => { const it = e.target.closest(".item[data-id]"); if (it) openEditor(it.dataset.id); });
    qs("#add").addEventListener("click", () => openEditor(null));
    bindGo();
    S.manage.redraw = drawList;
  }

  let sheetClose = null;
  function openEditor(id) {
    const w = id ? S.words.find((x) => x.id === id) : null;
    const ov = document.createElement("div"); ov.className = "overlay";
    const detail = w ? `<div class="detail">
        <div><b>${w.test_cnt}</b><small>출제</small></div><div><b>${w.wrong_cnt}</b><small>오답</small></div>
        <div><b>${w.test_cnt ? Math.round(C.errorRate(w) * 1000) / 10 + "%" : "-"}</b><small>오답률</small></div>
        <div><b>${esc(C.statusText(w))}</b><small>상태</small></div><div><b>${w.interval}일</b><small>주기</small></div>
        <div><b>${(+w.ef).toFixed(2)}</b><small>EF</small></div>
        <div><b>${(+w.focus).toFixed(1)}</b><small>집중도</small></div>
        <div><b>${w.next_review ? esc(w.next_review.slice(0, 10)) : "-"}</b><small>다음 복습</small></div>
        <div><b style="font-size:13px">${w.last_tested ? esc(w.last_tested.slice(2)) : "-"}</b><small>최근 학습</small></div></div>` : "";
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <h2>${w ? "단어 수정" : "단어 추가"}</h2>
      <form id="ef" autocomplete="off">
        <label class="field"><span>단어</span><input id="ew" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" value="${w ? esc(w.word) : ""}"></label>
        <label class="field"><span>뜻</span><input id="em" lang="ko" enterkeyhint="done" value="${w ? esc(w.meaning) : ""}"></label>
        <details class="more" ${w && C.EXTRA_FIELDS.some((f) => w[f]) ? "open" : ""}>
          <summary>동의어 · 반의어 · 관련어 · 메모</summary>
          ${Object.entries(EXTRA_LABELS).map(([f, l]) => `<label class="field"><span>${l} <small>(쉼표로 구분)</small></span><input data-x="${f}" autocapitalize="off" autocorrect="off" spellcheck="false" value="${w ? esc(C.splitList(w[f]).join(", ")) : ""}"></label>`).join("")}
          <label class="field"><span>메모</span><input data-x="note" lang="ko" value="${w ? esc(w.note || "") : ""}"></label>
        </details>
        ${detail}
        <div class="row2"><button type="button" class="btn" id="ecancel">닫기</button><button class="btn primary">${w ? "수정 저장" : "추가"}</button></div>
        ${w ? `<div class="row2" style="margin-top:10px"><button type="button" class="btn small danger" id="ereset">기록 초기화</button><button type="button" class="btn small danger" id="edel">삭제</button></div>` : ""}
      </form></div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); sheetClose = null; S.manage.redraw && S.manage.redraw(); };
    sheetClose = close;
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    qs("#ecancel", ov).addEventListener("click", close);
    const $w = qs("#ew", ov), $m = qs("#em", ov);
    $w.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); $m.focus(); } });
    if (!w) setTimeout(() => $w.focus(), 50);

    guardSubmit(qs("#ef", ov), [$w, $m], async () => {
      const word = $w.value.trim().toLowerCase(), meaning = $m.value.trim();
      const extras = {};
      ov.querySelectorAll("[data-x]").forEach((i) => { extras[i.dataset.x] = i.dataset.x === "note" ? i.value.trim() : C.normList(i.value); });
      const clearInputs = () => { $w.value = ""; $m.value = ""; ov.querySelectorAll("[data-x]").forEach((i) => { i.value = ""; }); $w.focus(); };
      if (!word || !meaning) return toast("단어와 뜻을 모두 입력해 주세요");
      const dup = S.words.find((x) => x.word === word && x.id !== (w && w.id));
      if (dup) {
        if (w) return alertBox("중복", `'${word}'은(는) 이미 다른 항목으로 있습니다.\n(뜻: ${dup.meaning})`);
        if (await confirmBox("중복 단어", `'${word}'은(는) 이미 있습니다.\n기존 뜻: ${dup.meaning}\n\n입력한 뜻으로 기존 단어를 수정할까요?\n(학습 기록은 유지됩니다)`, "수정", "취소")) {
          dup.meaning = meaning; C.mergeExtras(dup, extras); await save(); toast(`수정됨: ${word}`);
          clearInputs();
        }
        return;
      }
      if (w) { w.word = word; w.meaning = meaning; Object.assign(w, extras); await save(); toast("저장했습니다"); close(); }
      else {
        S.words.unshift(Object.assign(C.newWord(word, meaning), extras)); await save(); toast(`추가됨: ${word}`);
        clearInputs();          // 연속 입력
        S.manage.redraw && S.manage.redraw();
        const h = qs(".topbar small"); if (h) h.textContent = S.words.length;
      }
    });
    if (w) {
      qs("#edel", ov).addEventListener("click", async () => {
        if (!(await confirmBox("삭제", `'${w.word}'을(를) 삭제할까요?`, "삭제", "취소", true))) return;
        S.words = S.words.filter((x) => x.id !== w.id); await save(); toast("삭제했습니다"); close();
        const h = qs(".topbar small"); if (h) h.textContent = S.words.length;
      });
      qs("#ereset", ov).addEventListener("click", async () => {
        if (!(await confirmBox("기록 초기화", `'${w.word}'의 학습 기록을 모두 지울까요?`, "초기화", "취소", true))) return;
        Object.assign(w, { test_cnt: 0, wrong_cnt: 0, correct_cnt: 0, ef: C.EF_DEFAULT, interval: 0, reps: 0, relearn: 0, focus: 0, next_review: null, last_tested: null });
        await save(); toast("초기화했습니다"); close();
      });
    }
  }

  // ─────────────────────────────────────────
  // 백업 · 가져오기
  // ─────────────────────────────────────────
  function stamp() { const n = new Date(); return C.todayStr(n).replace(/-/g, "") + "_" + String(n.getHours()).padStart(2, "0") + String(n.getMinutes()).padStart(2, "0"); }

  async function deliverFile(name, text, type, how) {
    const blob = new Blob([text], { type });
    if (how === "share") {
      const file = new File([blob], name, { type });
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e && e.name === "AbortError") return false; toast("공유할 수 없어 파일로 저장합니다"); }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  }
  const canShareFiles = () => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.json", { type: "application/json" })] })); } catch (e) { return false; } };

  async function exportJson(how) {
    const ok = await deliverFile(`vocab_data_android_${stamp()}.json`, JSON.stringify(S.words, null, 4), "application/json", how);
    if (ok) { S.meta.lastBackup = C.nowStr(); await saveMeta(); toast("백업 파일을 만들었습니다"); renderData(); }
  }

  function pickFile(multiple = false) {
    return new Promise((resolve) => {
      const inp = document.createElement("input"); inp.type = "file"; inp.multiple = multiple;
      inp.addEventListener("change", () => resolve(multiple ? [...inp.files] : inp.files[0] || null));
      inp.click();
    });
  }
  async function readText(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder("euc-kr").decode(buf); } catch (e2) { return null; } }
  }

  async function importJson() {
    const f = await pickFile(); if (!f) return;
    const text = await readText(f);
    let incoming;
    try { if (text === null) throw new Error("파일 인코딩을 읽을 수 없습니다."); incoming = C.normalizeAll(C.parseWordsJson(text)); }
    catch (e) { return alertBox("불러오기 실패", e.message); }
    let choice = "replace";
    if (S.words.length && !S.readOnly) {
      choice = await dialog({
        title: "단어장 교체",
        msg: `지금 이 기기의 단어장(${S.words.length}개)을 지우고\n파일의 단어장(${incoming.length}개)으로 바꿉니다.\n\n바꾸기 전에 현재 단어장을 백업 파일로 저장할까요?`,
        buttons: [{ label: "백업 후 교체", value: "backup", kind: "primary" }, { label: "그냥 교체", value: "replace", kind: "danger" }, { label: "취소", value: null }],
      });
      if (!choice) return;
      if (choice === "backup") await deliverFile(`vocab_data_android_교체전_${stamp()}.json`, JSON.stringify(S.words, null, 4), "application/json", "download");
    }
    S.words = incoming; S.readOnly = false; S.testCount = null;
    await save(); toast(`${incoming.length}개 단어로 교체했습니다`); renderData();
  }

  async function importCsv() {
    const files = await pickFile(true); if (!files || !files.length) return;
    files.sort((a, b) => a.name.localeCompare(b.name));          // 날짜별 파일이면 날짜 순서대로
    const lines = []; let totalAdded = 0, totalFilled = 0;
    for (const f of files) {
      const text = await readText(f);
      if (text === null) { lines.push(`• ${f.name}: 인코딩을 읽을 수 없음`); continue; }
      const { added, dup, bad, fills } = C.parseCsvText(text, S.words);
      let filled = 0;
      for (const [w, extra] of fills) if (C.mergeExtras(w, extra)) filled++;   // 학습 기록·뜻은 그대로, 동의어 등만 보충
      S.words = S.words.concat(added);
      totalAdded += added.length; totalFilled += filled;
      lines.push(`• ${f.name}: 추가 ${added.length}, 이미 있음 ${dup}${filled ? ` (보충 ${filled})` : ""}${bad ? `, 오류 ${bad}줄` : ""}`);
    }
    if (totalAdded || totalFilled) await save();
    alertBox("가져오기 결과", `추가: ${totalAdded}개 · 동의어 등 보충: ${totalFilled}개\n\n${lines.join("\n")}`);
    renderData();
  }

  // ─────────────────────────────────────────
  // 붙여넣기로 단어 추가 (Claude가 정리해 준 텍스트 → 미리보기 → 추가)
  // ─────────────────────────────────────────
  S.paste = { text: "", preview: null };

  function buildPreview(text) {
    const { added, dup, bad, fills } = C.parseCsvText(text, S.words);
    const rows = added.map((w) => ({ kind: "new", w, on: true }));       // (가) 동의어 단어도 기본으로 포함
    for (const [w, extra] of fills) {
      const probe = JSON.parse(JSON.stringify(w));
      rows.push({ kind: C.mergeExtras(probe, extra) ? "fill" : "same", w, extra, on: true, preview: probe });
    }
    return { rows, dup, bad };
  }

  function renderPaste() {
    const P = S.paste;
    if (!P.preview) {
      $app.innerHTML = `
        <div class="topbar"><button class="icon-btn" data-go="home">← 홈</button><h1>붙여넣기로 단어 추가</h1></div>
        <p class="desc" style="margin:0 4px 10px">Claude가 정리해 준 단어 텍스트를 그대로 붙여넣으세요. 추가하기 전에 미리보기로 확인할 수 있어요.</p>
        <textarea id="ptext" class="paste-box" spellcheck="false" autocapitalize="off" placeholder="word,meaning,synonyms,antonyms,related,note&#10;swift,신속한,prompt,,,&#10;prompt,&quot;신속한, 즉각적인&quot;,swift,,,">${esc(P.text)}</textarea>
        <div class="row2" style="margin-top:10px">
          <button class="btn" id="pclip">클립보드 붙여넣기</button>
          <button class="btn primary" id="pgo">미리보기</button>
        </div>`;
      bindGo();
      const $t = qs("#ptext");
      $t.addEventListener("input", () => { P.text = $t.value; });
      qs("#pclip").addEventListener("click", async () => {
        try { const t = await navigator.clipboard.readText(); if (t) { $t.value = P.text = t; toast("붙여넣었습니다"); } else toast("클립보드가 비어 있어요"); }
        catch (e) { toast("클립보드를 읽을 수 없어요. 입력칸을 길게 눌러 붙여넣어 주세요"); $t.focus(); }
      });
      qs("#pgo").addEventListener("click", () => {
        P.text = $t.value;
        if (!P.text.trim()) return toast("붙여넣은 내용이 없어요");
        const pv = buildPreview(P.text);
        if (!pv.rows.length) return alertBox("읽을 수 있는 단어가 없어요", `단어와 뜻이 쉼표로 구분된 텍스트인지 확인해 주세요.${pv.bad ? `\n(형식 오류 ${pv.bad}줄)` : ""}`);
        P.preview = pv; renderPaste(); window.scrollTo(0, 0);
      });
      return;
    }

    const pv = P.preview;
    const nNew = pv.rows.filter((r) => r.kind === "new").length, nFill = pv.rows.filter((r) => r.kind === "fill").length;
    const extraLine = (w) => [["synonyms", "동"], ["antonyms", "반"], ["related", "관"]].filter(([f]) => w[f])
      .map(([f, l]) => `<span class="tag">${l}</span>${C.splitList(w[f]).map(esc).join(", ")}`).join(" ");
    $app.innerHTML = `
      <div class="topbar"><button class="icon-btn" id="pback">← 다시 입력</button><h1>미리보기</h1></div>
      <div class="notice" style="margin:0 0 10px">새 단어 ${nNew}개${nFill ? ` · 이미 있는 단어 ${nFill}개에 동의어 등 보충` : ""}${pv.bad ? ` · 형식 오류 ${pv.bad}줄 제외` : ""}${!nNew && !nFill ? " · 반영할 내용이 없어요" : ""}</div>
      <div class="list" id="plist">${pv.rows.map((r, i) => r.kind === "same" ? "" : r.kind === "new" ? `
        <div class="item prow"><label class="pcheck"><input type="checkbox" data-i="${i}" ${r.on ? "checked" : ""}>
          <span class="w">${esc(r.w.word)}</span><span class="badge new">새 단어</span></label>
          <input class="pmean" data-m="${i}" lang="ko" value="${esc(r.w.meaning)}" aria-label="${esc(r.w.word)} 뜻">
          ${extraLine(r.w) ? `<div class="meta">${extraLine(r.w)}</div>` : ""}${r.w.note ? `<div class="meta">메모 · ${esc(r.w.note)}</div>` : ""}</div>` : `
        <div class="item prow ${r.kind === "same" ? "dim" : ""}"><label class="pcheck"><input type="checkbox" data-i="${i}" ${r.on && r.kind === "fill" ? "checked" : ""} ${r.kind === "same" ? "disabled" : ""}>
          <span class="w">${esc(r.w.word)}</span><span class="badge">${r.kind === "fill" ? "이미 있음 · 보충" : "이미 있음 · 변경 없음"}</span></label>
          <div class="m">${esc(r.w.meaning)} <small style="color:var(--text-3)">(뜻·학습 기록 유지)</small></div>
          ${r.kind === "fill" && extraLine(r.preview) ? `<div class="meta">${extraLine(r.preview)}</div>` : ""}</div>`).join("")}
      </div>
      ${pv.rows.some((r) => r.kind === "same") ? `<p class="desc">이미 있고 바뀔 내용이 없는 단어 ${pv.rows.filter((r) => r.kind === "same").length}개: ${pv.rows.filter((r) => r.kind === "same").map((r) => esc(r.w.word)).join(", ")}</p>` : ""}
      <div class="judge"><button class="btn primary" id="padd"></button></div>`;
    const count = () => pv.rows.filter((r) => r.on && r.kind !== "same").length;
    const label = () => { const n = count(); const b = qs("#padd"); b.textContent = n ? `선택한 ${n}개 반영` : "선택한 단어가 없어요"; b.disabled = !n; };
    pv.rows.forEach((r) => { if (r.kind === "same") r.on = false; });
    label();
    qs("#plist").addEventListener("change", (e) => {
      const i = e.target.dataset.i; if (i !== undefined) { pv.rows[+i].on = e.target.checked; label(); }
    });
    qs("#plist").addEventListener("input", (e) => {
      const i = e.target.dataset.m; if (i !== undefined) pv.rows[+i].w.meaning = e.target.value;
    });
    qs("#pback").addEventListener("click", () => { P.preview = null; renderPaste(); });
    qs("#padd").addEventListener("click", async () => {
      const empty = pv.rows.filter((r) => r.on && r.kind === "new" && !r.w.meaning.trim());
      if (empty.length) return alertBox("뜻이 비어 있어요", `${empty.map((r) => r.w.word).join(", ")}의 뜻을 입력하거나 체크를 해제해 주세요.`);
      let added = 0, filled = 0;
      const now = new Date();
      for (const r of pv.rows) {
        if (!r.on) continue;
        if (r.kind === "new") {
          if (S.words.some((x) => x.word === r.w.word)) continue;
          r.w.meaning = r.w.meaning.trim();
          r.w.created_at = C.nowStrSec(new Date(now.getTime() + added * 1000));
          S.words.push(r.w); added++;
        } else if (r.kind === "fill" && C.mergeExtras(r.w, r.extra)) filled++;
      }
      if (added || filled) await save();
      S.paste = { text: "", preview: null }; S.testCount = null;
      toast(`새 단어 ${added}개 추가${filled ? ` · ${filled}개 보충` : ""}`, 3000);
      go("home");
    });
  }

  function renderData() {
    if (S.screen !== "data") return;
    const share = canShareFiles();
    const persist = S.persisted === true ? "보호됨 (브라우저가 임의로 지우지 않음)" : S.persisted === false ? "보호 안 됨 — 홈 화면에 앱으로 설치하면 보호될 가능성이 높아요" : "확인 불가";
    $app.innerHTML = `
      <div class="topbar"><button class="icon-btn" data-go="home">← 홈</button><h1>백업 · 가져오기</h1></div>
      <div class="data-info">
        이 기기의 단어장: <b>${S.words.length}개</b><br>
        저장 공간: ${Store.mode === "idb" ? "IndexedDB" : "localStorage(임시)"} · ${persist}<br>
        마지막 백업: <b>${S.meta.lastBackup ? esc(S.meta.lastBackup) : "없음"}</b>
      </div>

      <div class="section-label">백업 (JSON · PC 버전과 같은 형식)</div>
      <div class="${share ? "row2" : "stack"}">
        <button class="btn primary" id="exj">파일로 저장</button>
        ${share ? `<button class="btn" id="shj">공유하기 <span class="sub">카톡·드라이브</span></button>` : ""}
      </div>
      <p class="desc">PC에서 쓰려면 받은 파일 이름을 <b>vocab_data.json</b>으로 바꿔 PC 버전 폴더에 넣으면 됩니다. (PC 단어장은 덮어써지니 주의)</p>

      <div class="section-label">불러오기</div>
      <div class="stack">
        <button class="btn" id="imj">JSON 불러오기 <span class="sub">단어장 교체</span></button>
        <button class="btn" id="imc">CSV 가져오기 <span class="sub">여러 개 선택 가능</span></button>
        <button class="btn" data-go="paste">📋 붙여넣기로 단어 추가</button>
      </div>
      <p class="desc">PC의 vocab_data.json을 폰으로 옮겨 불러오면 그대로 이어서 쓸 수 있어요. 두 단어장을 합치는 기능은 아직 없어서, 불러오면 이 기기 단어장이 교체됩니다.</p>

      <div class="section-label">내보내기</div>
      <button class="btn" id="exc">CSV 내보내기 <span class="sub">학습 기록 포함</span></button>`;
    bindGo();
    qs("#exj").addEventListener("click", () => exportJson("download"));
    const sh = qs("#shj"); sh && sh.addEventListener("click", () => exportJson("share"));
    qs("#imj").addEventListener("click", importJson);
    qs("#imc").addEventListener("click", importCsv);
    qs("#exc").addEventListener("click", () => deliverFile(`vocab_export_${stamp()}.csv`, C.wordsToCsv(S.words), "text/csv", "download"));
  }

  // ─────────────────────────────────────────
  // 시작
  // ─────────────────────────────────────────
  async function boot() {
    await Store.open();
    let words, prev;
    try { words = await Store.get("words"); } catch (e) { words = undefined; }
    S.meta = (await Store.get("meta").catch(() => null)) || {};
    const valid = (x) => Array.isArray(x) && x.every((w) => w && typeof w === "object" && "word" in w && "meaning" in w);

    if (words === undefined) {
      S.words = [];
    } else if (valid(words)) {
      S.words = C.normalizeAll(words);
    } else {
      try { prev = await Store.get("words_prev"); } catch (e) { prev = undefined; }
      if (valid(prev)) {
        S.words = C.normalizeAll(prev);
        await Store.put("words_corrupt_" + stamp(), words).catch(() => {});
        await save();
        alertBox("복구 완료", "단어장이 손상되어 직전 저장본에서 복구했습니다.");
      } else {
        S.words = []; S.readOnly = true;
        alertBox("단어장 손상", "단어장을 읽을 수 없고 직전 저장본도 없습니다.\n원본 보호를 위해 저장이 막혀 있습니다.\n백업 화면에서 JSON 백업을 불러와 주세요.");
      }
    }

    if (navigator.storage && navigator.storage.persist) {
      try { S.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { S.persisted = null; }
    }
    render();

    // 날짜가 바뀐 채로 앱을 다시 열면 통계 갱신
    document.addEventListener("visibilitychange", () => { if (!document.hidden && S.screen === "home") render(); });
    registerSW();
  }

  // ── 오프라인 동작 + 업데이트 안내 ──
  function registerSW() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const offer = (sw) => {
        if (document.querySelector(".update-bar")) return;
        const bar = document.createElement("div"); bar.className = "update-bar";
        bar.innerHTML = `새 버전이 준비됐어요<button>업데이트</button>`;
        bar.querySelector("button").addEventListener("click", () => sw.postMessage("skipWaiting"));
        document.body.appendChild(bar);
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw && sw.addEventListener("statechange", () => { if (sw.state === "installed" && navigator.serviceWorker.controller) offer(sw); });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded || S.screen === "test") return;   // 테스트 중엔 새로고침하지 않음
      reloaded = true; location.reload();
    });
  }

  boot();
})();
