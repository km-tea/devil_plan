'use strict';
// 카드 코드: 무늬(S♠ H♥ D♦ C♣) + 숫자(2~9, T=10, J, Q, K, A)  예) 'DA' = ♦A, 'HT' = ♥10
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

const rankVal = (r) => RANKS.indexOf(r) + 2;

function fullDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(s + r);
  return d;
}

function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 5장의 족보 판정 → { cat: 0~8, tb: 비교용 숫자 배열, name }
function evaluate(cards) {
  const cs = cards.map((c) => ({ s: c[0], r: rankVal(c[1]) }));
  const vals = cs.map((c) => c.r).sort((a, b) => b - a);
  const flush = cs.every((c) => c.s === cs[0].s);

  let straightHigh = 0;
  if (new Set(vals).size === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // A-2-3-4-5
  }

  const count = {};
  vals.forEach((v) => { count[v] = (count[v] || 0) + 1; });
  const groups = Object.entries(count)
    .map(([v, c]) => ({ v: +v, c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);
  const shape = groups.map((g) => g.c).join('');
  const byGroup = groups.map((g) => g.v);

  let cat, tb;
  if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
  else if (shape === '41') { cat = 7; tb = byGroup; }
  else if (shape === '32') { cat = 6; tb = byGroup; }
  else if (flush) { cat = 5; tb = vals; }
  else if (straightHigh) { cat = 4; tb = [straightHigh]; }
  else if (shape === '311') { cat = 3; tb = byGroup; }
  else if (shape === '221') { cat = 2; tb = byGroup; }
  else if (shape === '2111') { cat = 1; tb = byGroup; }
  else { cat = 0; tb = vals; }
  return { cat, tb, name: HAND_NAMES[cat] };
}

// a가 더 강하면 양수, 약하면 음수, 같으면 0 (족보가 같으면 나머지 카드 숫자 순서대로 비교)
function compare(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.tb.length, b.tb.length); i++) {
    const d = (a.tb[i] || 0) - (b.tb[i] || 0);
    if (d) return d;
  }
  return 0;
}

module.exports = { SUITS, RANKS, HAND_NAMES, fullDeck, shuffle, evaluate, compare };
