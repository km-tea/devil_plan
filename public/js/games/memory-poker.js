/* 기억 포커 — 화면. 서버(netlify/functions/lib/games/memory-poker)가 규칙을 판정하고, 여기서는 보여주기만 합니다. */
(function () {
  'use strict';
  const { h, registerGame } = App;
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const LET = 'ABCDEFGHIJKLMNOP';

  const RANK_TABLE = [ // [이름, 예시 카드 5장, 흐리게 표시할 카드 위치]
    ['스트레이트 플러시', ['D2', 'D3', 'D4', 'D5', 'D6'], []],
    ['포카드', ['D2', 'H2', 'C2', 'S2', 'H7'], [4]],
    ['풀하우스', ['D2', 'C2', 'S2', 'H7', 'S7'], []],
    ['플러시', ['D2', 'D5', 'D9', 'DQ', 'DK'], []],
    ['스트레이트', ['D2', 'C3', 'S4', 'H5', 'S6'], []],
    ['트리플', ['D2', 'C2', 'S2', 'H5', 'D6'], [3, 4]],
    ['투페어', ['D2', 'H2', 'H7', 'S7', 'HQ'], [4]],
    ['원페어', ['D2', 'C2', 'S4', 'H7', 'S9'], [2, 3, 4]],
    ['하이카드', ['DK', 'C2', 'S4', 'H7', 'S9'], [1, 2, 3, 4]],
  ];

  let L = { round: -1, picks: [] }; // 내 화면에서만 쓰는 임시 선택
  let rankOpen = null;
  let dlgBusy = false;

  function card(code, o) {
    o = o || {};
    const red = code[0] === 'H' || code[0] === 'D';
    return h('div', { class: 'pc' + (red ? ' red' : '') + (o.sm ? ' sm' : '') + (o.dim ? ' dim' : '') + (o.hl ? ' hl' : '') },
      h('span', { class: 'pr' }, code[1] === 'T' ? '10' : code[1]),
      h('span', { class: 'ps' }, SUIT[code[0]]),
      o.tag ? h('i', { class: 'ptag' }, o.tag) : null);
  }

  function mathNodes(text) { // "3/4 ÷ 2/5" → 위아래로 쓴 분수
    return text.split(/(\d+\/\d+)/).map((part) => {
      const m = part.match(/^(\d+)\/(\d+)$/);
      return m ? h('span', { class: 'frac' }, h('span', {}, m[1]), h('span', {}, m[2])) : part;
    });
  }

  function rankPanel() {
    const open = rankOpen === null ? window.matchMedia('(min-width:900px)').matches : rankOpen;
    return h('details', { class: 'rankpanel', open, ontoggle: (e) => { rankOpen = e.target.open; } },
      h('summary', {}, '족보 순위 (위로 갈수록 강해요)'),
      RANK_TABLE.map(([name, cs, dim], i) =>
        h('div', { class: 'rrow' }, h('div', { class: 'rn' }, (i + 1) + '. ' + name),
          h('div', { class: 'row' }, cs.map((c, k) => card(c, { sm: true, dim: dim.includes(k) }))))),
      h('p', { class: 'rnote' }, '같은 족보라면 나머지 카드의 숫자가 높은 사람이 이겨요. A는 가장 높은 카드예요. A-2-3-4-5도 스트레이트로 인정돼요.'));
  }

  function header(v) {
    const st = v.opp && !v.opp.isBot && v.phase === 'select'
      ? h('small', { class: v.opp.confirmed ? 'done' : '' }, v.opp.confirmed ? '확정!' : '고르는 중') : null;
    return h('div', { class: 'vs' }, h('span', { class: 'pl me' }, v.me.name), 'VS', h('span', { class: 'pl' }, v.opp.name, st));
  }

  /* ---------- 암기 ---------- */
  function memorize(main, v, ctx) {
    if (!v.deck) {
      main.append(h('p', { class: 'stage' }, '카드를 외울 준비!'),
        h('div', { class: 'bigcount', 'data-count': v.startsAt }, Math.max(0, Math.ceil((v.startsAt - ctx.now()) / 1000))));
      return;
    }
    main.append(h('p', { class: 'stage' }, '16장을 외우세요!'),
      h('p', { class: 'hintline' }, '카드 아래 알파벳(A~P)이 나중에 카드를 고를 때 쓰는 위치예요.'),
      ctx.timer(v.phaseEndsAt, v.settings.memorizeSec * 1000),
      h('div', { class: 'grid4' }, v.deck.map((c, i) => h('div', { class: 'slot' }, card(c), h('span', { class: 'ltr' }, LET[i])))));
  }

  /* ---------- 선택 ---------- */
  function select(main, v, ctx) {
    const me = v.me, hint = me.hint, rev = hint.revealed;
    const picks = me.confirmed ? me.picks : L.picks;

    const tap = (i) => {
      if (me.confirmed) return;
      if (hint.status === 'ready') { ctx.send('hint_reveal', { idx: i }).then((r) => { if (r) ctx.toast(LET[i] + ' 카드가 공개됐어요!'); }); return; }
      const k = L.picks.indexOf(i);
      if (k >= 0) L.picks.splice(k, 1);
      else { if (L.picks.length >= 2) L.picks.shift(); L.picks.push(i); }
      ctx.rerender();
    };

    main.append(
      h('p', { class: 'stage' }, me.confirmed ? '확정했어요!' : hint.status === 'ready' ? '정답! 공개할 카드를 눌러 보세요 👆' : '공유 카드와 합칠 카드 2장을 고르세요'),
      ctx.timer(v.phaseEndsAt, v.settings.selectSec * 1000),
      h('div', { class: 'shared' }, h('h4', {}, '공유 카드'), h('div', { class: 'row' }, v.shared.map((c) => card(c)))));

    const cells = [];
    for (let i = 0; i < 16; i++) {
      const sel = picks.includes(i);
      cells.push(rev && rev.idx === i
        ? h('button', { class: 'slot', 'aria-label': LET[i] + '번 카드(힌트로 공개됨)', onclick: () => tap(i) }, card(rev.card, { tag: '힌트', hl: sel }), h('span', { class: 'ltr' }, LET[i]))
        : h('button', { class: 'pc back' + (sel ? ' sel' : ''), 'aria-label': LET[i] + '번 카드', onclick: () => tap(i) }, LET[i]));
    }
    main.append(h('div', { class: 'grid4' }, cells));

    const slot = (idx) => idx === undefined ? h('div', { class: 'empty' }, '?')
      : rev && rev.idx === idx ? card(rev.card) : h('div', { class: 'pc back' }, LET[idx]);
    main.append(h('div', { class: 'tray' }, slot(picks[0]), '+', slot(picks[1])));

    const hintBtn = hint.status === 'none' ? h('button', { class: 'ghost', onclick: () => startHint(ctx) }, '💡 힌트 쓰기 (문제를 풀면 카드 1장을 볼 수 있어요)')
      : hint.status === 'asking' ? h('button', { class: 'ghost', onclick: () => openHint(ctx) }, '💡 힌트 문제 이어서 풀기')
      : hint.status === 'used' ? h('button', { class: 'ghost', disabled: true }, '💡 힌트 사용 완료') : null;
    main.append(h('div', { class: 'btn-row', style: 'justify-content:center' }, hintBtn,
      h('button', { class: 'primary', disabled: me.confirmed || picks.length !== 2 || hint.status === 'ready',
        onclick: () => ctx.send('confirm', { picks: L.picks }) }, me.confirmed ? '확정 완료' : '이 2장으로 확정')));
    if (me.confirmed && !v.opp.isBot) main.append(h('p', { class: 'hintline' }, v.opp.confirmed ? '결과를 계산하는 중…' : '상대가 고르는 중이에요…'));
  }

  /* ---------- 힌트 문제 창 (화면이 다시 그려져도 입력이 지워지지 않도록 별도 영역에 띄움) ---------- */
  async function startHint(ctx) { const r = await ctx.send('hint_start'); if (r) openHint(ctx); }

  function closeHint(ctx) { ctx.modalRoot.replaceChildren(); dlgBusy = false; }

  function openHint(ctx) {
    const q = ctx.view().me.hint.question;
    if (!q) return;
    closeHint(ctx);
    let n, d, x, btn;
    const submit = async () => {
      if (dlgBusy) return;
      const payload = q.kind === 'frac' ? { n: n.value.trim(), d: d.value.trim() } : { v: x.value.trim() };
      if ((q.kind === 'frac' && !payload.n) || (q.kind === 'dec' && !payload.v)) return ctx.toast('답을 입력해 주세요');
      dlgBusy = true; btn.disabled = true;
      const r = await ctx.send('hint_answer', payload);
      dlgBusy = false;
      if (!r) { btn.disabled = false; return; }
      if (r.correct) { closeHint(ctx); ctx.toast('정답! 공개할 카드를 눌러 보세요 👆'); }
      else { ctx.toast('아쉬워요! 새 문제가 나왔어요'); openHint(ctx); }
    };
    const enter = (e) => { if (e.key === 'Enter') submit(); };
    const answer = q.kind === 'frac'
      ? h('div', { class: 'ans' }, '=', h('div', { class: 'fi' },
          n = h('input', { inputmode: 'numeric', maxlength: 3, 'aria-label': '분자', onkeydown: enter }), h('hr'),
          d = h('input', { inputmode: 'numeric', maxlength: 3, 'aria-label': '분모', onkeydown: enter })))
      : h('div', { class: 'ans' }, '=', x = h('input', { inputmode: 'decimal', maxlength: 6, 'aria-label': '답', onkeydown: enter }));
    btn = h('button', { class: 'primary', onclick: submit }, '정답 확인');
    ctx.modalRoot.append(h('div', { class: 'overlay' },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        h('h3', {}, '💡 힌트 문제'),
        h('div', { class: 'q' }, mathNodes(q.prompt), ' = ?'),
        answer,
        h('p', { class: 'ansnote' }, q.kind === 'frac' ? '분수로 답해요. 자연수가 답이면 분모는 비워 두세요.' : '소수로 답해요. (예: 2.5)'),
        h('div', { class: 'btn-row', style: 'justify-content:center' },
          h('button', { class: 'ghost', onclick: () => closeHint(ctx) }, '나중에 풀기'), btn))));
    setTimeout(() => (n || x).focus());
  }

  /* ---------- 결과 ---------- */
  function result(main, v, ctx) {
    const r = v.result, me = v.me.id, opp = me === 'p1' ? 'p2' : 'p1';
    main.append(h('div', { class: 'banner' }, r.winner === 'draw' ? '무승부!' : r.winner === me ? '🎉 승리!' : '😢 아쉽게 졌어요'));
    if (r.timedOut) main.append(h('p', { class: 'hintline' }, '시간이 끝나서 못 고른 카드는 자동으로 채웠어요.'));
    for (const [id, name] of [[me, v.me.name], [opp, v.opp.name]]) {
      const hd = r.hands[id];
      main.append(h('div', { class: 'hand' + (r.winner === id ? ' win' : '') },
        h('h3', {}, name, h('span', {}, hd.name)),
        h('div', { class: 'row' }, hd.cards.map((c, i) => card(c, { hl: i >= 3 })))));
    }
    const mine = r.hands[me].picks, theirs = r.hands[opp].picks;
    main.append(h('p', { class: 'hintline' }, '전체 카드 공개 (금색 표시는 고른 카드)'),
      h('div', { class: 'mini' }, v.deck.map((c, i) => {
        const a = mine.includes(i), b = theirs.includes(i);
        return h('div', { class: 'slot' }, h('span', { class: 'mk' }, a && b ? '둘 다' : a ? '나' : b ? '상대' : ''),
          card(c, { hl: a || b }), h('span', { class: 'ltr' }, LET[i]));
      })));
    const wait = v.me.rematch;
    main.append(h('div', { class: 'btn-row', style: 'justify-content:center' },
      h('button', { class: 'primary', disabled: wait, onclick: () => ctx.send('rematch') },
        wait ? '친구를 기다리는 중…' : v.opp.rematch ? '친구가 기다려요! 한 번 더' : '한 번 더')));
  }

  function render(root, v, ctx) {
    if (L.round !== v.round) { L = { round: v.round, picks: [] }; closeHint(ctx); }
    if (v.phase !== 'select') closeHint(ctx);
    const main = h('section', {});
    main.append(header(v));
    if (v.phase === 'memorize') memorize(main, v, ctx);
    else if (v.phase === 'select') select(main, v, ctx);
    else if (v.phase === 'result') result(main, v, ctx);
    root.append(h('div', { class: 'mp' }, main, rankPanel()));
  }

  registerGame({
    id: 'memory-poker',
    name: '기억 포커',
    tagline: '16장을 외우고, 공유 카드와 합쳐 가장 강한 조합을 만들어라',
    tags: ['6학년 수학', '분수·소수의 나눗셈'],
    rules: [
      '카드 16장이 20초 동안 공개돼요. 위치(A~P)와 함께 외우세요.',
      '공유 카드 3장이 공개되면, 외운 카드 중 2장을 골라 5장으로 족보를 만들어요.',
      '선택 시간은 최대 3분이에요. 오른쪽 족보표를 보며 고르세요.',
      '힌트는 한 게임에 한 번! 분수·소수의 나눗셈 문제를 풀면 카드 1장을 볼 수 있어요.',
      '더 높은 족보를 만든 사람이 이겨요. 같으면 나머지 카드 숫자가 높은 사람이 이겨요.',
    ],
    settings: [
      { key: 'hintKinds', label: '힌트 문제 종류', options: [['mix', '분수 + 소수'], ['frac', '분수의 나눗셈'], ['dec', '소수의 나눗셈']] },
      { key: 'botLevel', label: '컴퓨터 실력 (연습 모드)', options: [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']] },
    ],
    render,
  });
})();
