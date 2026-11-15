'use strict';
// 컴퓨터 상대: 자기 턴이 시작되면(= 사람이 행동한 직후) 10초 안에 반드시 답을 낸다.
//  - 실수하지 않으면: 남은 합이 있으면 합을 맞히고, 합이 없으면 '결'을 맞힌다.
//  - 실수하면(확률 mistake): 틀린 합을 부르거나, 합이 남았는데 '결'을 외친다(-1점).
// 난이도는 "실수할 확률"과 "생각하는 시간(모두 10초 이내)"으로 나눈다. 숫자는 PARAMS 에서 조정하세요.
const { isSet } = require('./rules');

const MAX_DELAY_SEC = 10;
const PARAMS = {
  easy:   { mistake: 0.25, delay: [5, 10] },
  normal: { mistake: 0.12, delay: [3.5, 8] },
  hard:   { mistake: 0.04, delay: [2, 6] },
};

const pickOne = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function wrongTriple(cards, rng) {
  for (let n = 0; n < 200; n++) {
    const idx = [...Array(cards.length).keys()];
    const t = [];
    while (t.length < 3) t.push(idx.splice(Math.floor(rng() * idx.length), 1)[0]);
    t.sort((a, b) => a - b);
    if (!isSet(cards[t[0]], cards[t[1]], cards[t[2]])) return t;
  }
  return [0, 1, 2];
}

// remaining: 아직 아무도 부르지 않은 합 목록. 반환: { delaySec(≤10), act, set }
function plan(level, cards, remaining, rng = Math.random) {
  const p = PARAMS[level] || PARAMS.normal;
  const delaySec = Math.min(MAX_DELAY_SEC, p.delay[0] + rng() * (p.delay[1] - p.delay[0]));
  const mistake = rng() < p.mistake;
  if (remaining.length) {
    if (!mistake) return { delaySec, act: 'set', set: pickOne(remaining, rng) };
    return rng() < 0.65 ? { delaySec, act: 'wrongset', set: wrongTriple(cards, rng) } : { delaySec, act: 'gyeol' }; // 'gyeol' 은 합이 남아 있어 틀림
  }
  return mistake ? { delaySec, act: 'wrongset', set: wrongTriple(cards, rng) } : { delaySec, act: 'gyeol' };
}

module.exports = { plan, PARAMS, MAX_DELAY_SEC };
