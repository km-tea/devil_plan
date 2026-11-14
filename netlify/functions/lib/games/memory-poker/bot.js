'use strict';
// 컴퓨터 상대: 16장 중 일부만 "기억"하고, 기억한 카드 안에서 가장 강한 2장을 고릅니다.
const { evaluate, compare, shuffle } = require('./rules');
const MEMORY = { easy: 0.5, normal: 0.7, hard: 0.9 };

function choose(deck, shared, level, rng = Math.random) {
  const p = MEMORY[level] || MEMORY.normal;
  const known = [];
  for (let i = 0; i < deck.length; i++) if (rng() < p) known.push(i);

  let best = null, bestPair = null;
  for (let a = 0; a < known.length; a++) {
    for (let b = a + 1; b < known.length; b++) {
      const h = evaluate([...shared, deck[known[a]], deck[known[b]]]);
      if (!best || compare(h, best) > 0) { best = h; bestPair = [known[a], known[b]]; }
    }
  }
  if (!bestPair) { // 거의 못 외운 경우: 찍기
    const pool = shuffle([...deck.keys()], rng);
    bestPair = [pool[0], pool[1]];
  }
  return bestPair;
}

module.exports = { choose };
