'use strict';
// 결합 — 카드 규칙
// 카드 27장 = 모양(3) × 색(3) × 배경색(3). 카드 번호 0~26: 모양 = ⌊n/9⌋, 색 = ⌊n/3⌋%3, 배경색 = n%3
// 한 속성의 세 값이 "모두 같거나 모두 다르면" 그 속성은 통과 ↔ (a+b+c)가 3의 배수.
// 모양·색·배경색 세 속성이 모두 통과하면 '합'.
const ALL = 27;
const attrs = (n) => [Math.floor(n / 9), Math.floor(n / 3) % 3, n % 3];

function isSet(a, b, c) {
  if (a === b || b === c || a === c) return false;
  const x = attrs(a), y = attrs(b), z = attrs(c);
  for (let k = 0; k < 3; k++) if ((x[k] + y[k] + z[k]) % 3 !== 0) return false;
  return true;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 한 라운드의 카드 9장 (27장 중 무작위)
const deal = (rng) => shuffle([...Array(ALL).keys()], rng).slice(0, 9);

// 9장 안에서 합이 되는 모든 조합(칸 번호 0~8, 오름차순)
function allSets(cards) {
  const out = [];
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      for (let k = j + 1; k < cards.length; k++)
        if (isSet(cards[i], cards[j], cards[k])) out.push([i, j, k]);
  return out;
}

const keyOf = (t) => t.slice().sort((a, b) => a - b).join('-');

module.exports = { ALL, attrs, isSet, shuffle, deal, allSets, keyOf };
