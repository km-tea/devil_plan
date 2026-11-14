'use strict';
// 힌트 문제 생성기 (6학년 수학: 분수의 나눗셈 / 소수의 나눗셈)
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (x) => String(Math.round(x * 100) / 100);

// 약분된 분수(분자≠분모, 최대 2 미만의 가분수까지)만 만든다 → "2/2 ÷ ..." 같은 시시한 문제 방지
function nicefrac() {
  for (;;) {
    const d = ri(2, 9), n = ri(1, d * 2);
    if (n !== d && gcd(n, d) === 1) return [n, d];
  }
}

function fracQuestion() {
  const [n1, d1] = nicefrac();
  let n2, d2, prompt;
  if (Math.random() < 0.4) { // (분수) ÷ (자연수)
    n2 = ri(2, 6); d2 = 1;
    prompt = `${n1}/${d1} ÷ ${n2}`;
  } else { // (분수) ÷ (분수)
    [n2, d2] = nicefrac();
    prompt = `${n1}/${d1} ÷ ${n2}/${d2}`;
  }
  let n = n1 * d2, d = d1 * n2;
  const g = gcd(n, d);
  n /= g; d /= g;
  return { kind: 'frac', prompt, n, d };
}

function decQuestion() {
  const m = ri(5, 60); // 몫 = m/10
  let divisor, dividend;
  if (Math.random() < 0.4) { // (소수) ÷ (자연수)
    const k = ri(2, 9);
    divisor = k; dividend = (k * m) / 10;
  } else { // (소수) ÷ (소수)
    const k = pick([2, 4, 5, 6, 8, 12, 15, 25]); // 0.2, 0.4 ...
    divisor = k / 10; dividend = (k * m) / 100;
  }
  return { kind: 'dec', prompt: `${fmt(dividend)} ÷ ${fmt(divisor)}`, value: m / 10 };
}

function make(kinds) {
  if (kinds === 'frac') return fracQuestion();
  if (kinds === 'dec') return decQuestion();
  return Math.random() < 0.5 ? fracQuestion() : decQuestion();
}

// 분수는 약분하지 않아도 값이 같으면 정답 (예: 6/8 = 3/4)
function check(q, input) {
  input = input || {};
  if (q.kind === 'frac') {
    const n = parseInt(input.n, 10);
    const d = input.d === '' || input.d == null ? 1 : parseInt(input.d, 10);
    if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0 || n < 0) return false;
    return n * q.d === q.n * d;
  }
  const x = parseFloat(String(input.v == null ? '' : input.v).replace(',', '.'));
  return Number.isFinite(x) && Math.abs(x - q.value) < 1e-9;
}

module.exports = { make, check };
