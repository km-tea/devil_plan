/* 공통 플랫폼: 게임 목록 · 방 만들기/입장 · 서버 동기화(폴링) · 타이머
   게임별 화면은 js/games/*.js 에서 App.registerGame()으로 등록합니다. */
(function () {
  'use strict';
  const GAMES = [];
  const S = {
    screen: 'home', gameId: null, settings: {}, joining: false,
    name: lsGet('dp_name') || '',
    session: null, v: -1, view: null, sig: '',
    offset: 0, busy: false, fails: 0, timer: null, deadline: null,
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const $ = (s) => document.querySelector(s);
  const now = () => Date.now() + S.offset; // 서버 시계에 맞춘 현재 시각
  const gameById = (id) => GAMES.find((g) => g.id === id);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(body) {
    let res;
    try {
      res = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { const err = new Error('인터넷 연결을 확인해 주세요'); err.status = 0; throw err; }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 빈 응답 */ }
    if (!res.ok) { const err = new Error(data.error || '문제가 생겼어요'); err.status = res.status; throw err; }
    return data;
  }

  /* ---------- 타이머 (화면 갱신 없이 숫자만 갱신) ---------- */
  function timer(end, total) {
    return h('div', { class: 'timer', 'data-end': end, 'data-total': total },
      h('span', { class: 't' }, '0:00'), h('div', { class: 'bar' }, h('i')));
  }
  function tickTimers() {
    const t = now();
    document.querySelectorAll('[data-end]').forEach((el) => {
      const total = +el.dataset.total || 0;
      const left = Math.max(0, +el.dataset.end - t);
      const s = Math.ceil(left / 1000);
      const txt = el.querySelector('.t');
      if (txt) txt.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      const bar = el.querySelector('.bar > i');
      if (bar && total) { bar.style.width = Math.min(100, (left / total) * 100) + '%'; bar.classList.toggle('low', left < 10000); }
    });
    document.querySelectorAll('[data-count]').forEach((el) => {
      el.textContent = Math.max(0, Math.ceil((+el.dataset.count - t) / 1000));
    });
  }
  setInterval(tickTimers, 250);

  /* ---------- 서버 동기화 ---------- */
  function applyState(serverNow, v, view) {
    S.offset = serverNow - Date.now();
    S.v = v; S.view = view;
    const sig = JSON.stringify(view);
    if (sig !== S.sig) { S.sig = sig; render(); }
    scheduleDeadline();
  }

  function nextDelay() {
    const p = S.view && S.view.phase;
    let d = p === 'memorize' ? 1500 : p === 'select' ? 2000 : 2500;
    const g = S.session && gameById(S.session.game);
    if (g && g.pollMs) d = g.pollMs(S.view);
    if (document.hidden) d = 8000;
    d *= 0.8 + Math.random() * 0.4;                      // 학생들이 같은 순간에 몰리지 않게 흩뿌림
    if (S.fails) d = Math.min(10000, d * (1 + S.fails)); // 오류가 나면 점점 천천히
    return d;
  }

  async function pollNow() {
    clearTimeout(S.timer);
    if (S.busy || !S.session) return;
    S.busy = true;
    try {
      const r = await api({ action: 'state', code: S.session.code, token: S.session.token, v: S.v });
      S.fails = 0; document.body.classList.remove('offline');
      if (r.unchanged) S.offset = r.now - Date.now();
      else applyState(r.now, r.v, r.view);
    } catch (e) {
      if (e.status === 404 || e.status === 403) { toast('방이 사라졌어요. 처음 화면으로 돌아가요'); leave(); return; }
      S.fails++; document.body.classList.add('offline');
    } finally {
      S.busy = false;
      if (S.session) S.timer = setTimeout(pollNow, nextDelay());
    }
  }

  // 단계가 끝나는 순간에 맞춰 한 번 더 확인 (다음 단계로 바로 넘어가도록)
  function scheduleDeadline() {
    clearTimeout(S.deadline);
    const v = S.view;
    if (!v) return;
    let at = null;
    if (v.deadline) at = v.deadline;
    else if (v.phase === 'memorize' && !v.deck) at = v.startsAt;
    else if (v.phase === 'memorize' || v.phase === 'select') at = v.phaseEndsAt;
    if (at) S.deadline = setTimeout(pollNow, Math.max(0, at - now()) + 300 + Math.random() * 500);
  }

  async function send(action, payload) {
    try {
      const r = await api({ action, code: S.session.code, token: S.session.token, payload: payload || {} });
      applyState(r.now, r.v, r.view);
      return r.response || {};
    } catch (e) {
      toast(e.message);
      if (e.status === 404 || e.status === 403) leave();
      return null;
    }
  }

  /* ---------- 방 입장/퇴장 ---------- */
  function enterRoom(session) {
    S.session = session; lsSet('dp_session', JSON.stringify(session));
    S.v = -1; S.view = null; S.sig = ''; S.fails = 0;
    S.screen = 'room'; render(); pollNow();
  }
  function leave() {
    clearTimeout(S.timer); clearTimeout(S.deadline);
    S.session = null; S.view = null; S.sig = ''; S.joining = false;
    lsSet('dp_session', null);
    $('#modal-root').replaceChildren();
    document.body.classList.remove('offline');
    S.screen = S.gameId ? 'game' : 'home';
    render();
  }
  function needName() {
    if (S.name.trim()) return true;
    toast('이름을 먼저 써 주세요'); window.scrollTo(0, 0);
    const i = $('#name'); if (i) i.focus();
    return false;
  }
  async function createRoom(mode) {
    if (!needName()) return;
    try {
      const r = await api({ action: 'create', game: S.gameId, mode, name: S.name.trim(), settings: S.settings });
      enterRoom({ code: r.code, token: r.token, pid: r.pid, game: r.game });
    } catch (e) { toast(e.message); }
  }
  async function joinRoom() {
    if (!needName()) return;
    const code = ($('#code').value || '').trim();
    if (!/^\d{4}$/.test(code)) return toast('숫자 4자리를 입력해 주세요');
    try {
      const r = await api({ action: 'join', code, name: S.name.trim() });
      enterRoom({ code: r.code, token: r.token, pid: r.pid, game: r.game });
    } catch (e) { toast(e.message); }
  }

  /* ---------- 화면 ---------- */
  function homeScreen() {
    return h('main', { class: 'wrap' },
      h('header', { class: 'hero' },
        h('h1', {}, '데블스 플랜 & 더 지니어스'),
        h('p', {}, '공부로 얻은 힌트를 들고 승부하는 교실 두뇌 게임')),
      h('label', { class: 'field' }, h('span', {}, '내 이름'),
        h('input', { id: 'name', maxlength: 8, value: S.name, placeholder: '이름 (8글자까지)', autocomplete: 'off',
          oninput: (e) => { S.name = e.target.value; lsSet('dp_name', S.name); } })),
      h('section', { class: 'games' },
        GAMES.map((g) => h('button', { class: 'gamecard', onclick: () => { if (!needName()) return; S.gameId = g.id; S.screen = 'game'; render(); } },
          h('span', { class: 'suits' }, g.icon ? g.icon.map((c, i) => h('span', { class: i === 1 ? 'r' : '' }, c)) : [h('span', {}, '♠'), h('span', { class: 'r' }, '♥'), h('span', { class: 'r' }, '♦'), h('span', {}, '♣')]),
          h('strong', {}, g.name), h('span', { class: 'tagline' }, g.tagline),
          h('span', { class: 'tags' }, g.tags.map((t) => h('em', {}, t))))),
        h('div', { class: 'gamecard soon' }, h('strong', {}, '다음 게임'), h('span', { class: 'tagline' }, '곧 추가돼요'))));
  }

  function gameScreen() {
    const g = gameById(S.gameId);
    const fields = (g.settings || []).map((f) => {
      const opts = typeof f.options === 'function' ? f.options(S.settings) : f.options; // 다른 설정에 따라 달라지는 선택지
      if (S.settings[f.key] == null || !opts.some(([val]) => val === S.settings[f.key])) S.settings[f.key] = opts[0][0];
      return h('div', { class: 'field' }, h('span', {}, f.label),
        h('div', { class: 'seg' }, opts.map(([val, label]) =>
          h('button', { class: S.settings[f.key] === val ? 'on' : '', onclick: () => { S.settings[f.key] = val; render(); } }, label))));
    });
    const join = S.joining
      ? h('div', { class: 'joinrow' },
          h('input', { id: 'code', inputmode: 'numeric', maxlength: 4, placeholder: '0000', autocomplete: 'off',
            onkeydown: (e) => { if (e.key === 'Enter') joinRoom(); } }),
          h('button', { class: 'primary', onclick: joinRoom }, '입장'))
      : null;
    if (S.joining) setTimeout(() => { const c = $('#code'); if (c) c.focus(); });
    return h('main', { class: 'wrap' },
      h('button', { class: 'ghost', onclick: () => { S.screen = 'home'; S.gameId = null; S.joining = false; render(); } }, '← 게임 목록'),
      h('h2', {}, g.name),
      h('p', { class: 'hintline', style: 'text-align:left' }, g.tagline),
      h('div', { class: 'panel' }, h('ol', { class: 'rules' }, g.rules.map((r) => h('li', {}, r)))),
      fields,
      h('div', { class: 'btn-row' },
        h('button', { class: 'primary', onclick: () => createRoom('pvp') }, '👥 방 만들기'),
        h('button', { class: 'primary', onclick: () => { S.joining = !S.joining; render(); } }, '🔑 번호로 입장'),
        h('button', { class: 'ghost', onclick: () => createRoom('cpu') }, '🤖 컴퓨터와 연습')),
      join);
  }

  function roomScreen() {
    const v = S.view, g = gameById(S.session.game);
    const body = h('div', {});
    if (!g) body.append(h('p', { class: 'center' }, '이 게임을 찾을 수 없어요.'));
    else if (!v) body.append(h('p', { class: 'center' }, '불러오는 중…'));
    else if (v.phase === 'waiting') {
      body.append(h('div', { class: 'center' },
        h('h2', {}, '친구를 기다리는 중'),
        h('p', { class: 'hintline' }, '친구에게 이 번호를 알려 주세요. 친구가 입장하면 바로 시작돼요.'),
        h('div', { class: 'codebig' }, S.session.code.split('').map((d) => h('span', {}, d)))));
    } else {
      const ctx = { send, view: () => S.view, now, toast, h, timer, rerender: render, modalRoot: $('#modal-root') };
      g.render(body, v, ctx);
    }
    return h('main', { class: 'wrap wide' },
      h('div', { class: 'topbar' },
        h('button', { class: 'ghost', onclick: () => { if (confirm('방에서 나갈까요?')) leave(); } }, '← 나가기'),
        h('span', { class: 'net' }, '연결이 불안정해요…'),
        h('span', { class: 'roomtag' }, '방 번호 ', h('b', {}, S.session.code))),
      body);
  }

  function render() {
    const app = $('#app');
    app.replaceChildren(S.screen === 'room' ? roomScreen() : S.screen === 'game' ? gameScreen() : homeScreen());
    tickTimers();
  }

  function start() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.session) pollNow(); });
    try {
      const s = JSON.parse(lsGet('dp_session') || 'null');
      if (s && s.code && s.token && gameById(s.game)) { S.session = s; S.gameId = s.game; S.screen = 'room'; }
    } catch (e) { /* 저장값 오류는 무시 */ }
    render();
    if (S.session) pollNow();
  }

  window.App = { registerGame: (g) => GAMES.push(g), h, start, toast, now, timer };
})();
