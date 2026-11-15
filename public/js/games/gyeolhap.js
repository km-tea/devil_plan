/* 결합 — 화면. 서버(netlify/functions/lib/games/gyeolhap)가 규칙을 판정하고, 여기서는 보여주기만 합니다.
   레이아웃: 폰은 위→아래 한 줄, 태블릿은 왼쪽 카드판(3×3) + 오른쪽(점수·타이머·버튼·힌트). */
(function () {
  'use strict';
  const { h, registerGame } = App;
  const COLORS = ['#2b78e4', '#d9302c', '#f4c20d'];       // 파랑 · 빨강 · 노랑
  const COLOR_NAMES = ['파랑', '빨강', '노랑'];
  const SHAPE_NAMES = ['동그라미', '네모', '세모'];
  const BG_NAMES = ['흰색', '검정', '회색'];

  // 힌트 문제가 있는 학년·학기 (서버 문제 은행 bank-social.js 와 같게 맞춰 주세요)
  const SEMESTERS = { 5: [2], 6: [1, 2] };
  const GRADES = Object.keys(SEMESTERS).map(Number).sort((a, b) => b - a); // 높은 학년이 먼저(기본값)

  let L = { key: '', picks: [], sending: false }; // 내 화면에서만 쓰는 임시 선택
  let dlgBusy = false;

  function shapeSvg(shape, color) {
    const fill = COLORS[color];
    const body = shape === 0 ? `<circle cx="50" cy="50" r="29" fill="${fill}"/>`
      : shape === 1 ? `<rect x="22" y="22" width="56" height="56" rx="3" fill="${fill}"/>`
      : `<polygon points="50,19 83,77 17,77" fill="${fill}"/>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
  }

  // 카드 1장. num: 화면에 보이는 번호(1~9)
  function card(id, num, o) {
    o = o || {};
    const shape = Math.floor(id / 9), color = Math.floor(id / 3) % 3, bg = id % 3;
    const el = h(o.tap ? 'button' : 'div', {
      class: 'gc bg' + bg + (o.order ? ' sel' : '') + (o.hl ? ' hl' : '') + (o.sm ? ' sm' : ''),
      'aria-pressed': o.tap ? String(!!o.order) : null,
      'aria-label': `${num}번 카드: ${BG_NAMES[bg]} 배경의 ${COLOR_NAMES[color]} ${SHAPE_NAMES[shape]}`,
      onclick: o.tap || null,
    }, h('i', { class: 'gn' }, num));
    const art = h('span', { class: 'ga' });
    art.innerHTML = shapeSvg(shape, color);
    el.append(art);
    if (o.order) el.append(h('b', { class: 'pk' }, '✔ ' + o.order)); // 고른 카드: 큰 표시 + 고른 순서
    return el;
  }

  const oppId = (v) => (v.me.id === 'p1' ? 'p2' : 'p1');
  const nameOf = (v, pid) => (pid === v.me.id ? v.me.name : v.opp.name);
  const nums = (t) => t.map((i) => i + 1).join('·');

  function describe(v) {
    const a = v.lastAct;
    if (!a) return null;
    const who = nameOf(v, a.pid);
    switch (a.kind) {
      case 'set_ok': return `${who}: 합 성공! ${nums(a.set)}번 (+1)`;
      case 'set_bad': return `${who}: ${nums(a.set)}번은 합이 아니에요 (-1)`;
      case 'set_timeout': return `${who}: 시간 안에 3장을 못 골랐어요 (-1)`;
      case 'gyeol_ok': return `${who}: 결 성공! 합이 더 없어요 (+3)`;
      case 'gyeol_bad': return `${who}: 결 실패! 합이 남아 있어요 (-1)`;
      case 'pass': return `${who}: 패스`;
      case 'timeout': return `${who}: 시간이 끝났어요 (패스)`;
      default: return null;
    }
  }

  function scoreBar(v) {
    const turn = v.turn ? v.turn.pid : null;
    const pl = (p, mine, pid) => h('div', { class: 'gh-pl' + (mine ? ' me' : '') + (turn === pid ? ' on' : '') },
      h('span', { class: 'nm' }, p.name), h('b', {}, p.score), turn === pid ? h('i', { class: 'turn' }, '차례') : null);
    return h('div', { class: 'gh-score' }, pl(v.me, true, v.me.id), h('div', { class: 'rd' }, v.round ? `${v.round} / ${v.settings.rounds} 라운드` : '곧 시작'), pl(v.opp, false, oppId(v)));
  }

  function foundList(v) {
    if (!v.found || !v.found.length) return h('p', { class: 'hintline', style: 'margin:0' }, '아직 나온 합이 없어요');
    return h('div', { class: 'gh-found' }, v.found.map((f) =>
      h('span', { class: 'chip' + (f.by === v.me.id ? ' me' : '') }, nums(f.t), h('small', {}, nameOf(v, f.by)))));
  }

  /* ---------- 카드판 ---------- */
  function board(v, ctx, tapFn, hlSets) {
    const hl = new Set((hlSets || []).flat());
    return h('div', { class: 'gh-grid' + (tapFn ? ' picking' : '') }, v.cards.map((c, i) => card(c, i + 1, {
      tap: tapFn ? () => tapFn(i) : null,
      order: tapFn ? L.picks.indexOf(i) + 1 : 0,
      hl: hl.has(i),
    })));
  }

  // 고른 카드 3칸: 누른 번호가 큰 숫자로 보임 (빈 칸은 점선)
  function pickSlots() {
    return h('div', { class: 'gh-slots', 'aria-live': 'polite' }, [0, 1, 2].map((k) => (L.picks[k] != null
      ? h('span', { class: 'slot on' }, L.picks[k] + 1)
      : h('span', { class: 'slot' }, '?'))));
  }

  /* ---------- 라운드 진행 ---------- */
  function play(P, v, ctx) {
    const mineTurn = v.turn.pid === v.me.id;
    const naming = v.turn.naming;
    const hint = v.me.hint;

    const key = `${v.round}:${v.turn.no}:${naming ? 'n' : 'c'}`;
    if (L.key !== key) L = { key, picks: [], sending: false };

    const tap = mineTurn && naming ? async (i) => {
      if (L.sending) return;
      const k = L.picks.indexOf(i);
      if (k >= 0) L.picks.splice(k, 1); else L.picks.push(i);
      if (L.picks.length < 3) return ctx.rerender();
      L.sending = true; ctx.rerender();
      const r = await ctx.send('name_set', { cards: L.picks.slice() });
      L.sending = false;
      if (!r) { L.picks = []; ctx.rerender(); } // 오류(이미 나온 합 등): 다시 고르기
    } : null;

    P.head.append(h('p', { class: 'stage' }, mineTurn
      ? (naming ? '합이 되는 카드 3장을 누르세요!' : '내 차례예요!')
      : (naming ? `${v.opp.name}: 합을 부르는 중…` : `${v.opp.name}의 차례예요`)));
    const act = describe(v);
    if (act) P.head.append(h('p', { class: 'hintline gh-act' }, act));

    P.timerBox.append(naming
      ? h('div', {}, h('p', { class: 'gh-tlabel' }, mineTurn ? '3장을 고르세요' : '지목하는 시간'), ctx.timer(naming.endsAt, v.settings.nameSec * 1000))
      : h('div', {}, h('p', { class: 'gh-tlabel' }, mineTurn ? '내 시간' : '상대 시간'), ctx.timer(v.turn.endsAt, v.settings.turnSec * 1000)));

    P.board.append(board(v, ctx, tap));
    if (mineTurn && naming) P.board.append(pickSlots(), h('p', { class: 'hintline' }, '3장을 고르면 바로 확인해요 · 다시 누르면 선택이 취소돼요'));

    // 힌트 안내
    if (hint.info) {
      P.ctl.append(h('div', { class: 'gh-info' + (hint.info.remaining === 0 ? ' zero' : '') },
        hint.info.remaining === 0 ? '💡 남은 합이 없어요. "결!"을 외쳐 보세요' : `💡 아직 안 나온 합이 ${hint.info.remaining}개 남았어요`));
    }

    if (mineTurn && !naming) {
      const timeBtn = hint.question && hint.kind === 'time' ? h('button', { class: 'ghost', onclick: () => openHint(ctx) }, '⏱ 문제 이어 풀기')
        : h('button', { class: 'ghost', disabled: hint.timeUsed, onclick: () => startHint(ctx, 'time') },
          hint.timeUsed ? `⏱ 이번 턴 시간 힌트 사용함` : `⏱ 시간 늘리기 (+${v.settings.timeBonus}초)`);
      const infoBtn = hint.question && hint.kind === 'info' ? h('button', { class: 'ghost', onclick: () => openHint(ctx) }, '💡 문제 이어 풀기')
        : h('button', { class: 'ghost', disabled: !!hint.info || hint.infoLeft <= 0, onclick: () => startHint(ctx, 'info') },
          hint.info ? '💡 이번 턴 힌트 확인함' : hint.infoLeft <= 0 ? '💡 결합 힌트 모두 사용' : `💡 결합 힌트 (${hint.infoLeft}번 남음)`);
      P.ctl.append(
        h('div', { class: 'gh-call' },
          h('button', { class: 'primary big', onclick: () => ctx.send('call_set') }, '합!'),
          h('button', { class: 'primary big gyeol', onclick: () => { if (confirm('정말 "결"인가요? 합이 남아 있으면 -1점이에요.')) ctx.send('call_none'); } }, '결!')),
        h('div', { class: 'btns' }, timeBtn, infoBtn, h('button', { class: 'ghost', onclick: () => ctx.send('pass') }, '패스 (이번 턴 넘기기)')));
    } else if (!mineTurn) {
      P.ctl.append(h('p', { class: 'hintline' }, v.opp.isBot ? '컴퓨터가 생각하는 중이에요…' : '상대가 하는 동안 카드를 살펴보세요 👀'));
    }

    P.extra.append(h('h4', {}, '나온 합 (카드 번호)'), foundList(v));
    P.extra.append(h('p', { class: 'rnote' }, `합: 모양·색·배경색이 각각 "모두 같거나 모두 다른" 카드 3장. 아무도 합/결을 부르지 않은 채 ${v.settings.idleLimit}턴이 지나면 라운드가 끝나요. (지금 ${v.idle}턴)`));
  }

  /* ---------- 라운드 사이 ---------- */
  function between(P, v, ctx) {
    if (!v.round) {
      P.head.append(h('p', { class: 'stage' }, '곧 시작해요!'));
      P.board.append(h('div', { class: 'bigcount', 'data-count': v.nextAt }, Math.max(0, Math.ceil((v.nextAt - ctx.now()) / 1000))));
      P.ctl.append(h('p', { class: 'hintline' }, `총 ${v.settings.rounds}라운드 · 한 턴 ${v.settings.turnSec}초`));
      return;
    }
    const l = v.last;
    const t = l.reason === 'gyeol'
      ? `${nameOf(v, l.by)}: "결"을 맞혔어요! (+3)`
      : `${v.settings.idleLimit}턴 동안 아무도 부르지 않아 라운드가 끝났어요`;
    P.head.append(h('p', { class: 'stage' }, `${v.round}라운드 끝`), h('p', { class: 'hintline gh-act' }, t));
    P.timerBox.append(h('p', { class: 'gh-tlabel' }, '다음 라운드까지'), h('div', { class: 'bigcount sm', 'data-count': v.nextAt }, Math.max(0, Math.ceil((v.nextAt - ctx.now()) / 1000))));
    P.board.append(board(v, ctx, null, v.missed));
    if (v.missed.length) P.extra.append(h('h4', {}, `놓친 합 ${v.missed.length}개 (밝게 표시)`), h('div', { class: 'gh-found' }, v.missed.map((m) => h('span', { class: 'chip miss' }, nums(m)))));
    P.extra.append(h('h4', {}, '찾은 합'), foundList(v));
  }

  /* ---------- 결과 ---------- */
  function result(P, v, ctx) {
    const r = v.result, mine = r.scores[v.me.id], theirs = r.scores[oppId(v)];
    P.head.append(h('div', { class: 'banner' }, r.winner === 'draw' ? '무승부!' : r.winner === v.me.id ? '🎉 승리!' : '😢 아쉽게 졌어요'));
    P.board.append(h('div', { class: 'gh-final' },
      h('div', { class: 'f me' }, h('span', {}, v.me.name), h('b', {}, mine)),
      h('div', { class: 'vs2' }, 'VS'),
      h('div', { class: 'f' }, h('span', {}, v.opp.name), h('b', {}, theirs))));
    const wait = v.me.rematch;
    P.ctl.append(h('button', { class: 'primary', disabled: wait, onclick: () => ctx.send('rematch') },
      wait ? '친구를 기다리는 중…' : v.opp.rematch ? '친구가 기다려요! 한 번 더' : '한 번 더'));
  }

  /* ---------- 힌트 문제 창 (화면이 다시 그려져도 입력이 지워지지 않도록 별도 영역에 띄움) ---------- */
  async function startHint(ctx, kind) { const r = await ctx.send('hint_start', { kind }); if (r) openHint(ctx); }
  function closeHint(ctx) { ctx.modalRoot.replaceChildren(); dlgBusy = false; }

  function blankText(text) {
    return text.split('(      )').flatMap((part, i, a) => (i < a.length - 1 ? [part, h('span', { class: 'blank' }, '　?　')] : [part]));
  }

  function openHint(ctx) {
    const hint = ctx.view().me.hint, q = hint.question;
    if (!q) return;
    closeHint(ctx);
    let input, btn;
    const submit = async () => {
      if (dlgBusy) return;
      const text = input.value.trim();
      if (!text) return ctx.toast('정답을 입력해 주세요');
      dlgBusy = true; btn.disabled = true;
      const r = await ctx.send('hint_answer', { text });
      dlgBusy = false;
      if (!r) { btn.disabled = false; return; }
      if (r.correct) { closeHint(ctx); ctx.toast(hint.kind === 'time' ? '정답! 시간이 늘어났어요 ⏱' : '정답! 결합 힌트가 열렸어요 💡'); }
      else { ctx.toast(`아쉬워요! 정답은 "${r.answer}" · 새 문제가 나왔어요`); openHint(ctx); }
    };
    btn = h('button', { class: 'primary', onclick: submit }, '정답 확인');
    ctx.modalRoot.append(h('div', { class: 'overlay' },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        h('h3', {}, hint.kind === 'time' ? `⏱ 문제를 맞히면 +${ctx.view().settings.timeBonus}초` : '💡 문제를 맞히면 결합 힌트'),
        h('p', { class: 'qlabel' }, q.label, q.sec ? ' · ' + q.sec : ''),
        h('div', { class: 'q text' }, blankText(q.text)),
        h('div', { class: 'ans' }, input = h('input', { class: 'wide', maxlength: 20, placeholder: '빈칸에 들어갈 말', autocomplete: 'off', lang: 'ko',
          onkeydown: (e) => { if (e.key === 'Enter') submit(); } })),
        h('p', { class: 'ansnote' }, '단어만 쓰면 돼요. 띄어쓰기는 상관없어요. (시간은 계속 흘러가요!)'),
        h('div', { class: 'btn-row', style: 'justify-content:center' },
          h('button', { class: 'ghost', onclick: () => closeHint(ctx) }, '나중에'),
          h('button', { class: 'ghost', onclick: async () => { const r = await ctx.send('hint_skip'); if (r) openHint(ctx); } }, '다른 문제'),
          btn))));
    setTimeout(() => input.focus());
  }

  function render(root, v, ctx) {
    const hintOpen = v.phase === 'play' && v.turn && v.turn.pid === v.me.id && !v.turn.naming && v.me.hint.question;
    if (!hintOpen) closeHint(ctx);
    const P = {
      head: h('div', { class: 'gh-head' }, scoreBar(v)),
      timerBox: h('div', { class: 'gh-timer' }),
      board: h('div', { class: 'gh-boardbox' }),
      ctl: h('div', { class: 'gh-ctl' }),
      extra: h('div', { class: 'gh-extra' }),
    };
    if (v.phase === 'play') play(P, v, ctx);
    else if (v.phase === 'between') between(P, v, ctx);
    else if (v.phase === 'result') result(P, v, ctx);
    root.append(h('div', { class: 'gh' },
      h('div', { class: 'gh-left' }, P.head, P.board),
      h('div', { class: 'gh-side' }, P.timerBox, P.ctl, P.extra)));
  }

  registerGame({
    id: 'gyeolhap',
    name: '결합',
    icon: ['◯', '□', '△'],
    tagline: '카드 9장에서 "합"을 찾아라! 합이 더 없으면 "결"!',
    tags: ['5·6학년 사회', '알짜 정리 학습지', '단답식 힌트'],
    rules: [
      '카드는 모양(◯□△) · 색(파랑·빨강·노랑) · 배경색(흰색·검정·회색)이 달라요. 한 라운드에 9장이 공개돼요.',
      '"합": 모양, 색, 배경색이 각각 "모두 같거나 모두 다른" 카드 3장이에요. 세 가지 모두 만족해야 해요.',
      '내 차례에 30초 안에 "합!"을 누르고 5초 안에 카드 3장을 눌러요. 맞으면 +1점, 틀리면 -1점이에요.',
      '더 이상 합이 없다고 생각하면 "결!" — 맞으면 +3점으로 라운드가 끝나고, 합이 남아 있으면 -1점이에요.',
      '아무것도 안 부르고 패스하거나 시간이 끝나면 점수 변화 없이 상대에게 넘어가요. 아무도 안 부른 채 6턴이 지나면 라운드가 끝나요.',
      '이미 나온 합은 다시 불러도 점수가 없어요. 정한 라운드(3·5·10)가 끝났을 때 점수가 높은 사람이 이겨요.',
      '컴퓨터와 연습하면 내가 행동한 뒤 컴퓨터가 10초 안에 답해요. 난이도가 어려울수록 실수를 덜 해요.',
      '힌트 ⏱ 사회 문제를 맞히면 이번 턴이 10초 늘어요(한 턴에 1번). 💡 문제를 맞히면 남은 합이 몇 개인지(0개면 "결")를 알려 줘요(한 게임에 3번).',
    ],
    settings: [
      { key: 'grade', label: '학년', options: GRADES.map((g) => [String(g), g + '학년']) },
      { key: 'semester', label: '힌트 문제 학기 (알짜 정리 학습지 단답식)',
        options: (st) => { const sem = SEMESTERS[st.grade] || [1, 2]; return (sem.length > 1 ? [['all', '학기 모두']] : []).concat(sem.map((n) => [String(n), n + '학기'])); } },
      { key: 'rounds', label: '라운드 수', default: '5', options: [['3', '3라운드'], ['5', '5라운드'], ['10', '10라운드']] },
      { key: 'botLevel', label: '컴퓨터 난이도 (컴퓨터와 연습할 때만 적용) — 어려울수록 실수를 덜 해요', options: [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']] },
    ],
    pollMs: (v) => (v && (v.phase === 'play' || v.phase === 'between') ? 1500 : 2500),
    render,
  });
})();
