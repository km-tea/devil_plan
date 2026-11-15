/* 십이장기 — 화면. 규칙 판정은 서버(netlify/functions/lib/games/twelve-janggi)가 하고, 여기서는 보여주기만 합니다.
   내 말은 항상 아래쪽에서 위로 올라가는 모습으로 보이도록, 두 번째 사람(p2)에게는 판을 180° 돌려서 보여 줍니다.
   레이아웃: 폰은 위→아래 한 줄, 태블릿은 왼쪽 판 + 오른쪽(점수·타이머·힌트·버튼). */
(function () {
  'use strict';
  const { h, registerGame } = App;
  const CHAR = { K: '王', G: '將', S: '相', P: '子', H: '侯' };
  const NAME = { K: '왕', G: '장', S: '상', P: '자', H: '후' };
  // 말이 갈 수 있는 방향 표시(내 말 기준, 위쪽이 앞): [칸 이름]
  const ARROWS = {
    K: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
    G: ['n', 's', 'e', 'w'],
    S: ['ne', 'nw', 'se', 'sw'],
    P: ['n'],
    H: ['n', 's', 'e', 'w', 'ne', 'nw'],
  };
  const REASON = { capture: '상대 왕을 잡았어요', try: '왕이 상대 진영에서 버텼어요', nomoves: '둘 수 있는 곳이 없어요', repeat: '같은 모양이 세 번 나왔어요', long: '수가 너무 길어졌어요' };

  let L = { key: '', sel: null };      // sel: { cell: 칸 } 또는 { hand: 'G' }
  let dlgBusy = false;

  function mathNodes(text) { // "3/4 ÷ 2/5" → 위아래로 쓴 분수
    return text.split(/(\d+\/\d+)/).map((part) => {
      const m = part.match(/^(\d+)\/(\d+)$/);
      return m ? h('span', { class: 'frac' }, h('span', {}, m[1]), h('span', {}, m[2])) : part;
    });
  }

  // 말 한 개. mine: 내 말(빨강) / 상대 말(초록, 180° 회전)
  function piece(pc, mine, extra) {
    const el = h('div', { class: 'jp ' + (mine ? 'mine' : 'theirs') + ' t' + pc.t + (extra ? ' ' + extra : ''), 'aria-label': (mine ? '내 ' : '상대 ') + NAME[pc.t] },
      h('span', { class: 'ch' }, CHAR[pc.t]));
    for (const a of ARROWS[pc.t]) el.append(h('i', { class: 'ar a-' + a }));
    return el;
  }

  const oppId = (v) => (v.me.id === 'p1' ? 'p2' : 'p1');
  const flipOf = (v) => v.me.id === 'p2';
  const vi = (v, ci) => (flipOf(v) ? 11 - ci : ci); // 서버 칸 번호 ↔ 내 화면 칸 번호 (180° 회전이라 같은 식)

  /* ---------- 판 ---------- */
  function board(v, ctx, interactive) {
    const mine = v.me.id;
    const legal = interactive && v.legal ? v.legal : [];
    const targets = new Set(), picks = L.sel ? L.sel : null;
    if (picks) for (const m of legal) {
      if (picks.cell != null && m.f === picks.cell) targets.add(m.t);
      if (picks.hand && m.d === picks.hand) targets.add(m.t);
    }
    const movable = new Set(legal.filter((m) => m.f != null).map((m) => m.f));
    const lm = v.lastMove;
    const cells = [];
    for (let k = 0; k < 12; k++) {
      const ci = flipOf(v) ? 11 - k : k;            // 화면 k번째 칸 = 서버 ci번 칸
      const pc = v.board[ci];
      const cls = ['jc', (Math.floor(k / 3) + (k % 3)) % 2 ? 'alt' : ''];
      if (lm && (lm.to === ci || lm.from === ci)) cls.push('last');
      if (picks && picks.cell === ci) cls.push('sel');
      if (targets.has(ci)) cls.push('tgt');
      let tap = null;
      if (interactive) {
        if (targets.has(ci)) tap = () => doMove(ctx, v, picks, ci);
        else if (pc && pc.o === mine && movable.has(ci)) tap = () => { L.sel = { cell: ci }; ctx.rerender(); };
        else if (picks) tap = () => { L.sel = null; ctx.rerender(); };
      }
      const el = h(tap ? 'button' : 'div', { class: cls.filter(Boolean).join(' '), onclick: tap, 'aria-label': `${Math.floor(k / 3) + 1}행 ${(k % 3) + 1}열` });
      if (pc) el.append(piece(pc, pc.o === mine, pc.o === mine && movable.has(ci) && !picks ? 'can' : ''));
      if (targets.has(ci)) el.append(h('i', { class: 'dot' }));
      cells.push(el);
    }
    return h('div', { class: 'jboard' + (interactive ? ' live' : '') }, cells);
  }

  async function doMove(ctx, v, picks, ci) {
    const r = picks.cell != null
      ? await ctx.send('move', { from: picks.cell, to: ci })
      : await ctx.send('drop', { type: picks.hand, to: ci });
    L.sel = null;
    if (!r) ctx.rerender();
  }

  // 손(잡은 말) 줄: 내 손은 눌러서 선택, 상대 손은 보기만
  function handRow(v, ctx, who, interactive) {
    const hand = v.hands[who];
    const mineRow = who === v.me.id;
    const items = ['G', 'S', 'P'].filter((t) => hand[t] > 0);
    return h('div', { class: 'jhand' + (mineRow ? ' mine' : '') },
      h('span', { class: 'hl' }, mineRow ? '내가 잡은 말' : '상대가 잡은 말'),
      items.length ? items.map((t) => {
        const on = L.sel && L.sel.hand === t;
        const canDrop = interactive && mineRow && v.legal && v.legal.some((m) => m.d === t);
        const el = h(canDrop ? 'button' : 'div', { class: 'jh' + (on ? ' sel' : ''), onclick: canDrop ? () => { L.sel = on ? null : { hand: t }; ctx.rerender(); } : null, 'aria-label': NAME[t] + ' ' + hand[t] + '개' },
          piece({ t }, mineRow, 'sm'), hand[t] > 1 ? h('b', { class: 'cnt' }, '×' + hand[t]) : null);
        return el;
      }) : h('span', { class: 'none' }, '없음'));
  }

  /* ---------- 힌트 표시 ---------- */
  function hintBox(v) {
    const hi = v.me.hint, S = v.settings;
    const dots = [];
    for (let i = 0; i < S.maxCharges; i++) dots.push(h('span', { class: 'hd' + (i < hi.charges ? ' on' : '') }, '💡'));
    return h('div', { class: 'jhint' },
      h('div', { class: 'hrow' }, h('b', {}, '내 힌트'), h('span', { class: 'hdots' }, dots)),
      h('p', { class: 'hintline left' }, hi.untilNext == null ? '힌트가 가득 찼어요' : `내 턴 ${hi.untilNext}번 뒤에 힌트 +1 (${S.every}턴마다 충전, 최대 ${S.maxCharges}개)`));
  }

  function noteText(v) {
    const n = v.note, t = v.turn;
    if (!n || !t || t.no > n.no + 1) return null;
    const who = n.pid === v.me.id ? '나' : v.opp.name;
    if (n.kind === 'undo') return `${who}: 힌트 성공! 무르고 다시 두었어요 ↩`;
    if (n.kind === 'quiz_fail') return `${who}: 힌트 문제를 틀려서 그대로 두었어요`;
    if (n.kind === 'quiz_timeout') return `${who}: 문제 시간이 끝나 그대로 두었어요`;
    if (n.kind === 'timeout') return `${who}: 시간이 지나 자동으로 한 수를 두었어요`;
    return null;
  }

  /* ---------- 진행 ---------- */
  function play(P, v, ctx) {
    const t = v.turn, mineTurn = t.pid === v.me.id;
    const key = `${t.no}:${t.stage}`;
    if (L.key !== key) L = { key, sel: null };
    const interactive = mineTurn && t.stage === 'move';

    let stage;
    if (mineTurn) stage = t.stage === 'move' ? (v.me.hint.usedThisTurn ? '무르기 성공! 다시 두세요' : '내 차례예요! 말을 눌러 보세요')
      : t.stage === 'window' ? '말을 놓았어요. 힌트를 쓸까요?' : '힌트 문제를 풀어 보세요!';
    else stage = t.stage === 'window' ? `${v.opp.name}가 힌트를 쓸지 확인하는 중…` : t.stage === 'quiz' ? `${v.opp.name}가 힌트 문제를 푸는 중…`
      : v.opp.isBot ? '컴퓨터가 생각하는 중이에요…' : `${v.opp.name}의 차례예요`;
    P.head.append(h('p', { class: 'stage' }, stage));
    const note = noteText(v);
    if (note) P.head.append(h('p', { class: 'hintline gh-act' }, note));

    P.timerBox.append(t.stage === 'window'
      ? h('div', {}, h('p', { class: 'gh-tlabel' }, mineTurn ? '힌트를 쓸 수 있는 시간' : '확인 시간'), ctx.timer(t.windowEndsAt, v.settings.windowSec * 1000))
      : t.stage === 'quiz'
        ? h('div', {}, h('p', { class: 'gh-tlabel' }, '문제 푸는 시간'), ctx.timer(t.quizEndsAt, v.settings.quizSec * 1000))
        : h('div', {}, h('p', { class: 'gh-tlabel' }, mineTurn ? '내 시간' : '상대 시간'), ctx.timer(t.endsAt, v.settings.turnSec * 1000)));

    P.board.append(handRow(v, ctx, oppId(v), false), board(v, ctx, interactive), handRow(v, ctx, v.me.id, interactive));
    if (interactive) P.board.append(h('p', { class: 'hintline' }, L.sel ? '초록 점이 있는 칸을 눌러 두세요 (다른 곳을 누르면 취소)' : '움직일 내 말(또는 잡은 말)을 눌러 보세요'));

    if (mineTurn && t.stage === 'window') {
      const canHint = v.me.hint.canUse;
      P.ctl.append(
        h('button', { class: 'primary big', disabled: !canHint, onclick: async () => { const r = await ctx.send('hint_start'); if (r) openHint(ctx); } },
          canHint ? '💡 힌트로 무르기 (문제 풀기)' : '💡 힌트가 없어요'),
        h('button', { class: 'ghost', onclick: () => ctx.send('confirm') }, '이대로 확정'),
        h('p', { class: 'hintline left' }, '문제를 맞히면 방금 둔 수를 물리고 다시 둘 수 있어요. 틀리면 힌트는 사라지고 그대로 확정돼요. (한 턴에 한 번)'));
    } else if (mineTurn && t.stage === 'quiz') {
      P.ctl.append(h('button', { class: 'primary', onclick: () => openHint(ctx) }, '💡 문제 풀기'));
    } else if (interactive && v.me.hint.usedThisTurn) {
      P.ctl.append(h('p', { class: 'hintline left' }, '이번 턴 힌트를 이미 썼어요. 다시 두면 바로 확정돼요.'));
    }
    P.extra.append(hintBox(v));
    P.extra.append(h('p', { class: 'rnote' }, `상대 왕을 잡거나, 내 왕이 맨 위 칸 줄(상대 진영)에 들어가 상대의 다음 수를 버티면 이겨요. 지금까지 ${v.plies}수.`));
  }

  /* ---------- 힌트 문제 창 ---------- */
  function closeHint(ctx) { ctx.modalRoot.replaceChildren(); dlgBusy = false; }

  function openHint(ctx) {
    const v = ctx.view(), q = v.me.hint.question;
    if (!q) return;
    closeHint(ctx);
    let n, d, x, btn;
    const submit = async () => {
      if (dlgBusy) return;
      const payload = q.kind === 'frac' ? { n: n.value.trim(), d: d.value.trim() } : { v: x.value.trim() };
      if ((q.kind === 'frac' && !payload.n) || (q.kind !== 'frac' && !payload.v)) return ctx.toast('답을 입력해 주세요');
      dlgBusy = true; btn.disabled = true;
      const r = await ctx.send('hint_answer', payload);
      dlgBusy = false;
      closeHint(ctx);
      if (!r) return;
      if (r.correct) ctx.toast('정답! 방금 둔 수를 물렸어요. 다시 두세요 ↩');
      else ctx.toast(`아쉬워요! 정답은 ${r.answer}. 힌트는 사라지고 그대로 확정됐어요`);
    };
    const enter = (e) => { if (e.key === 'Enter') submit(); };
    const ratio = q.kind === 'ratio', text = ratio;
    const answer = q.kind === 'frac'
      ? h('div', { class: 'ans' }, '=', h('div', { class: 'fi' },
          n = h('input', { inputmode: 'numeric', maxlength: 3, 'aria-label': '분자', onkeydown: enter }), h('hr'),
          d = h('input', { inputmode: 'numeric', maxlength: 3, 'aria-label': '분모', onkeydown: enter })))
      : h('div', { class: 'ans' }, ratio ? null : '=',
          x = h('input', { inputmode: q.kind === 'dec' ? 'decimal' : 'numeric', maxlength: 6, 'aria-label': '답', onkeydown: enter }), ratio ? q.unit : null);
    const note = q.kind === 'frac' ? '분수로 답해요. 자연수가 답이면 분모는 비워 두세요.'
      : q.kind === 'dec' ? '소수로 답해요. (예: 2.5)' : '숫자로 답해요.';
    btn = h('button', { class: 'primary', onclick: submit }, '정답 확인');
    ctx.modalRoot.append(h('div', { class: 'overlay' },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        h('h3', {}, '💡 맞히면 방금 둔 수를 물릴 수 있어요'),
        h('div', { class: 'q' + (text ? ' text' : '') }, mathNodes(q.prompt), text ? null : ' = ?'),
        answer,
        h('p', { class: 'ansnote' }, note + ' 틀리면 힌트는 사라져요.'),
        h('div', { class: 'btn-row', style: 'justify-content:center' }, btn))));
    setTimeout(() => (n || x).focus());
  }

  /* ---------- 결과 ---------- */
  function result(P, v, ctx) {
    const r = v.result, win = r.winner === v.me.id;
    P.head.append(h('div', { class: 'banner' }, r.winner === 'draw' ? '무승부!' : win ? '🎉 승리!' : '😢 아쉽게 졌어요'),
      h('p', { class: 'hintline' }, (REASON[r.reason] || '') + ` · 총 ${r.plies}수`));
    P.board.append(handRow(v, ctx, oppId(v), false), board(v, ctx, false), handRow(v, ctx, v.me.id, false));
    const wait = v.me.rematch;
    P.ctl.append(h('button', { class: 'primary', disabled: wait, onclick: () => ctx.send('rematch') },
      wait ? '친구를 기다리는 중…' : v.opp.rematch ? '친구가 기다려요! 한 번 더' : '한 번 더'));
  }

  function scoreBar(v) {
    const turn = v.turn ? v.turn.pid : null;
    const pl = (name, mine, pid, charges) => h('div', { class: 'gh-pl' + (mine ? ' me' : '') + (turn === pid ? ' on' : '') },
      h('span', { class: 'nm' }, name), charges != null ? h('span', { class: 'jc2', title: '힌트' }, '💡' + charges) : null, turn === pid ? h('i', { class: 'turn' }, '차례') : null);
    return h('div', { class: 'gh-score' }, pl(v.me.name, true, v.me.id, v.me.hint.charges), h('div', { class: 'rd' }, 'VS'), pl(v.opp.name, false, oppId(v), v.opp.isBot ? null : v.opp.charges));
  }

  function render(root, v, ctx) {
    const hintOpen = v.phase === 'play' && v.turn && v.turn.pid === v.me.id && v.turn.stage === 'quiz' && v.me.hint.question;
    if (!hintOpen) closeHint(ctx);
    const P = {
      head: h('div', { class: 'gh-head' }, scoreBar(v)),
      timerBox: h('div', { class: 'gh-timer' }),
      board: h('div', { class: 'gh-boardbox' }),
      ctl: h('div', { class: 'gh-ctl' }),
      extra: h('div', { class: 'gh-extra' }),
    };
    if (v.phase === 'play') play(P, v, ctx);
    else if (v.phase === 'result') result(P, v, ctx);
    root.append(h('div', { class: 'gh jg' },
      h('div', { class: 'gh-left' }, P.head, P.board),
      h('div', { class: 'gh-side' }, P.timerBox, P.ctl, P.extra)));
  }

  registerGame({
    id: 'twelve-janggi',
    name: '십이장기',
    icon: ['將', '王', '相'],
    tagline: '말을 움직여 상대 왕을 잡아라! 힌트 문제를 풀면 한 수 물릴 수 있어요',
    tags: ['6학년 수학', '분수·소수 나눗셈', '비례배분', '구구단'],
    rules: [
      '판은 가로 3칸 × 세로 4칸이에요. 내 말은 아래쪽에서 시작해요: 상·왕·장 한 줄, 왕 앞에 자 한 개. 번갈아 한 수씩 둬요.',
      '왕(王)은 8방향, 장(將)은 상하좌우, 상(相)은 대각선 4방향으로 한 칸씩 가요. 자(子)는 앞으로 한 칸이에요.',
      '자가 상대 진영(맨 윗줄)에 들어가면 후(侯)로 바뀌어요. 후는 대각선 뒤쪽을 뺀 모든 방향으로 한 칸씩 가요.',
      '상대 말이 있는 칸으로 가면 그 말을 잡아요. 잡은 말은 내 말이 되어, 내 차례에 빈 칸에 내려놓을 수 있어요. (상대 진영 줄에는 못 놓아요. 후는 자로 돌아가요.)',
      '이기는 방법: ① 상대 왕을 잡는다 ② 내 왕이 상대 진영(맨 윗줄)에 들어간 뒤, 상대가 다음 수에서 잡지 못하고 한 턴을 버틴다.',
      '💡 힌트: 말을 놓고 5초 안에 힌트를 누르면 수학 문제가 나와요. 맞히면 방금 둔 수를 물리고 다시 둘 수 있어요. 틀리면 힌트는 사라지고 그대로예요. 힌트는 내 턴 5번마다 1개씩 충전(최대 3개), 한 턴에 한 번만 써요.',
      '시간이 지나면 자동으로 한 수를 둬요. 같은 모양이 세 번 나오면 무승부예요.',
    ],
    settings: [
      { key: 'hintKinds', label: '힌트 문제 종류', options: [['mix', '모두 섞어서'], ['frac', '분수의 나눗셈'], ['dec', '소수의 나눗셈'], ['ratio', '비례배분'], ['times', '구구단']] },
      { key: 'botLevel', label: '컴퓨터 난이도 (컴퓨터와 연습할 때만 적용) — 어려울수록 멀리 내다보고 실수가 적어요', options: [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']] },
    ],
    pollMs: (v) => (v && v.phase === 'play' ? 1500 : 2500),
    render,
  });
})();
