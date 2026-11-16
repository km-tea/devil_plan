// 워드 타워: 문제 데이터(주제 10개·난이도·풀이 가능), 라운드 진행, 협력(최대 7명), 시간 초과, 정보 노출 검사
const test = require('node:test');
const assert = require('node:assert/strict');
const TOPICS = require('../netlify/functions/lib/games/word-tower/topics');
const G = require('../netlify/functions/lib/games/word-tower');

const T0 = 1_000_000;
const mkSolo = (settings = {}) => G.create({ mode: 'cpu', settings, host: { name: '지민', token: 't1' }, now: T0 });
const mkRoom = (n = 1, settings = {}) => {
  const s = G.create({ mode: 'pvp', settings, host: { name: '지민', token: 't1' }, now: T0 });
  for (let i = 2; i <= n; i++) G.join(s, { name: '친구' + i, token: 't' + i }, T0);
  return s;
};
const pl = (s, id) => s.players.find((p) => p.id === id);
const topicOf = (s) => TOPICS.find((t) => t.id === s.queue[s.round - 1]);

// 단어 목록으로 큐브를 줄에 배치 (글자마다 아직 안 쓴 큐브를 하나씩 사용)
function place(s, words, player = pl(s, 'p1'), now = T0 + 1000) {
  const used = new Set(s.rows.flat());
  words.forEach((w, row) => {
    for (const ch of w) {
      const c = s.cubes.find((x) => x.ch === ch && !used.has(x.id));
      assert.ok(c, `큐브 ${ch} 없음`);
      used.add(c.id);
      G.handle(s, player, 'add', { row, cube: c.id }, now);
    }
  });
}

// 큐브 글자로 만들 수 있는 "서로 다른 7단어" 조합을 모두 찾는다
function allSolutions(t) {
  const cnt = {}; for (const ch of t.answer.join('')) cnt[ch] = (cnt[ch] || 0) + 1;
  const words = t.accept.filter((w) => { const c = { ...cnt }; return [...w].every((ch) => c[ch]-- > 0); });
  const out = [];
  (function dfs(left, chosen, start) {
    if (chosen.length === 7) { if (Object.values(left).every((v) => v === 0)) out.push(chosen); return; }
    for (let i = start; i < words.length; i++) {
      const l = { ...left }; if ([...words[i]].every((ch) => l[ch]-- > 0)) dfs(l, chosen.concat(words[i]), i + 1);
    }
  })(cnt, [], 0);
  return out;
}

test('문제 데이터: 주제 10개, 난이도 하3·중4·상3, 단어 7개씩, 풀이 가능, 예시 단어와 겹치지 않음', () => {
  assert.equal(TOPICS.length, 10);
  const lv = (l) => TOPICS.filter((t) => t.level === l).length;
  assert.deepEqual([lv('low'), lv('mid'), lv('high')], [3, 4, 3]);
  assert.equal(new Set(TOPICS.map((t) => t.id)).size, 10);
  for (const t of TOPICS) {
    assert.equal(t.answer.length, 7, t.name);
    assert.equal(new Set(t.answer).size, 7, t.name);
    for (const w of t.answer) { assert.match(w, /^[A-Z]{3,10}$/, w); assert.ok(t.accept.includes(w)); assert.ok(t.ko[w], w + ' 뜻'); }
    assert.ok(t.accept.every((w) => /^[A-Z]{2,12}$/.test(w)), t.name + ' 허용 단어는 대문자 알파벳');
    assert.ok(allSolutions(t).length >= 1, t.name + ' 풀 수 있어야 함');
  }
  // 난이도: 큐브 수·긴 단어가 하 < 중 < 상 (평균)
  const avg = (l) => { const ts = TOPICS.filter((t) => t.level === l); return ts.reduce((n, t) => n + t.answer.join('').length, 0) / ts.length; };
  assert.ok(avg('low') < avg('mid') && avg('mid') < avg('high'), `${avg('low')} ${avg('mid')} ${avg('high')}`);
  // 같은 주제를 만들더라도 사용자가 준 예시 단어는 쓰지 않는다
  const examples = { 나라: 'QATAR JAPAN INDIA BRAZIL SPAIN CANADA FINLAND', 과일: 'COCONUT KIWI CHERRY PEAR AVOCADO GRAPE DURIAN', 동물: 'GIRAFFE PIG ZEBRA WOLF FOX BUTTERFLY PENGUIN' };
  for (const [name, ws] of Object.entries(examples)) {
    const t = TOPICS.find((x) => x.name === name);
    assert.ok(t, name + ' 주제');
    assert.ok(ws.split(' ').every((w) => !t.answer.includes(w)), name + ' 정답 단어가 예시와 달라야 함');
  }
});

test('라운드 구성: 전체는 하→중→상 순서, 맛보기는 단계별 1개, 단계 선택', () => {
  const lvOf = (id) => TOPICS.find((t) => t.id === id).level;
  const order = { low: 0, mid: 1, high: 2 };
  const all = mkSolo({ level: 'all' });
  assert.equal(all.queue.length, 10);
  assert.ok(all.queue.every((id, i, a) => i === 0 || order[lvOf(a[i - 1])] <= order[lvOf(id)]), '난이도 순서');
  assert.deepEqual(mkSolo({ level: 'mix3' }).queue.map(lvOf), ['low', 'mid', 'high']);
  for (const [l, n] of [['low', 3], ['mid', 4], ['high', 3]]) { const q = mkSolo({ level: l }).queue; assert.equal(q.length, n); assert.ok(q.every((id) => lvOf(id) === l)); }
  assert.equal(mkSolo({ level: 'nope' }).settings.level, 'all');
});

test('혼자 하기: 바로 시작, 큐브는 정답 글자 전부, 화면에는 정답이 없다', () => {
  const s = mkSolo({ level: 'mix3' });
  assert.equal(s.phase, 'play'); assert.equal(s.round, 1);
  const t = topicOf(s);
  assert.equal(s.cubes.length, t.answer.join('').length);
  assert.equal([...s.cubes.map((c) => c.ch)].sort().join(''), t.answer.join('').split('').sort().join(''));
  assert.equal(s.rows.length, 7);
  const v = G.view(s, 'p1', T0);
  const json = JSON.stringify(v);
  assert.ok(!json.includes('"ko"') && !json.includes('accept') && !json.includes('"answer"'));
  assert.ok(t.answer.every((w) => !json.includes(w)), '정답 단어가 화면 정보에 없음');
  assert.equal(v.topic.name, t.name); assert.equal(v.endsAt, T0 + 300000);
});

test('큐브 놓기·빼기·비우기: 같은 큐브는 한 곳에만, 줄은 7개·12칸', () => {
  const s = mkRoom(3, {}); G.handle(s, pl(s, 'p1'), 'start', {}, T0);
  const [a, b] = s.cubes;
  G.handle(s, pl(s, 'p2'), 'add', { row: 1, cube: a.id }, T0 + 100);
  assert.throws(() => G.handle(s, pl(s, 'p3'), 'add', { row: 2, cube: a.id }, T0 + 120), /이미 다른 곳/);
  assert.throws(() => G.handle(s, pl(s, 'p3'), 'add', { row: 9, cube: b.id }, T0 + 120), /줄을 확인/);
  assert.throws(() => G.handle(s, pl(s, 'p3'), 'add', { row: 2, cube: 'zz' }, T0 + 120), /없는 큐브/);
  G.handle(s, pl(s, 'p3'), 'add', { row: 1, cube: b.id }, T0 + 130);
  assert.deepEqual(s.rows[1], [a.id, b.id]);
  G.handle(s, pl(s, 'p1'), 'remove', { cube: a.id }, T0 + 140);
  assert.deepEqual(s.rows[1], [b.id]);
  assert.throws(() => G.handle(s, pl(s, 'p1'), 'remove', { cube: a.id }, T0 + 150), /이미 빼/);
  G.handle(s, pl(s, 'p1'), 'clear', { row: 1 }, T0 + 160);
  assert.deepEqual(s.rows[1], []);
  s.cubes.slice(0, 12).forEach((c) => G.handle(s, pl(s, 'p1'), 'add', { row: 0, cube: c.id }, T0 + 200));
  assert.throws(() => G.handle(s, pl(s, 'p1'), 'add', { row: 0, cube: s.cubes[12].id }, T0 + 210), /12개/);
});

test('확인: 맞은 줄 수 알려 주기, 정답 예시와 달라도 주제에 맞는 단어면 인정, 큐브를 다 써야 성공', () => {
  const s = mkSolo({ level: 'low' });
  const t = topicOf(s);
  const p1 = pl(s, 'p1');
  // 단어 3개만 맞춤
  place(s, t.answer.slice(0, 3), p1);
  let r = G.handle(s, p1, 'check', {}, T0 + 2000);
  assert.equal(r.response.valid, 3); assert.equal(r.response.solved, false); assert.equal(s.phase, 'play');
  assert.equal(G.view(s, 'p1', T0).check.valid, 3);
  assert.equal(G.view(s, 'p1', T0).check.unused, s.cubes.length - t.answer.slice(0, 3).join('').length);
  // 틀린 단어(주제에 없는 글자 조합)는 맞은 줄로 세지 않음
  const x = s.cubes.find((c) => !s.rows.flat().includes(c.id));
  G.handle(s, p1, 'add', { row: 5, cube: x.id }, T0 + 2100);
  assert.equal(G.handle(s, p1, 'check', {}, T0 + 2200).response.valid, 3);
  G.handle(s, p1, 'clear', { row: 5 }, T0 + 2300);
  // 나머지를 채워 성공
  const rest = t.answer.slice(3);
  const used = new Set(s.rows.flat());
  rest.forEach((w, i) => { for (const ch of w) { const c = s.cubes.find((q) => q.ch === ch && !used.has(q.id)); used.add(c.id); G.handle(s, p1, 'add', { row: 3 + i, cube: c.id }, T0 + 2400); } });
  r = G.handle(s, p1, 'check', {}, T0 + 60000);
  assert.equal(r.response.solved, true);
  assert.equal(s.phase, 'between'); assert.equal(s.last.solved, true); assert.equal(s.results[0].sec, 60); // T0+60000 에 확인 = 라운드 시작 후 60초
  assert.ok(r.events.every((e) => e.type === 'answer' && e.correct === true && e.kind === 'wordtower'));
  assert.match(r.events[0].prompt, /워드 타워 하\] /);
  assert.equal(s.last.words.length, 7);
  assert.ok(s.last.words.every((w) => w.ko), '뜻이 함께 나옴');
});

test('정답 예시와 다른 단어로 풀어도 인정 (같은 큐브로 만들 수 있는 다른 조합)', () => {
  const t = TOPICS.find((x) => x.id === 'weather');
  const alt = allSolutions(t).find((sol) => sol.slice().sort().join() !== t.answer.slice().sort().join());
  assert.ok(alt, '날씨 주제에는 다른 정답 조합이 있음');
  const s = mkSolo({ level: 'low' });
  // 날씨 라운드를 강제로 현재 라운드로
  s.queue[0] = 'weather'; G.handle(s, pl(s, 'p1'), 'giveup', {}, T0 + 10); G.advance(s, T0 + 10 + 20001);
  s.queue[s.round - 1] = 'weather';
  s.cubes = t.answer.join('').split('').map((ch, i) => ({ id: 'c' + i, ch })); s.rows = Array.from({ length: 7 }, () => []);
  place(s, alt, pl(s, 'p1'), T0 + 100000);
  const r = G.handle(s, pl(s, 'p1'), 'check', {}, T0 + 100500);
  assert.equal(r.response.solved, true);
});

test('큐브를 하나라도 안 쓰면(또는 단어가 틀리면) 성공이 아니다', () => {
  const s = mkSolo({ level: 'low' }); const t = topicOf(s); const p1 = pl(s, 'p1');
  place(s, t.answer, p1);
  s.rows[6].pop();                                   // 마지막 단어의 글자 하나를 뺌 → 틀린 단어 + 큐브 남음
  const r = G.handle(s, p1, 'check', {}, T0 + 3000);
  assert.equal(r.response.solved, false); assert.equal(r.response.valid, 6); assert.equal(s.phase, 'play');
});

test('확인 방식: 맞은 줄 표시(rows) / 개수만(count)', () => {
  for (const [fb, hasRows] of [['rows', true], ['count', false]]) {
    const s = mkSolo({ level: 'low', feedback: fb }); const t = topicOf(s);
    place(s, t.answer.slice(0, 2), pl(s, 'p1'));
    G.handle(s, pl(s, 'p1'), 'check', {}, T0 + 3000);
    const c = G.view(s, 'p1', T0).check;
    assert.equal(c.rows !== null, hasRows);
    if (hasRows) { assert.equal(c.rows[0].ok, true); assert.equal(c.rows[0].sig, s.rows[0].join(',')); assert.equal(c.rows[3].ok, false); }
  }
});

test('시간: 5분이 지나면 정답 예시를 보여 주고, 20초 뒤 다음 라운드 → 마지막 라운드 뒤 결과', () => {
  const s = mkSolo({ level: 'mix3' });
  const t1 = topicOf(s);
  G.advance(s, T0 + 299000); assert.equal(s.phase, 'play');
  const a = G.advance(s, T0 + 300001);
  assert.equal(s.phase, 'between'); assert.equal(s.last.solved, false); assert.equal(s.last.reason, 'time');
  assert.deepEqual(s.last.words.map((w) => w.w), t1.answer, '정답 예시');
  assert.ok(a.events.length === 1 && a.events[0].correct === false);
  G.advance(s, T0 + 300000 + 20000 + 1);
  assert.equal(s.phase, 'play'); assert.equal(s.round, 2); assert.equal(s.startAt, T0 + 320000);
  // 한꺼번에 오래 지나도 라운드가 연쇄로 정리되고 마지막에 결과
  const b = G.advance(s, T0 + 5_000_000);
  assert.equal(s.phase, 'result'); assert.deepEqual(s.final, { solved: 0, total: 3, seconds: 900 });
  assert.equal(b.events.filter((e) => e.type === 'coop').length, 1);
  assert.deepEqual(b.events.find((e) => e.type === 'coop').hands, { solved: 0, total: 3, seconds: 900, players: 1 });
});

test('방: 방장이 시작, 최대 7명, 시작 뒤에는 입장 불가, 방장 전용 동작', () => {
  const s = mkRoom(1);
  assert.equal(s.phase, 'lobby');
  for (let i = 2; i <= 7; i++) assert.equal(G.join(s, { name: '친구' + i, token: 't' + i }, T0), 'p' + i);
  assert.throws(() => G.join(s, { name: '여덟째', token: 't8' }, T0), /7명/);
  assert.throws(() => G.handle(s, pl(s, 'p2'), 'start', {}, T0), /방장/);
  assert.throws(() => G.handle(s, pl(s, 'p1'), 'add', { row: 0, cube: 'c0' }, T0), /지금은/);
  G.handle(s, pl(s, 'p1'), 'start', {}, T0 + 5);
  assert.equal(s.phase, 'play'); assert.equal(s.startAt, T0 + 5);
  assert.throws(() => G.join(s, { name: '늦은 친구', token: 't9' }, T0), /이미 시작/);
  assert.equal(G.view(s, 'p4', T0).me.index, 3); assert.equal(G.view(s, 'p4', T0).players.length, 7);
  assert.throws(() => G.handle(s, pl(s, 'p2'), 'giveup', {}, T0 + 10), /방장/);
  G.handle(s, pl(s, 'p1'), 'giveup', {}, T0 + 10);
  assert.equal(s.phase, 'between'); assert.equal(s.last.reason, 'giveup');
  assert.throws(() => G.handle(s, pl(s, 'p3'), 'next', {}, T0 + 11), /방장/);
  G.handle(s, pl(s, 'p1'), 'next', {}, T0 + 12);
  assert.equal(s.round, 2);
  // 7명 모두에게 학습 기록 이벤트가 하나씩
  const s2 = mkRoom(7); G.handle(s2, pl(s2, 'p1'), 'start', {}, T0);
  const r = G.handle(s2, pl(s2, 'p1'), 'giveup', {}, T0 + 1);
  assert.equal(r.events.length, 7); assert.deepEqual(r.events.map((e) => e.pid), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  assert.throws(() => G.join(mkSolo(), { name: 'x', token: 'y' }, T0), /혼자/);
});

test('한 판이 끝나면 결과 → 방장이 다시 시작', () => {
  const s = mkSolo({ level: 'mix3' }); const p1 = pl(s, 'p1');
  let now = T0;
  for (let r = 1; r <= 3; r++) {
    const t = topicOf(s); place(s, t.answer, p1, now + 100);
    const res = G.handle(s, p1, 'check', {}, now + 200);
    assert.equal(res.response.solved, true);
    if (r < 3) { G.handle(s, p1, 'next', {}, now + 300); now += 300; }
  }
  assert.equal(s.phase, 'between');
  G.handle(s, p1, 'next', {}, now + 400);
  assert.equal(s.phase, 'result'); assert.deepEqual([s.final.solved, s.final.total], [3, 3]);
  assert.equal(G.view(s, 'p1', now).results.length, 3);
  G.handle(s, p1, 'rematch', {}, now + 500);
  assert.equal(s.phase, 'play'); assert.equal(s.round, 1); assert.equal(s.results.length, 0);
});
