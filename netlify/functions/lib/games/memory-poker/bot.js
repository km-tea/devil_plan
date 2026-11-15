'use strict';
// 컴퓨터 상대: 항상 최선을 고르지 않고, "만들 수 있는 족보 중 하나"를 난이도별 확률로 뽑는다.
//  1) 16장 중 2장을 고르는 모든 경우(120가지)의 족보를 계산
//  2) 만들 수 있는 족보들 사이에서 난이도별 가중치로 족보 하나를 뽑음
//  3) 그 족보가 되는 조합 중 하나를 무작위로 고름
const { evaluate } = require('./rules');

// 가중치 순서: 하이카드, 원페어, 투페어, 트리플, 스트레이트, 플러시, 풀하우스, 포카드, 스트레이트 플러시
// (이번 판에서 만들 수 있는 족보끼리만 비율이 적용됨)
const WEIGHTS = {
  easy:   [45, 38, 10, 4, 2, 0.8, 0.2, 0.05, 0.01],
  normal: [12, 28, 26, 16, 9, 5, 3, 1, 0.3],
  hard:   [1, 5, 14, 26, 24, 16, 12, 6, 3],
};

function choose(deck, shared, level, rng = Math.random) {
  const w = WEIGHTS[level] || WEIGHTS.normal;
  const byCat = new Map();
  for (let a = 0; a < deck.length; a++) {
    for (let b = a + 1; b < deck.length; b++) {
      const cat = evaluate([...shared, deck[a], deck[b]]).cat;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push([a, b]);
    }
  }
  const cats = [...byCat.keys()];
  const total = cats.reduce((s, c) => s + w[c], 0);
  let r = rng() * total;
  let picked = cats[cats.length - 1];
  for (const c of cats) { r -= w[c]; if (r < 0) { picked = c; break; } }
  const pairs = byCat.get(picked);
  return pairs[Math.floor(rng() * pairs.length)];
}

module.exports = { choose, WEIGHTS };
