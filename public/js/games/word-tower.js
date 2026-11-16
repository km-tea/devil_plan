/* 워드 타워 — 화면. 서버(netlify/functions/lib/games/word-tower)가 판정하고, 여기서는 보여주기만 합니다.
   모두가 같은 큐브 판을 함께 만지는 협력 게임이라, 내 화면은 1.5초마다 친구들이 한 일을 따라잡습니다.
   조작: 줄(1~7)을 고른 뒤 아래 큐브를 누르면 그 줄 끝에 놓이고, 놓인 큐브를 누르면 다시 판으로 돌아가요. */
(function () {
  'use strict';
  const { h, registerGame } = App;
  const LEVEL = { low: '하', mid: '중', high: '상' };
  let L = { round: -1, row: 0 };      // 내 화면에서만 쓰는 "지금 고른 줄"

  const mmss = (s) => `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;

  function cube(c, o) {
    o = o || {};
    return h(o.tap ? 'button' : 'div', {
      class: 'wc' + (o.used ? ' used' : '') + (o.in ? ' in' : ''), onclick: o.tap || null, disabled: o.used || null,
      'aria-label': o.in ? `${c.ch} 큐브 (누르면 빼요)` : `${c.ch} 큐브`,
    }, h('b', {}, c.ch));
  }

  const rowSig = (v, i) => v.rows[i].join(',');

  function levelBadge(l) { return h('span', { class: 'lv lv-' + l }, '난이도 ' + LEVEL[l]); }

  /* ---------- 대기실 ---------- */
  function lobby(P, v, ctx) {
    P.head.append(h('p', { class: 'stage' }, `친구들을 기다리는 중 (${v.players.length}/${v.settings.maxPlayers}명)`));
    P.main.append(
      h('p', { class: 'hintline' }, '친구들에게 이 방 번호를 알려 주세요. 모두 들어오면 방장이 시작해요.'),
      h('div', { class: 'codebig' }, String(ctx.code).split('').map((d) => h('span', {}, d))),
      h('div', { class: 'wt-players' }, v.players.map((p) => h('span', { class: 'chip' + (p.id === v.me.id ? ' me' : '') }, p.name, p.id === 'p1' ? h('small', {}, '방장') : null))));
    P.ctl.append(v.me.host
      ? h('button', { class: 'primary big', onclick: () => ctx.send('start') }, `▶ ${v.players.length}명이 시작하기`)
      : h('p', { class: 'hintline' }, '방장이 시작하길 기다리는 중이에요…'));
  }

  /* ---------- 라운드 ---------- */
  function play(P, v, ctx) {
    if (L.round !== v.round) L = { round: v.round, row: Math.max(0, v.me.index) % v.settings.words };
    const t = v.topic;
    P.head.append(h('div', { class: 'wt-topic' },
      h('span', { class: 'em' }, t.emoji), h('div', {}, h('small', {}, `${v.round} / ${v.totalRounds} 라운드 · 주제`), h('b', {}, t.name)), levelBadge(t.level)),
      h('p', { class: 'hintline' }, `이 주제의 영어 단어 ${v.settings.words}개를 만들어요. 큐브를 모두 써야 해요!`));
    P.timerBox.append(h('p', { class: 'gh-tlabel' }, '남은 시간'), ctx.timer(v.endsAt, v.settings.roundSec * 1000));

    const used = new Set(v.rows.flat());
    const byId = new Map(v.cubes.map((c) => [c.id, c]));
    // 줄 7개
    P.main.append(h('div', { class: 'wt-rows' }, v.rows.map((row, i) => {
      const mark = v.check && v.check.rows && v.check.rows[i] && v.check.rows[i].sig === rowSig(v, i) && row.length
        ? (v.check.rows[i].ok ? h('i', { class: 'mk ok' }, '✔') : h('i', { class: 'mk no' }, '✘')) : null;
      return h('div', { class: 'wt-row' + (L.row === i ? ' act' : '') + (mark && mark.className.includes('ok') ? ' good' : '') },
        h('button', { class: 'rn', onclick: () => { L.row = i; ctx.rerender(); }, 'aria-label': `${i + 1}번 줄 고르기` }, i + 1),
        h('div', { class: 'rt', onclick: () => { if (L.row !== i) { L.row = i; ctx.rerender(); } } },
          row.length ? row.map((id) => cube(byId.get(id), { in: true, tap: (e) => { e.stopPropagation(); ctx.send('remove', { cube: id }); } }))
            : h('span', { class: 'ph' }, L.row === i ? '👇 아래 큐브를 눌러 놓아요' : '비어 있어요')),
        mark, row.length ? h('button', { class: 'ghost small x', onclick: () => ctx.send('clear', { row: i }), 'aria-label': `${i + 1}번 줄 비우기` }, '✕') : null);
    })));
    // 큐브 판 (놓인 큐브는 흐리게 — 자리가 바뀌지 않게)
    P.side.append(h('h4', {}, `알파벳 큐브 (${v.cubes.length - used.size}개 남음)`),
      h('div', { class: 'wt-pool' }, v.cubes.map((c) => cube(c, { used: used.has(c.id), tap: () => ctx.send('add', { row: L.row, cube: c.id }) }))));

    // 확인 결과
    if (v.check) {
      const who = v.players.find((p) => p.id === v.check.by);
      P.ctl.append(h('div', { class: 'wt-check' }, `${who ? who.name : '친구'}의 확인 결과: ${v.settings.words}개 중 ${v.check.valid}개가 맞아요`
        + (v.check.unused ? ` · 안 쓴 큐브 ${v.check.unused}개` : '')));
    }
    P.ctl.append(h('button', { class: 'primary big', onclick: async () => { const r = await ctx.send('check'); if (r && r.solved) ctx.toast('🎉 모두 맞혔어요!'); } }, '✅ 확인하기'));
    if (v.me.host) P.ctl.append(h('button', { class: 'ghost small', onclick: () => { if (confirm('이 라운드를 포기하고 정답을 볼까요?')) ctx.send('giveup'); } }, '이 라운드 넘기기 (방장)'));
    P.extra.append(h('p', { class: 'rnote' }, v.players.length > 1
      ? `함께하는 친구 ${v.players.length}명: ${v.players.map((p) => p.name).join(', ')}. 줄을 나눠서 같이 맞춰 보세요! (내 기본 줄: ${Math.max(0, v.me.index) % v.settings.words + 1}번)`
      : '혼자서 도전해요! 정답은 주제에 맞는 단어이면 인정돼요.'));
  }

  /* ---------- 라운드 사이 ---------- */
  function between(P, v, ctx) {
    const l = v.last, last = v.round >= v.totalRounds;
    P.head.append(h('div', { class: 'banner' }, l.solved ? '🎉 성공!' : l.reason === 'giveup' ? '다음에 다시!' : '⏰ 시간 끝!'),
      h('p', { class: 'hintline' }, `${v.round}라운드 · 주제 ${l.name} · ${mmss(l.sec)}`));
    P.main.append(h('h4', {}, l.solved ? '우리가 만든 단어' : '정답 예시 (주제에 맞는 다른 단어도 정답이 될 수 있어요)'),
      h('div', { class: 'wt-words' }, l.words.map((x) => h('span', { class: 'wd' }, h('b', {}, x.w), x.ko ? h('small', {}, x.ko) : null))));
    P.timerBox.append(h('p', { class: 'gh-tlabel' }, last ? '결과까지' : '다음 라운드까지'),
      h('div', { class: 'bigcount sm', 'data-count': v.nextAt }, Math.max(0, Math.ceil((v.nextAt - ctx.now()) / 1000))));
    if (v.me.host) P.ctl.append(h('button', { class: 'primary', onclick: () => ctx.send('next') }, last ? '바로 결과 보기' : '바로 다음 라운드'));
    P.extra.append(progress(v));
  }

  function progress(v) {
    return h('div', {}, h('h4', {}, '지금까지'), h('div', { class: 'wt-prog' }, v.results.map((r) =>
      h('span', { class: 'pg ' + (r.solved ? 'ok' : 'no') }, r.name, h('small', {}, `${LEVEL[r.level]} · ${r.solved ? '성공' : '실패'}`)))));
  }

  /* ---------- 결과 ---------- */
  function result(P, v, ctx) {
    const f = v.final;
    P.head.append(h('div', { class: 'banner' }, f.solved === f.total ? '🏆 모두 성공!' : `${f.total}라운드 중 ${f.solved}라운드 성공!`),
      h('p', { class: 'hintline' }, `걸린 시간 ${mmss(f.seconds)} · 함께한 친구 ${v.players.length}명`));
    P.main.append(h('div', { class: 'tscroll' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['라운드', '주제', '난이도', '결과', '시간'].map((x) => h('th', {}, x)))),
      h('tbody', {}, v.results.map((r, i) => h('tr', { class: r.solved ? '' : 'bad' }, h('td', {}, i + 1), h('td', {}, r.name), h('td', {}, LEVEL[r.level]), h('td', {}, r.solved ? '성공' : '실패'), h('td', {}, mmss(r.sec))))))));
    P.ctl.append(v.me.host
      ? h('button', { class: 'primary', onclick: () => ctx.send('rematch') }, '한 번 더 하기')
      : h('p', { class: 'hintline' }, '방장이 다시 시작할 수 있어요'));
  }

  function render(root, v, ctx) {
    const P = { head: h('div', { class: 'gh-head' }), timerBox: h('div', { class: 'gh-timer' }), main: h('div', { class: 'wt-main' }),
      side: h('div', { class: 'wt-side' }), ctl: h('div', { class: 'gh-ctl' }), extra: h('div', { class: 'gh-extra' }) };
    if (v.phase === 'lobby') lobby(P, v, ctx);
    else if (v.phase === 'play') play(P, v, ctx);
    else if (v.phase === 'between') between(P, v, ctx);
    else if (v.phase === 'result') result(P, v, ctx);
    root.append(h('div', { class: 'wt' },
      h('div', { class: 'wt-left' }, P.head, P.main),
      h('div', { class: 'wt-right' }, P.timerBox, P.side, P.ctl, P.extra)));
  }

  registerGame({
    id: 'word-tower',
    name: '워드 타워',
    icon: ['A', 'B', 'C'],
    tagline: '알파벳 큐브를 모두 써서 주제에 맞는 영어 단어 7개를 만들어요! 친구들과 힘을 합쳐요',
    tags: ['5·6학년 영어', '협력 게임', '1~7명'],
    modeLabels: { pvp: '👥 친구들과 방 만들기 (최대 7명)', cpu: '🧑 혼자 하기' },
    rules: [
      '주제 하나가 주어지고, 그 주제에 맞는 영어 단어 7개를 알파벳 큐브로 만들어요. 어떤 단어인지는 알려 주지 않아요!',
      '주어진 큐브는 하나도 남기지 않고 모두 사용해야 해요. 큐브를 다 쓰고 7개 단어가 모두 맞으면 성공이에요.',
      '줄(1~7번)을 고르고 큐브를 누르면 그 줄 끝에 놓여요. 놓인 큐브를 누르면 다시 판으로 돌아가요.',
      '"확인하기"를 누르면 7개 중 몇 개가 맞는지 알려 줘요. 정답 예시와 달라도 주제에 맞는 단어면 인정돼요.',
      '1~7명이 모두 같은 판을 함께 만져요. 줄을 나눠서 협력해 보세요! 한 라운드는 최대 5분이에요.',
      '라운드는 난이도 하 → 중 → 상 순서로 나와요. 끝나면 정답 예시를 한글 뜻과 함께 보여 줘요.',
    ],
    settings: [
      { key: 'level', label: '난이도 / 라운드', options: [['all', '전체 10라운드 (하→중→상)'], ['mix3', '맛보기 3라운드'], ['low', '하 단계 (3)'], ['mid', '중 단계 (4)'], ['high', '상 단계 (3)']] },
      { key: 'feedback', label: '확인했을 때 알려 주는 방법', options: [['rows', '맞은 줄 표시'], ['count', '맞은 개수만 (어려움)']] },
    ],
    pollMs: (v) => (v && (v.phase === 'play' || v.phase === 'between') ? 1500 : 2000),
    render,
  });
})();
