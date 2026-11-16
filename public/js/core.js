/* 공통 플랫폼: 게임 목록 · 방 만들기/입장 · 서버 동기화(폴링) · 타이머
   게임별 화면은 js/games/*.js 에서 App.registerGame()으로 등록합니다. */
(function () {
  'use strict';
  const GAMES = [];
  const S = {
    screen: 'home', gameId: null, settings: {}, joining: false,
    auth: loadAuth(), tauth: lsGet('dp_tauth') || '', // 학생 로그인(이름·번호·열쇠) / 교사 열쇠
    session: null, v: -1, view: null, sig: '',
    offset: 0, busy: false, fails: 0, timer: null, deadline: null,
  };

  function loadAuth() { try { const a = JSON.parse(localStorage.getItem('dp_auth') || 'null'); return a && a.token ? a : null; } catch (e) { return null; } }
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
  function needAuth() {
    if (S.auth) return true;
    toast('먼저 로그인해 주세요'); S.screen = 'login'; render();
    return false;
  }
  function studentLogout(msg) {
    const token = S.auth && S.auth.token;
    if (token) api({ action: 'logout', auth: token }).catch(() => {});
    S.auth = null; lsSet('dp_auth', null);
    clearTimeout(S.timer); clearTimeout(S.deadline);
    S.session = null; S.view = null; S.gameId = null; S.joining = false; lsSet('dp_session', null);
    $('#modal-root').replaceChildren();
    S.screen = 'login'; render();
    if (msg) toast(msg);
  }
  // 로그인 시간이 끝난 경우(401)에는 로그인 화면으로
  function authFail(e) {
    if (e.status === 401) return studentLogout('로그인 시간이 끝났어요. 다시 로그인해 주세요');
    toast(e.message);
  }
  async function createRoom(mode) {
    if (!needAuth()) return;
    try {
      const r = await api({ action: 'create', game: S.gameId, mode, auth: S.auth.token, settings: S.settings });
      enterRoom({ code: r.code, token: r.token, pid: r.pid, game: r.game });
    } catch (e) { authFail(e); }
  }
  async function joinRoom() {
    if (!needAuth()) return;
    const code = ($('#code').value || '').trim();
    if (!/^\d{4}$/.test(code)) return toast('숫자 4자리를 입력해 주세요');
    try {
      const r = await api({ action: 'join', code, auth: S.auth.token });
      enterRoom({ code: r.code, token: r.token, pid: r.pid, game: r.game });
    } catch (e) { authFail(e); }
  }

  /* ---------- 화면 ---------- */
  function homeScreen() {
    return h('main', { class: 'wrap' },
      h('header', { class: 'hero' },
        h('h1', {}, '데블스 플랜 & 더 지니어스'),
        h('p', {}, '공부로 얻은 힌트를 들고 승부하는 교실 두뇌 게임')),
      h('div', { class: 'whobar' },
        h('span', {}, '👤 ', h('b', {}, S.auth.name), S.auth.num ? ` (${S.auth.num}번)` : ''),
        h('button', { class: 'ghost small', onclick: () => studentLogout() }, '로그아웃')),
      h('section', { class: 'games' },
        GAMES.map((g) => h('button', { class: 'gamecard', onclick: () => { if (!needAuth()) return; S.gameId = g.id; S.screen = 'game'; render(); } },
          h('span', { class: 'suits' }, g.icon ? g.icon.map((c, i) => h('span', { class: i === 1 ? 'r' : '' }, c)) : [h('span', {}, '♠'), h('span', { class: 'r' }, '♥'), h('span', { class: 'r' }, '♦'), h('span', {}, '♣')]),
          h('strong', {}, g.name), h('span', { class: 'tagline' }, g.tagline),
          h('span', { class: 'tags' }, g.tags.map((t) => h('em', {}, t))))),
        h('div', { class: 'gamecard soon' }, h('strong', {}, '다음 게임'), h('span', { class: 'tagline' }, '곧 추가돼요'))),
      h('p', { class: 'tlink' }, h('button', { class: 'linkbtn', onclick: () => { S.screen = S.tauth ? 'teacher' : 'tlogin'; render(); } }, '교사 메뉴')));
  }

  /* ---------- 로그인 화면 ---------- */
  function loginScreen() {
    const submit = async () => {
      const code = $('#lcode').value.trim(), password = $('#lpw').value.trim();
      if (!code || !password) return toast('학급 코드와 비밀번호를 입력해 주세요');
      try {
        const r = await api({ action: 'student_login', code, password });
        S.auth = { token: r.token, name: r.student.name, num: r.student.num };
        lsSet('dp_auth', JSON.stringify(S.auth)); lsSet('dp_lcode', code);
        S.screen = 'home'; render();
      } catch (e) { toast(e.message); const i = $('#lpw'); if (i) { i.value = ''; i.focus(); } }
    };
    const enter = (e) => { if (e.key === 'Enter') submit(); };
    return h('main', { class: 'wrap narrow' },
      h('header', { class: 'hero' }, h('h1', {}, '데블스 플랜 & 더 지니어스'), h('p', {}, '학급 코드와 내 비밀번호로 들어와요')),
      h('div', { class: 'panel' },
        h('label', { class: 'field' }, h('span', {}, '학급 코드'),
          h('input', { id: 'lcode', value: lsGet('dp_lcode') || '', inputmode: 'numeric', autocomplete: 'off', placeholder: '선생님이 알려 준 번호', onkeydown: enter })),
        h('label', { class: 'field' }, h('span', {}, '비밀번호 (4자)'),
          h('input', { id: 'lpw', type: 'password', maxlength: 4, autocomplete: 'off', placeholder: '● ● ● ●', onkeydown: enter })),
        h('button', { class: 'primary', onclick: submit }, '로그인')),
      h('p', { class: 'tlink' }, h('button', { class: 'linkbtn', onclick: () => { S.screen = S.tauth ? 'teacher' : 'tlogin'; render(); } }, '교사 로그인')));
  }

  // 교사 로그인 / 처음 등록(아이디·비밀번호·학급 코드를 직접 정함)
  function teacherLoginScreen() {
    const reg = S.tmode === 'register';
    const done = (r) => { S.tauth = r.token; lsSet('dp_tauth', r.token); lsSet('dp_tid', r.teacher.id); S.screen = 'teacher'; render(); };
    const submit = async () => {
      const id = $('#tid').value.trim(), password = $('#tpw').value;
      if (!id || !password) return toast('아이디와 비밀번호를 입력해 주세요');
      try {
        if (!reg) return done(await api({ action: 'teacher_login', id, password }));
        if (password !== $('#tpw2').value) return toast('비밀번호 확인이 달라요');
        const code = $('#tcode').value.trim();
        if (!code) return toast('학급 코드를 정해 주세요');
        done(await api({ action: 'teacher_register', id, password, code }));
      } catch (e) { toast(e.message); }
    };
    const enter = (e) => { if (e.key === 'Enter') submit(); };
    const field = (label, input, note) => h('label', { class: 'field' }, h('span', {}, label), input, note ? h('small', { class: 'fnote' }, note) : null);
    return h('main', { class: 'wrap narrow' },
      h('header', { class: 'hero' }, h('h1', {}, reg ? '교사 등록' : '교사 로그인'),
        h('p', {}, reg ? '처음 쓰는 선생님은 아이디와 학급 코드를 정해 주세요' : '학생 명단과 활동 기록을 확인해요')),
      h('div', { class: 'panel' },
        field('교사 아이디', h('input', { id: 'tid', value: reg ? '' : (lsGet('dp_tid') || ''), autocomplete: 'username', autocapitalize: 'off', onkeydown: enter }),
          reg ? '영문·숫자(그리고 _ . -) 3~20자' : null),
        field('비밀번호', h('input', { id: 'tpw', type: 'password', autocomplete: reg ? 'new-password' : 'current-password', onkeydown: enter }), reg ? '6자 이상 (잊어버리면 찾을 수 없으니 기억해 두세요)' : null),
        reg ? field('비밀번호 확인', h('input', { id: 'tpw2', type: 'password', autocomplete: 'new-password', onkeydown: enter })) : null,
        reg ? field('학급 코드', h('input', { id: 'tcode', autocomplete: 'off', autocapitalize: 'off', placeholder: '예: 6200', onkeydown: enter }), '학생들이 로그인할 때 입력하는 번호예요 · 영문·숫자 4~10자 · 다른 선생님과 겹치면 안 돼요') : null,
        h('button', { class: 'primary', onclick: submit }, reg ? '등록하고 시작하기' : '로그인')),
      h('p', { class: 'tlink' },
        h('button', { class: 'linkbtn', onclick: () => { S.tmode = reg ? 'login' : 'register'; render(); } }, reg ? '이미 등록했어요 → 로그인' : '처음이에요 → 교사 등록'),
        h('button', { class: 'linkbtn', onclick: () => { S.screen = S.auth ? 'home' : 'login'; render(); } }, '← 학생 화면으로')));
  }

  function teacherScreen() {
    const box = h('main', { class: 'wrap wide' });
    if (!window.App.teacher) { box.append(h('p', {}, '교사 화면을 불러오지 못했어요. 새로고침해 주세요.')); return box; }
    window.App.teacher.mount(box, {
      api, toast, h, token: () => S.tauth,
      logout: () => { api({ action: 'logout', tauth: S.tauth }).catch(() => {}); S.tauth = ''; lsSet('dp_tauth', null); S.screen = S.auth ? 'home' : 'login'; render(); },
      expired: () => { S.tauth = ''; lsSet('dp_tauth', null); S.screen = 'tlogin'; render(); toast('교사 로그인 시간이 끝났어요. 다시 로그인해 주세요'); },
      back: () => { S.screen = S.auth ? 'home' : 'login'; render(); },
    });
    return box;
  }

  function gameScreen() {
    const g = gameById(S.gameId);
    const fields = (g.settings || []).map((f) => {
      const opts = typeof f.options === 'function' ? f.options(S.settings) : f.options; // 다른 설정에 따라 달라지는 선택지
      if (S.settings[f.key] == null || !opts.some(([val]) => val === S.settings[f.key])) S.settings[f.key] = (opts.find(([val]) => val === f.default) || opts[0])[0];
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
        h('button', { class: 'primary', onclick: () => createRoom('pvp') }, (g.modeLabels && g.modeLabels.pvp) || '👥 방 만들기'),
        h('button', { class: 'primary', onclick: () => { S.joining = !S.joining; render(); } }, '🔑 번호로 입장'),
        h('button', { class: 'ghost', onclick: () => createRoom('cpu') }, (g.modeLabels && g.modeLabels.cpu) || '🤖 컴퓨터와 연습')),
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
      const ctx = { send, view: () => S.view, now, toast, h, timer, rerender: render, modalRoot: $('#modal-root'), code: S.session.code };
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
    if (!S.auth && !['login', 'tlogin', 'teacher'].includes(S.screen)) S.screen = 'login';
    const screens = { room: roomScreen, game: gameScreen, home: homeScreen, login: loginScreen, tlogin: teacherLoginScreen, teacher: teacherScreen };
    app.replaceChildren((screens[S.screen] || homeScreen)());
    tickTimers();
  }

  function start() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.session) pollNow(); });
    try {
      const s = JSON.parse(lsGet('dp_session') || 'null');
      if (S.auth && s && s.code && s.token && gameById(s.game)) { S.session = s; S.gameId = s.game; S.screen = 'room'; }
    } catch (e) { /* 저장값 오류는 무시 */ }
    S.screen = S.auth ? (S.session ? 'room' : 'home') : 'login';
    render();
    if (S.session) pollNow();
    // 저장된 로그인이 아직 유효한지 확인 (시간이 지났으면 로그인 화면으로)
    if (S.auth) api({ action: 'whoami', auth: S.auth.token }).then((r) => {
      if (!r.student) studentLogout('로그인 시간이 끝났어요. 다시 로그인해 주세요');
      else if (r.student.name !== S.auth.name || r.student.num !== S.auth.num) { S.auth = { ...S.auth, ...r.student }; lsSet('dp_auth', JSON.stringify(S.auth)); if (S.screen === 'home') render(); }
    }).catch(() => { /* 연결 문제는 무시 */ });
  }

  window.App = { registerGame: (g) => GAMES.push(g), h, start, toast, now, timer, teacher: null };
})();
