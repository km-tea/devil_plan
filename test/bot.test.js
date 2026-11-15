const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../netlify/functions/lib/games/memory-poker/rules');
const bot = require('../netlify/functions/lib/games/memory-poker/bot');

function sample(level, n = 3000) {
  let sum = 0, notBest = 0;
  const hist = Array(9).fill(0);
  for (let i = 0; i < n; i++) {
    const deck = rules.shuffle(rules.fullDeck());
    const shared = deck.slice(16, 19), d = deck.slice(0, 16);
    const pair = bot.choose(d, shared, level);
    assert.equal(pair.length, 2);
    assert.ok(pair[0] !== pair[1] && pair.every((x) => Number.isInteger(x) && x >= 0 && x < 16));
    const cat = rules.evaluate([...shared, d[pair[0]], d[pair[1]]]).cat;
    let best = 0;
    for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) best = Math.max(best, rules.evaluate([...shared, d[a], d[b]]).cat);
    sum += cat; hist[cat]++;
    if (cat < best) notBest++;
  }
  return { mean: sum / n, notBest: notBest / n, hist };
}

test('컴퓨터 난이도: 어려울수록 높은 족보가 나올 확률이 높음', () => {
  const e = sample('easy'), m = sample('normal'), h = sample('hard');
  console.log('  평균 족보 등급 — 쉬움', e.mean.toFixed(2), '보통', m.mean.toFixed(2), '어려움', h.mean.toFixed(2));
  console.log('  쉬움 분포', e.hist.join(','), '\n  보통 분포', m.hist.join(','), '\n  어려움 분포', h.hist.join(','));
  assert.ok(e.mean < m.mean && m.mean < h.mean);
});

test('컴퓨터는 항상 최선을 고르지 않음 (쉬움·보통·어려움 모두 가끔 낮은 족보)', () => {
  for (const lv of ['easy', 'normal', 'hard']) assert.ok(sample(lv, 1500).notBest > 0.15, lv);
});

test('난이도 값이 이상해도 보통으로 처리', () => {
  const deck = rules.shuffle(rules.fullDeck());
  assert.equal(bot.choose(deck.slice(0, 16), deck.slice(16, 19), 'zzz').length, 2);
});
