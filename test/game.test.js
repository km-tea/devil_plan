const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../netlify/functions/lib/games/memory-poker');

const T0 = 1_000_000;

test('컴퓨터 대전: 카운트다운 → 암기 → 선택 → 결과', () => {
  const s = game.create({ mode: 'cpu', settings: {}, host: { name: '가', token: 'tk' }, now: T0 });
  assert.equal(s.phase, 'memorize');
  assert.equal(game.view(s, 'p1', T0 + 1000).deck, undefined, '카운트다운 중에는 카드를 보내지 않음');
  const v = game.view(s, 'p1', T0 + 4000);
  assert.equal(v.deck.length, 16);
  assert.equal(v.shared, undefined, '암기 중에는 공유 카드를 보내지 않음');

  assert.equal(game.advance(s, T0 + 4000).changed, false);
  assert.equal(game.advance(s, T0 + 24000).changed, true);
  assert.equal(s.phase, 'select');
  const sv = game.view(s, 'p1', T0 + 25000);
  assert.equal(sv.deck, undefined, '선택 단계에는 16장 정보를 숨김');
  assert.equal(sv.shared.length, 3);
  assert.deepEqual(sv.opp.confirmed, true);
  assert.deepEqual(sv.opp.isBot, true);
  assert.equal(sv.opp.picks, undefined, '상대 선택은 노출 금지');

  const p = s.players[0];
  const r = game.handle(s, p, 'confirm', { picks: [0, 1] }, T0 + 30000);
  assert.equal(s.phase, 'result');
  assert.ok(r.events.some((e) => e.type === 'result'));
  assert.ok(['p1', 'p2', 'draw'].includes(s.result.winner));
  assert.equal(game.view(s, 'p1', T0 + 31000).deck.length, 16, '결과에서는 전체 카드 공개');

  game.handle(s, p, 'rematch', {}, T0 + 40000);
  assert.equal(s.phase, 'memorize');
  assert.equal(s.round, 2);
});

test('선택 시간(3분)이 지나면 못 고른 칸을 채우고 자동 종료', () => {
  const s = game.create({ mode: 'cpu', settings: {}, host: { name: '가', token: 'tk' }, now: T0 });
  const a = game.advance(s, T0 + 3000 + 20000 + 180000 + 5);
  assert.equal(s.phase, 'result');
  assert.equal(s.result.timedOut, true);
  assert.equal(s.result.hands.p1.picks.length, 2);
  assert.ok(a.events.length === 1);
});

test('2인 대전: 입장 → 힌트(문제 풀이 후 1장 공개, 1회) → 양쪽 확정 시 결과', () => {
  const s = game.create({ mode: 'pvp', settings: { hintKinds: 'frac' }, host: { name: '가', token: 'a' }, now: T0 });
  assert.equal(s.phase, 'waiting');
  assert.equal(game.join(s, { name: '나', token: 'b' }, T0), 'p2');
  assert.throws(() => game.join(s, { name: '다', token: 'c' }, T0), /이미 두 명/);
  game.advance(s, T0 + 23000);
  const [p1, p2] = s.players;

  game.handle(s, p1, 'hint_start', {}, T0 + 24000);
  const q = p1.hint.q;
  const wrong = game.handle(s, p1, 'hint_answer', { n: '999', d: '1' }, T0 + 25000);
  assert.equal(wrong.response.correct, false);
  assert.equal(p1.hint.status, 'asking');
  const q2 = p1.hint.q;
  const ok = game.handle(s, p1, 'hint_answer', { n: String(q2.n), d: String(q2.d) }, T0 + 26000);
  assert.equal(ok.response.correct, true);
  assert.equal(p1.hint.status, 'ready');
  game.handle(s, p1, 'hint_reveal', { idx: 5 }, T0 + 27000);
  assert.equal(game.view(s, 'p1', T0 + 28000).me.hint.revealed.card, s.deck[5]);
  assert.equal(game.view(s, 'p2', T0 + 28000).me.hint.revealed, null);
  assert.throws(() => game.handle(s, p1, 'hint_start', {}, T0 + 29000), /한 번만/);

  game.handle(s, p1, 'confirm', { picks: [2, 3] }, T0 + 30000);
  assert.equal(s.phase, 'select');
  assert.equal(game.view(s, 'p2', T0 + 30001).opp.confirmed, true);
  assert.throws(() => game.handle(s, p1, 'confirm', { picks: [2, 3] }, T0 + 30000), /이미/);
  game.handle(s, p2, 'confirm', { picks: [4, 6] }, T0 + 31000);
  assert.equal(s.phase, 'result');
  assert.throws(() => game.handle(s, p1, 'confirm', { picks: [1, 1] }, T0), /이미|2장/);
});
