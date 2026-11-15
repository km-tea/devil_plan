'use strict';
// 컴퓨터 상대: 자기 턴이 시작될 때 "이번 턴에 무엇을 할지"와 "몇 초 뒤에 할지"를 미리 정한다.
//  - 남은 합이 있으면: 확률 find 로 합을 찾고, 아니면 패스(가끔 틀린 합/잘못된 결)
//  - 남은 합이 없으면: 확률 gyeol 로 '결'을 외치고, 아니면 패스(가끔 틀린 합)
// 어려울수록 빨리, 정확하게 찾는다. 확률은 아래 PARAMS 에서 조정하세요.
const { isSet } = require('./rules');

const PARAMS = {
  easy:   { find: 0.35, wrong: 0.12, falseGyeol: 0.04, gyeol: 0.30, delay: [14, 26] },
  normal: { find: 0.60, wrong: 0.06, falseGyeol: 0.02, gyeol: 0.60, delay: [8, 20] },
  hard:   { find: 0.85, wrong: 0.02, falseGyeol: 0.005, gyeol: 0.85, delay: [4, 12] },
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

// remaining: 아직 아무도 부르지 않은 합 목록. 반환: { delaySec, act, set }
function plan(level, cards, remaining, rng = Math.random) {
  const p = PARAMS[level] || PARAMS.normal;
  const delaySec = p.delay[0] + rng() * (p.delay[1] - p.delay[0]);
  const r = rng();
  if (remaining.length) {
    if (r < p.find) return { delaySec, act: 'set', set: pickOne(remaining, rng) };
    if (r < p.find + p.wrong) return { delaySec, act: 'wrongset', set: wrongTriple(cards, rng) };
    if (r < p.find + p.wrong + p.falseGyeol) return { delaySec, act: 'gyeol' };
    return { delaySec, act: 'pass' };
  }
  if (r < p.gyeol) return { delaySec, act: 'gyeol' };
  if (r < p.gyeol + p.wrong) return { delaySec, act: 'wrongset', set: wrongTriple(cards, rng) };
  return { delaySec, act: 'pass' };
}

module.exports = { plan, PARAMS };
