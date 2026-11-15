// 십이장기: 규칙(말 움직임·잡기·승급·내려놓기·승리 조건), 진행(힌트 무르기·충전·시간), 컴퓨터, 정보 노출 검사
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../netlify/functions/lib/games/twelve-janggi/rules');
const AI = require('../netlify/functions/lib/games/twelve-janggi/ai');
const Q = require('../netlify/functions/lib/games/twelve-janggi/questions');
const G = require('../netlify/functions/lib/games/twelve-janggi');

const T0 = 1_000_000;
const mk = (mode = 'pvp', settings = {}) => {
  const s = G.create({ mode, settings, host: { name: '지민', token: 'a' }, now: T0 });
  if (mode === 'pvp') G.join(s, { name: '서준', token: 'b' }, T0);
  return s;
};
const P = (t, o) => ({ t, o });
const board = (spec) => { const b = Array(12).fill(null); for (const [i, t, o] of spec) b[i] = P(t, o); return b; };
const player = (s, id) => s.players.find((p) => p.id === id);
const E = R.emptyHands;
const tos = (b, h, o, i) => R.legalMoves(b, h, o).filter((m) => m.f === i).map((m) => m.t).sort((a, c) => a - c);

test('시작 배치는 영상 화면과 같다 (아래: 상·왕·장 + 왕 앞의 자, 위: 장·왕·상 + 자)', () => {
  const b = R.initialBoard();
  const row = (r) => [0, 1, 2].map((c) => { const p = b[r * 3 + c]; return p ? p.o + p.t : '-'; }).join(' ');
  assert.equal(row(0), 'p2G p2K p2S');
  assert.equal(row(1), '- p2P -');
  assert.equal(row(2), '- p1P -');
  assert.equal(row(3), 'p1S p1K p1G');
  assert.equal(b.filter(Boolean).length, 8);
});

test('말의 움직임: 자·상·장·왕·후', () => {
  const h = E();
  // 가운데(4)에 놓고 8방향 확인: 왼쪽 위 0 위 1 오른쪽 위 2 / 왼 3 오른 5 / 아래 6 7 8
  assert.deepEqual(tos(board([[4, 'K', 'p1']]), h, 'p1', 4), [0, 1, 2, 3, 5, 6, 7, 8], '왕: 8방향');
  assert.deepEqual(tos(board([[4, 'G', 'p1']]), h, 'p1', 4), [1, 3, 5, 7], '장: 상하좌우');
  assert.deepEqual(tos(board([[4, 'S', 'p1']]), h, 'p1', 4), [0, 2, 6, 8], '상: 대각선');
  assert.deepEqual(tos(board([[4, 'P', 'p1']]), h, 'p1', 4), [1], '자(p1): 위로 1칸');
  assert.deepEqual(tos(board([[4, 'P', 'p2']]), h, 'p2', 4), [7], '자(p2): 아래로 1칸');
  assert.deepEqual(tos(board([[4, 'H', 'p1']]), h, 'p1', 4), [0, 1, 2, 3, 5, 7], '후(p1): 뒤쪽 대각선 제외');
  assert.deepEqual(tos(board([[4, 'H', 'p2']]), h, 'p2', 4), [1, 3, 5, 6, 7, 8], '후(p2): 뒤쪽(위) 대각선 제외');
  // 판 밖과 내 말 위로는 못 감
  assert.deepEqual(tos(board([[0, 'K', 'p1'], [1, 'G', 'p1']]), h, 'p1', 0), [3, 4]);
});

test('잡기·승급·내려놓기: 잡은 말은 내 말, 후는 자로 돌아가며, 상대 진영 줄에는 못 놓는다', () => {
  // 자가 상대 진영(맨 윗줄)에 들어가면 후로 승급
  const b2 = board([[3, 'P', 'p1']]);
  assert.equal(R.applyMove(board([[7, 'P', 'p1']]), E(), 'p1', { f: 7, t: 4 }).board[4].t, 'P', '중간 줄에서는 승급하지 않음');
  const up = R.applyMove(b2, E(), 'p1', { f: 3, t: 0 });
  assert.equal(up.board[0].t, 'H'); assert.equal(up.promoted, true);
  const down = R.applyMove(board([[6, 'P', 'p2']]), E(), 'p2', { f: 6, t: 9 });
  assert.equal(down.board[9].t, 'H');
  // 잡기: 후를 잡으면 자로 손에 들어옴, 상·장은 그대로
  const c1 = R.applyMove(board([[4, 'G', 'p1'], [1, 'H', 'p2']]), E(), 'p1', { f: 4, t: 1 });
  assert.equal(c1.cap, 'H'); assert.deepEqual(c1.hands.p1, { G: 0, S: 0, P: 1 });
  const c2 = R.applyMove(board([[4, 'G', 'p1'], [1, 'S', 'p2']]), E(), 'p1', { f: 4, t: 1 });
  assert.deepEqual(c2.hands.p1, { G: 0, S: 1, P: 0 });
  const c3 = R.applyMove(board([[4, 'G', 'p1'], [1, 'K', 'p2']]), E(), 'p1', { f: 4, t: 1 });
  assert.equal(c3.cap, 'K'); assert.deepEqual(c3.hands.p1, { G: 0, S: 0, P: 0 }, '왕은 손에 들어오지 않음');
  // 내려놓기: 빈 칸만, 상대 진영 줄(p1 은 맨 윗줄, p2 는 맨 아랫줄)은 불가
  const hands = E(); hands.p1.P = 1; hands.p2.S = 1;
  const d1 = R.legalMoves(board([[10, 'K', 'p1'], [1, 'K', 'p2']]), hands, 'p1').filter((m) => m.d);
  assert.ok(d1.length > 0 && d1.every((m) => R.rowOf(m.t) !== 0 && m.d === 'P'));
  assert.ok(!d1.some((m) => m.t === 10 || m.t === 1), '빈 칸에만');
  const d2 = R.legalMoves(board([[10, 'K', 'p1'], [1, 'K', 'p2']]), hands, 'p2').filter((m) => m.d);
  assert.ok(d2.length > 0 && d2.every((m) => R.rowOf(m.t) !== 3));
  const after = R.applyMove(board([[10, 'K', 'p1'], [1, 'K', 'p2']]), hands, 'p1', { d: 'P', t: 4 });
  assert.equal(after.board[4].t, 'P'); assert.equal(after.hands.p1.P, 0);
});

test('컴퓨터: 왕을 잡을 수 있으면 반드시 잡고, 시도 규칙으로 이길 수 있으면 이긴다, 10초 이내', () => {
  for (const lv of ['normal', 'hard']) {
    const b = board([[4, 'G', 'p1'], [1, 'K', 'p2'], [10, 'K', 'p1']]);
    let ok = 0;
    for (let i = 0; i < 30; i++) { const r = AI.choose(b, E(), 'p1', lv, () => 0.99); if (r.move.f === 4 && r.move.t === 1) ok++; assert.ok(r.delaySec <= 10); }
    assert.equal(ok, 30, lv);
  }
  // 왕이 한 칸 앞에서 목표 줄로 들어가면 상대가 못 잡는 상황 → 들어가서 이김
  const b = board([[3, 'K', 'p1'], [11, 'K', 'p2']]);
  const r = AI.choose(b, E(), 'p1', 'hard', () => 0.99);
  assert.equal(R.rowOf(r.move.t), 0);
});

test('컴퓨터 난이도: 어려울수록 실수가 적고 강하다 (쉬움 < 어려움)', () => {
  const b = R.initialBoard();
  const wins = { easy: 0, hard: 0 };
  // 쉬움 vs 어려움 6판 (색을 바꿔 가며)
  for (let g = 0; g < 6; g++) {
    const sides = g % 2 ? { p1: 'hard', p2: 'easy' } : { p1: 'easy', p2: 'hard' };
    let board0 = R.initialBoard(), hands = E(), o = 'p1', winner = null;
    for (let ply = 0; ply < 120 && !winner; ply++) {
      const c = AI.choose(board0, hands, o, sides[o]);
      if (!c.move) { winner = R.other(o); break; }
      const r = R.applyMove(board0, hands, o, c.move);
      board0 = r.board; hands = r.hands;
      if (r.cap === 'K') winner = o;
      else if (R.kingInGoal(board0, o) && !R.canCapture(board0, hands, R.other(o), R.kingAt(board0, o))) winner = o;
      o = R.other(o);
    }
    if (winner) wins[sides[winner]]++;
  }
  assert.ok(wins.hard > wins.easy, JSON.stringify(wins));
});

test('진행: 두고 나서 5초 힌트 확인 시간 → 지나면 확정, 컴퓨터는 확인 시간 없이 바로 진행', () => {
  const s = mk();
  const p1 = player(s, 'p1');
  assert.equal(s.turn.pid, 'p1'); assert.equal(p1.charges, 1);
  // 왕 앞의 자(7)를 위로: 7→4 는 상대 자가 있으니 잡기
  const r = G.handle(s, p1, 'move', { from: 7, to: 4 }, T0 + 1000);
  assert.equal(s.turn.stage, 'window'); assert.equal(s.hands.p1.P, 1);
  // 상대는 지금 둘 수 없다
  assert.throws(() => G.handle(s, player(s, 'p2'), 'move', { from: 0, to: 3 }, T0 + 1500), /내 차례/);
  G.advance(s, T0 + 1000 + 5000 + 100);        // 아직 여유 시간 안
  assert.equal(s.turn.stage, 'window');
  G.advance(s, T0 + 1000 + 5000 + 1600);       // 여유까지 지남 → 확정
  assert.equal(s.turn.pid, 'p2'); assert.equal(s.turn.stage, 'move'); assert.equal(p1.turns, 1);
  // 힌트가 없는 사람은 확인 시간 없이 바로 다음 사람
  const p2 = player(s, 'p2');
  p2.charges = 0;
  const legal = R.legalMoves(s.board, s.hands, 'p2')[0];
  G.handle(s, p2, 'move', legal.f != null ? { from: legal.f, to: legal.t } : { from: 0, to: 3 }, T0 + 9000);
  assert.equal(s.turn.pid, 'p1');
});

test('힌트: 맞히면 무르고 같은 턴에 다시 둔다 / 틀리면 힌트가 사라지고 수는 그대로 / 한 턴에 한 번', () => {
  const s = mk('pvp', { hintKinds: 'times' });
  const p1 = player(s, 'p1');
  G.handle(s, p1, 'move', { from: 7, to: 4 }, T0 + 1000);                 // 자로 상대 자를 잡음
  assert.throws(() => G.handle(s, player(s, 'p2'), 'hint_start', {}, T0 + 1100), /힌트를 쓸/);
  G.handle(s, p1, 'hint_start', {}, T0 + 2000);
  assert.equal(p1.charges, 0); assert.equal(s.turn.stage, 'quiz');
  const q = s.turn.q;
  assert.equal(q.kind, 'times');
  const view = G.view(s, 'p1', T0 + 2100);
  assert.ok(view.me.hint.question && !JSON.stringify(view).includes('"value"'), '정답은 보내지 않음');
  const ok = G.handle(s, p1, 'hint_answer', { v: String(q.value) }, T0 + 3000);
  assert.equal(ok.response.correct, true); assert.equal(ok.events[0].correct, true);
  assert.equal(s.turn.stage, 'move'); assert.equal(s.turn.pid, 'p1');
  assert.equal(s.board[7].t, 'P'); assert.equal(s.board[7].o, 'p1'); assert.equal(s.board[4].o, 'p2'); assert.equal(s.hands.p1.P, 0, '무르면 잡은 말도 돌려놓음');
  // 다시 둔 수는 힌트 확인 시간 없이 바로 확정
  G.handle(s, p1, 'move', { from: 11, to: 8 }, T0 + 4000);
  assert.equal(s.turn.pid, 'p2');

  // 틀린 경우
  const t = mk('pvp', { hintKinds: 'times' }); const a = player(t, 'p1');
  G.handle(t, a, 'move', { from: 7, to: 4 }, T0 + 1000);
  G.handle(t, a, 'hint_start', {}, T0 + 1500);
  const bad = G.handle(t, a, 'hint_answer', { v: '-1' }, T0 + 2000);
  assert.equal(bad.response.correct, false); assert.ok(bad.response.answer);
  assert.equal(t.turn.pid, 'p2', '틀리면 턴이 넘어감'); assert.equal(t.hands.p1.P, 1, '둔 수는 그대로'); assert.equal(a.charges, 0);
  // 풀이 시간 초과도 실패
  const u = mk('pvp', { hintKinds: 'times' }); const c = player(u, 'p1');
  G.handle(u, c, 'move', { from: 7, to: 4 }, T0 + 1000); G.handle(u, c, 'hint_start', {}, T0 + 1500);
  G.advance(u, T0 + 1500 + 45000 + 10);
  assert.equal(u.turn.pid, 'p2');
});

test('힌트 충전: 내 턴 5번마다 1개, 최대 3개', () => {
  const s = mk(); const p1 = player(s, 'p1'); p1.charges = 0;
  const got = [];
  for (let i = 1; i <= 20; i++) {
    s.turn = { pid: 'p1', no: i, stage: 'move', used: false, endsAt: T0 + 1e6 };
    s.positions = {}; s.pending = null; s.plies = 0; s.board = R.initialBoard(); s.hands = R.emptyHands();
    G._finalize(s, T0, []);
    got.push(p1.charges);
  }
  assert.deepEqual(got, [0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
  assert.equal(G.view(s, 'p1', T0).me.hint.untilNext, null, '3개면 더 충전되지 않음');
  p1.charges = 0; p1.turns = 2;
  assert.equal(G.view(s, 'p1', T0).me.hint.untilNext, 3);
});

test('시간: 60초 안에 안 두면 자동으로 한 수를 둔다', () => {
  const s = mk();
  const ends = s.turn.endsAt;
  G.advance(s, ends + 100);
  assert.equal(s.turn.pid, 'p2'); assert.equal(s.lastMove.auto, true); assert.equal(s.note.kind, 'timeout');
});

test('승리 조건: 왕 잡기 / 왕이 상대 진영에 들어가 1턴 버티기 / 반복은 무승부', () => {
  // 왕 잡기: p1 장이 p2 왕을 바로 잡는 판
  let s = mk();
  s.board = board([[4, 'G', 'p1'], [1, 'K', 'p2'], [10, 'K', 'p1']]); s.hands = E();
  let res = G.handle(s, player(s, 'p1'), 'move', { from: 4, to: 1 }, T0 + 500);
  assert.equal(s.phase, 'result'); assert.equal(s.result.winner, 'p1'); assert.equal(s.result.reason, 'capture');
  assert.equal(res.events.find((e) => e.type === 'result').winner, 'p1');
  // 시도 규칙: p1 왕이 맨 윗줄에 들어가고, p2 가 못 잡으면 p2 의 다음 수가 끝날 때 p1 승리
  s = mk();
  s.board = board([[3, 'K', 'p1'], [11, 'K', 'p2'], [7, 'G', 'p2']]); s.hands = E();
  player(s, 'p1').charges = 0; player(s, 'p2').charges = 0;
  G.handle(s, player(s, 'p1'), 'move', { from: 3, to: 0 }, T0 + 500);
  assert.equal(s.phase, 'play'); assert.equal(s.pending, 'p1'); assert.equal(s.turn.pid, 'p2');
  G.handle(s, player(s, 'p2'), 'move', { from: 7, to: 6 }, T0 + 900);        // 왕을 잡지 못함
  assert.equal(s.phase, 'result'); assert.equal(s.result.winner, 'p1'); assert.equal(s.result.reason, 'try');
  // 반대로 p2 가 들어온 왕을 잡으면 p2 승리
  s = mk();
  s.board = board([[3, 'K', 'p1'], [11, 'K', 'p2'], [1, 'G', 'p2']]); s.hands = E();
  player(s, 'p1').charges = 0; player(s, 'p2').charges = 0;
  G.handle(s, player(s, 'p1'), 'move', { from: 3, to: 0 }, T0 + 500);
  G.handle(s, player(s, 'p2'), 'move', { from: 1, to: 0 }, T0 + 900);
  assert.equal(s.result.winner, 'p2'); assert.equal(s.result.reason, 'capture');
  // 같은 판 3번 반복 → 무승부
  s = mk();
  s.board = board([[10, 'K', 'p1'], [1, 'K', 'p2']]); s.hands = E();
  player(s, 'p1').charges = 0; player(s, 'p2').charges = 0;
  const seq = [['p1', 10, 9], ['p2', 1, 0], ['p1', 9, 10], ['p2', 0, 1]];
  let now = T0 + 1000;
  for (let round = 0; round < 3 && s.phase === 'play'; round++) for (const [who, f, t] of seq) { if (s.phase !== 'play') break; G.handle(s, player(s, who), 'move', { from: f, to: t }, (now += 500)); }
  assert.equal(s.phase, 'result'); assert.equal(s.result.winner, 'draw'); assert.equal(s.result.reason, 'repeat');
});

test('컴퓨터와 한 판: 끝까지 진행되고, 정답과 컴퓨터의 수는 노출되지 않으며, 컴퓨터는 10초 안에 둔다', () => {
  for (const lv of ['easy', 'normal', 'hard']) {
    const s = mk('cpu', { botLevel: lv, hintKinds: 'mix' });
    let now = T0 + 1000, guard = 0;
    while (s.phase === 'play' && guard++ < 600) {
      G.advance(s, now);
      if (s.phase !== 'play') break;
      if (s.turn.pid === 'p1' && s.turn.stage === 'move') {
        const moves = R.legalMoves(s.board, s.hands, 'p1');
        const m = moves[Math.floor(Math.random() * moves.length)];
        G.handle(s, player(s, 'p1'), m.f != null ? 'move' : 'drop', m.f != null ? { from: m.f, to: m.t } : { type: m.d, to: m.t }, now);
        if (s.phase === 'play' && s.turn.stage === 'window') G.handle(s, player(s, 'p1'), 'confirm', {}, now);
      } else if (s.turn.pid === 'p2') assert.ok(s.bot.at - s.turn.endsAt + 60000 <= 10000, '컴퓨터 생각 시간 10초 이내');
      now += 6000;
    }
    assert.equal(s.phase, 'result', lv);
    const json = JSON.stringify(G.view(s, 'p1', now));
    assert.ok(!json.includes('"bot"') && !json.includes('token'));
  }
});

test('문제 종류: 구구단·분수·소수·비례배분, 정답 확인', () => {
  for (const kind of ['times', 'frac', 'dec', 'ratio', 'mix']) for (let i = 0; i < 30; i++) {
    const q = Q.make(kind);
    assert.ok(q.prompt && q.kind);
    if (kind !== 'mix') assert.equal(q.kind, kind);
    const input = q.kind === 'frac' ? { n: String(q.n), d: String(q.d) } : { v: String(q.value) };
    assert.equal(Q.check(q, input), true);
    assert.equal(Q.check(q, q.kind === 'frac' ? { n: '999', d: '1' } : { v: '-999' }), false);
  }
  const q = Q.make('times'); assert.match(q.prompt, /^[2-9] × [2-9]$/);
});
