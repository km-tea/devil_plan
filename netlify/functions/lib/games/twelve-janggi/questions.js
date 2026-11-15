'use strict';
// 힌트 문제 (6학년 수학): 분수의 나눗셈 · 소수의 나눗셈 · 비례배분 · 구구단
// 앞의 세 가지는 기억 포커의 문제 생성기를 그대로 쓰고, 구구단만 여기서 만든다.
const base = require('../memory-poker/questions');

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function timesQuestion() {
  const a = ri(2, 9), b = ri(2, 9);
  return { kind: 'times', prompt: `${a} × ${b}`, value: a * b };
}

const KINDS = ['mix', 'frac', 'dec', 'ratio', 'times'];
function make(kind) {
  if (kind === 'times') return timesQuestion();
  if (kind === 'mix' || !KINDS.includes(kind)) {
    const r = Math.random();
    return r < 0.25 ? timesQuestion() : base.make('mix');
  }
  return base.make(kind);
}

// 정답 표시용 (틀렸을 때 보여 줌)
function answerText(q) {
  if (q.kind === 'frac') return q.d === 1 ? String(q.n) : `${q.n}/${q.d}`;
  return String(q.value) + (q.unit || '');
}

module.exports = { make, check: base.check, answerText, KINDS };
