const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, compare } = require('../netlify/functions/lib/games/memory-poker/rules');
const Q = require('../netlify/functions/lib/games/memory-poker/questions');

const ev = (s) => evaluate(s.split(' '));

test('족보 9종 판정', () => {
  const cases = [
    ['D2 D3 D4 D5 D6', 8], ['D2 H2 C2 S2 H7', 7], ['D2 C2 S2 H7 S7', 6], ['D2 D5 D9 DQ DK', 5],
    ['D2 C3 S4 H5 S6', 4], ['D2 C2 S2 H5 D6', 3], ['D2 H2 H7 S7 HQ', 2], ['D2 C2 S4 H7 S9', 1], ['DK C2 S4 H7 S9', 0],
  ];
  for (const [hand, cat] of cases) assert.equal(ev(hand).cat, cat, hand);
});

test('에이스 스트레이트: A-2-3-4-5 는 5가 최고, 10-J-Q-K-A 가 가장 높음', () => {
  assert.equal(ev('DA C2 S3 H4 S5').cat, 4);
  assert.ok(compare(ev('D6 C2 S3 H4 S5'), ev('DA C2 S3 H4 S5')) > 0);
  assert.ok(compare(ev('DT CJ SQ HK SA'), ev('D9 CT SJ HQ SK')) > 0);
});

test('같은 족보는 나머지 숫자로 비교', () => {
  assert.ok(compare(ev('DK CK S2 H5 S9'), ev('DQ CQ SA H5 S9')) > 0);      // 페어 K > 페어 Q
  assert.ok(compare(ev('DK CK S2 H5 SA'), ev('DK HK S2 H5 S9')) > 0);      // 같은 페어, 키커 A > 9
  assert.equal(compare(ev('DK CK S2 H5 S9'), ev('HK SK D2 C5 H9')), 0);    // 완전히 같으면 무승부
  assert.ok(compare(ev('D2 C2 S2 H7 S7'), ev('D3 C3 S3 H4 S4')) < 0);      // 풀하우스: 트리플 숫자 우선
});

test('분수/소수 정답 확인', () => {
  const f = { kind: 'frac', n: 3, d: 4 };
  assert.ok(Q.check(f, { n: '3', d: '4' }));
  assert.ok(Q.check(f, { n: '6', d: '8' }));   // 약분 안 해도 값이 같으면 정답
  assert.ok(!Q.check(f, { n: '3', d: '5' }));
  assert.ok(Q.check({ kind: 'frac', n: 3, d: 1 }, { n: '3', d: '' })); // 자연수 답
  assert.ok(Q.check({ kind: 'dec', value: 2.5 }, { v: '2.50' }));
  assert.ok(!Q.check({ kind: 'dec', value: 2.5 }, { v: '25' }));
});

test('문제 생성(분수·소수·비례배분 섞기): 정답이 항상 깔끔함', () => {
  for (let i = 0; i < 500; i++) {
    const q = Q.make('mix');
    if (q.kind === 'frac') { assert.ok(q.n > 0 && q.d > 0); assert.ok(Q.check(q, { n: String(q.n), d: String(q.d) })); }
    else if (q.kind === 'dec') { assert.ok(Q.check(q, { v: String(q.value) })); assert.match(q.prompt, /^\d+(\.\d+)? ÷ \d+(\.\d+)?$/); }
    else { assert.equal(q.kind, 'ratio'); assert.ok(Q.check(q, { v: String(q.value) })); }
  }
});

test('비례배분 문제: 정수 답, 올바른 값, 조사', () => {
  for (let i = 0; i < 800; i++) {
    const q = Q.make('ratio');
    assert.equal(q.kind, 'ratio');
    const m = q.prompt.match(/^\S+ (\d+)(개|장|자루)(를|을) ((?:\d+:)+\d+)(으?로) 나누어 가질 때, (\d+)에 해당하는 양은 몇 (개|장|자루)일까요\?$/);
    assert.ok(m, q.prompt);
    const total = +m[1], parts = m[4].split(':').map(Number), part = +m[6];
    const sum = parts.reduce((a, b) => a + b, 0);
    assert.ok(parts.includes(part) && new Set(parts).size === parts.length);
    assert.equal(total % sum, 0);
    assert.equal(q.value, (total / sum) * part);
    assert.equal(m[5], [3, 6].includes(parts[parts.length - 1]) ? '으로' : '로');
    assert.equal(m[3], m[2] === '장' ? '을' : '를');
    assert.ok(Q.check(q, { v: String(q.value) }) && !Q.check(q, { v: String(q.value + 1) }));
  }
  assert.ok(Q.check({ kind: 'ratio', value: 4 }, { v: '4' }));
});
