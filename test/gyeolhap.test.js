// 결합: 카드 규칙, 문제 은행, 진행(턴·점수·시간 초과), 컴퓨터, 힌트, 정보 노출 검사
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../netlify/functions/lib/games/gyeolhap/rules');
const Q = require('../netlify/functions/lib/games/gyeolhap/questions');
const bot = require('../netlify/functions/lib/games/gyeolhap/bot');
const G = require('../netlify/functions/lib/games/gyeolhap');

const T0 = 1_000_000;
const mk = (mode = 'pvp', settings = {}) => {
  const s = G.create({ mode, settings, host: { name: '지민', token: 'a' }, now: T0 });
  if (mode === 'pvp') G.join(s, { name: '서준', token: 'b' }, T0);
  return s;
};
const player = (s, id) => s.players.find((p) => p.id === id);
const startAt = (s) => { G.advance(s, T0 + 3000); return T0 + 3000; };   // 첫 라운드 시작
// 정해진 카드로 라운드를 고정 (모양·색·배경 = 카드 번호)
const setCards = (s, cards) => { s.cards = cards; s.sets = rules.allSets(cards); };

test('합 판정: 세 속성이 각각 모두 같거나 모두 다를 때만 합', () => {
  const id = (shape, color, bg) => shape * 9 + color * 3 + bg;
  assert.equal(rules.isSet(id(0, 0, 0), id(1, 1, 0), id(2, 2, 0)), true);  // 모양·색 다름, 배경 같음
  assert.equal(rules.isSet(id(0, 0, 0), id(0, 1, 1), id(0, 2, 2)), true);  // 모양 같음
  assert.equal(rules.isSet(id(0, 0, 0), id(1, 0, 1), id(1, 0, 2)), false); // 모양이 2개+1개
  // 27장 전체: 임의의 두 장에 대해 합을 완성하는 카드는 정확히 1장
  for (let a = 0; a < 27; a++) for (let b = a + 1; b < 27; b++) {
    let n = 0; for (let c = 0; c < 27; c++) if (c !== a && c !== b && rules.isSet(a, b, c)) n++;
    assert.equal(n, 1);
  }
  assert.equal(new Set(rules.deal()).size, 9);
});

test('문제 은행: 빈칸 표시·정답이 있고 학년/학기 범위가 맞다', () => {
  assert.ok(Q.size > 300);
  assert.deepEqual(Q.grades(), [5, 6]);
  assert.deepEqual(Q.semesters(5), [2]);
  assert.deepEqual(Q.semesters(6), [1, 2]);
  assert.deepEqual(Q.cleanScope(9, 'x'), { grade: 6, semester: 'all' });
  assert.deepEqual(Q.cleanScope(5, '1'), { grade: 5, semester: 'all' }); // 5학년 1학기 자료는 없음
  assert.ok(Q.maxAnswerLen() <= 9, '정답은 9자까지');
  const used = [];
  for (const sem of ['1', '2', 'all']) for (let i = 0; i < 50; i++) {
    const q = Q.make({ grade: 6, semester: sem }, used);
    assert.ok(q.text.includes('(      )') && q.answer.length >= 2);
    if (sem !== 'all') assert.ok(q.label.startsWith('6-' + sem));
    assert.ok(q.label.startsWith('6-'));
    assert.ok(Q.make({ grade: 5, semester: 'all' }, used).label.startsWith('5-2'));
    assert.equal(Q.check(q, { text: ' ' + q.answer + ' ' }), true);
    assert.equal(Q.check(q, { text: '' }), false);
  }
  assert.equal(Q.check({ answer: '공업 단지' }, { text: '공업단지' }), true); // 띄어쓰기 무시
});

test('컴퓨터: 난이도가 높을수록 합을 더 자주 찾는다', () => {
  const cards = rules.deal(); const sets = rules.allSets(cards);
  if (!sets.length) return;
  const rate = (lv) => { let n = 0; for (let i = 0; i < 2000; i++) if (bot.plan(lv, cards, sets).act === 'set') n++; return n / 2000; };
  const [e, m, h] = [rate('easy'), rate('normal'), rate('hard')];
  assert.ok(e < m && m < h, `${e} ${m} ${h}`);
});

test('진행: 합 성공 +1, 틀린 합 -1, 턴 교대, 이미 나온 합은 점수 없이 안내', () => {
  const s = mk(); let t = startAt(s);
  assert.equal(s.phase, 'play'); assert.equal(s.turn.pid, 'p1');
  // 합이 반드시 있는 판으로 고정
  setCards(s, [0, 13, 26, 1, 2, 3, 4, 5, 6]);
  const good = [0, 1, 2];
  assert.ok(rules.isSet(0, 13, 26));
  const p1 = player(s, 'p1'), p2 = player(s, 'p2');
  G.handle(s, p1, 'call_set', {}, t + 1000);
  assert.ok(s.turn.naming);
  const bad = G.handle(s, p1, 'name_set', { cards: [3, 4, 5] }, t + 2000); // 합이 아닌 조합(고정 카드 기준)
  if (!bad.response.correct) { assert.equal(p1.score, -1); assert.equal(s.turn.pid, 'p2'); }
  // p2 가 올바른 합
  const p = s.turn.pid === 'p2' ? p2 : p1;
  G.handle(s, p, 'call_set', {}, t + 3000);
  const r = G.handle(s, p, 'name_set', { cards: good }, t + 4000);
  assert.equal(r.response.correct, true);
  assert.equal(s.found.length, 1);
  // 같은 합을 다시 부르면 오류(점수 변화 없음)
  const q = s.turn.pid === 'p1' ? p1 : p2; const before = q.score;
  G.handle(s, q, 'call_set', {}, t + 5000);
  assert.throws(() => G.handle(s, q, 'name_set', { cards: good }, t + 6000), /이미 나온 합/);
  assert.equal(q.score, before);
});

test('시간 초과: 30초 지나면 패스, 6번 연속이면 라운드 종료, 합 지목 5초 초과는 -1', () => {
  const s = mk(); let t = startAt(s);
  setCards(s, [0, 13, 26, 1, 2, 3, 4, 5, 6]);
  const ends = s.turn.endsAt;
  G.advance(s, ends + 100);
  assert.equal(s.turn.pid, 'p2'); assert.equal(s.idle, 1);
  // 한꺼번에 오래 지난 뒤 확인해도 연쇄 처리됨 (5번 더 패스 → 라운드 끝)
  G.advance(s, ends + 100 + 5 * 30000 + 500);
  assert.equal(s.phase, 'between'); assert.equal(s.last.reason, 'idle'); assert.equal(s.round, 1);
  // 다음 라운드는 상대가 선공
  G.advance(s, s.nextAt + 10);
  assert.equal(s.round, 2); assert.equal(s.turn.pid, 'p2');
  // 합을 불렀는데 지목하지 못함
  const p = player(s, 'p2'); const t2 = s.turn.startAt;
  G.handle(s, p, 'call_set', {}, t2 + 1000);
  G.advance(s, t2 + 1000 + 5000 + 2000);
  assert.equal(p.score, -1); assert.equal(s.turn.pid, 'p1');
});

test('결: 합이 남아 있으면 -1 후 턴 넘김, 모두 찾으면 +3 후 라운드 종료', () => {
  const s = mk(); let t = startAt(s);
  setCards(s, [0, 13, 26, 1, 2, 3, 4, 5, 6]);
  s.sets = rules.allSets(s.cards);
  const p1 = player(s, 'p1');
  const r = G.handle(s, p1, 'call_none', {}, t + 500);
  assert.equal(r.response.correct, false); assert.equal(p1.score, -1); assert.equal(s.turn.pid, 'p2');
  // 합을 전부 찾은 것으로 만들고 '결'
  s.found = s.sets.map((x) => ({ t: x, by: 'p1' }));
  const p2 = player(s, 'p2');
  const r2 = G.handle(s, p2, 'call_none', {}, t + 900);
  assert.equal(r2.response.correct, true); assert.equal(p2.score, 3);
  assert.equal(s.phase, 'between'); assert.equal(s.last.reason, 'gyeol');
});

test('10라운드가 끝나면 점수로 승패를 정하고 기록 이벤트를 남긴다 / 다시 하기', () => {
  const s = mk(); let t = startAt(s); let ev = [];
  for (let r = 1; r <= 10; r++) {
    assert.equal(s.round, r);
    s.found = s.sets.map((x) => ({ t: x, by: 'p1' }));
    const cur = player(s, s.turn.pid);
    ev = G.handle(s, cur, 'call_none', {}, s.turn.startAt + 300).events;
    if (r < 10) G.advance(s, s.nextAt + 5);
  }
  assert.equal(s.phase, 'result');
  assert.equal(s.result.scores.p1 + s.result.scores.p2, 30);
  assert.equal(s.result.winner, 'draw'); // 선공이 번갈아 5번씩
  assert.equal(ev.find((e) => e.type === 'result').hands.scores.p1, 15);
  G.handle(s, player(s, 'p1'), 'rematch', {}, t); G.handle(s, player(s, 'p2'), 'rematch', {}, t);
  assert.equal(s.phase, 'between'); assert.equal(s.round, 0); assert.equal(player(s, 'p1').score, 0);
});

test('힌트: 문제를 맞히면 시간 +10초(한 턴 1번) / 결합 힌트는 남은 합 수 공개(게임당 3번)', () => {
  const s = mk(); let t = startAt(s);
  setCards(s, [0, 13, 26, 1, 2, 3, 4, 5, 6]);
  const p = player(s, 'p1');
  G.handle(s, p, 'hint_start', { kind: 'time' }, t + 100);
  const q = p.hint.q;
  const wrong = G.handle(s, p, 'hint_answer', { text: '틀린답!!' }, t + 200);
  assert.equal(wrong.response.correct, false); assert.equal(wrong.events[0].correct, false);
  assert.ok(p.hint.q && p.hint.q.text);               // 틀리면 새 문제
  const end0 = s.turn.endsAt;
  const ok = G.handle(s, p, 'hint_answer', { text: p.hint.q.answer }, t + 300);
  assert.equal(ok.response.correct, true);
  assert.equal(s.turn.endsAt, end0 + 10000);
  assert.throws(() => G.handle(s, p, 'hint_start', { kind: 'time' }, t + 400), /한 번만/);

  G.handle(s, p, 'hint_start', { kind: 'info' }, t + 500);
  G.handle(s, p, 'hint_answer', { text: p.hint.q.answer }, t + 600);
  const v = G.view(s, 'p1', t + 700);
  assert.equal(v.me.hint.info.remaining, s.sets.length);
  assert.equal(v.me.hint.infoLeft, 2);
  assert.throws(() => G.handle(s, p, 'hint_start', { kind: 'info' }, t + 700), /이미/);
  // 내 차례가 아니면 힌트 불가 / 다음 턴이 되면 힌트 표시는 사라짐
  assert.throws(() => G.handle(s, player(s, 'p2'), 'hint_start', { kind: 'time' }, t + 800), /내 차례/);
  G.handle(s, p, 'pass', {}, t + 900);
  assert.equal(G.view(s, 'p1', t + 1000).me.hint.info, null);
});

test('컴퓨터와 한 판: 시간을 건너뛰며 끝까지 진행되고 정답·계획은 노출되지 않는다', () => {
  for (const lv of ['easy', 'normal', 'hard']) {
    const s = mk('cpu', { botLevel: lv }); let now = T0 + 3000;
    for (let i = 0; i < 3000 && s.phase !== 'result'; i++) {
      G.advance(s, now);
      if (s.phase === 'play' && s.turn.pid === 'p1') G.handle(s, player(s, 'p1'), 'pass', {}, now);
      now += 7000;
    }
    assert.equal(s.phase, 'result', lv);
    const v = G.view(s, 'p1', now);
    const json = JSON.stringify(v);
    assert.ok(!json.includes('"bot"') && !json.includes('token'));
  }
  const s = mk('cpu'); startAt(s);
  G.handle(s, player(s, 'p1'), 'hint_start', { kind: 'time' }, T0 + 3100);
  const v = G.view(s, 'p1', T0 + 3200);
  assert.ok(!JSON.stringify(v).includes(player(s, 'p1').hint.q.answer + '"'));
  assert.equal(v.sets, undefined);
});
