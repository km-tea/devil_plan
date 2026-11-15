'use strict';
// 컴퓨터 상대: 몇 수 앞까지 내다보는 탐색(깊이)과 "가끔 아무 수나 두는 실수 확률"로 난이도를 나눈다.
// 숫자는 LEVELS 에서 조정하세요. 생각하는 시간은 모두 10초 이내.
const R = require('./rules');

const LEVELS = {
  easy:   { depth: 1, mistake: 0.35, delay: [1.5, 5] },
  normal: { depth: 3, mistake: 0.12, delay: [1.5, 5] },
  hard:   { depth: 4, mistake: 0.03, delay: [1.5, 5] },
};
const MAX_DELAY_SEC = 10;
const VAL = { K: 0, G: 3, S: 3, P: 1, H: 3.5 };

function evaluate(board, hands, o) {
  let s = 0;
  for (let i = 0; i < R.N; i++) {
    const pc = board[i];
    if (!pc) continue;
    let v = VAL[pc.t];
    const adv = pc.o === 'p1' ? 3 - R.rowOf(i) : R.rowOf(i); // 앞으로 나간 정도
    if (pc.t === 'P') v += adv * 0.15;
    if (pc.t === 'K') v += adv * 0.1;
    s += pc.o === o ? v : -v;
  }
  for (const [side, sign] of [[o, 1], [R.other(o), -1]]) for (const t of ['G', 'S', 'P']) s += sign * hands[side][t] * VAL[t] * 0.9;
  return s;
}

function order(board, moves) { // 잡는 수를 먼저 살펴보면 탐색이 빨라진다
  return moves.map((m) => [m, m.f != null && board[m.t] ? 10 + VAL[board[m.t].t] : 0]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

// 한 수를 둔 뒤의 점수(둔 사람 기준): 왕 잡기 / 시도 규칙 승리 / 더 깊이 탐색
function scoreAfter(board, hands, o, m, depth, alpha, beta, ply) {
  const r = R.applyMove(board, hands, o, m);
  if (r.cap === 'K') return 1000 - ply;
  if (R.kingInGoal(r.board, o) && !R.canCapture(r.board, r.hands, R.other(o), R.kingAt(r.board, o))) return 900 - ply; // 상대가 못 잡으면 승리
  if (depth <= 1) return evaluate(r.board, r.hands, o);
  return -search(r.board, r.hands, R.other(o), depth - 1, -beta, -alpha, ply + 1);
}

function search(board, hands, o, depth, alpha, beta, ply) {
  const moves = R.legalMoves(board, hands, o);
  if (!moves.length) return -900 + ply; // 둘 곳이 없으면 짐
  let best = -Infinity;
  for (const m of order(board, moves)) {
    const sc = scoreAfter(board, hands, o, m, depth, alpha, beta, ply);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// 반환: { move, delaySec } (둘 곳이 없으면 move=null)
function choose(board, hands, o, level, rng = Math.random) {
  const p = LEVELS[level] || LEVELS.normal;
  const delaySec = Math.min(MAX_DELAY_SEC, p.delay[0] + rng() * (p.delay[1] - p.delay[0]));
  const moves = R.legalMoves(board, hands, o);
  if (!moves.length) return { move: null, delaySec };
  if (rng() < p.mistake) return { move: pick(moves, rng), delaySec, mistake: true };
  let best = -Infinity, pool = [];
  for (const m of moves) {
    const sc = scoreAfter(board, hands, o, m, p.depth, -Infinity, Infinity, 1);
    if (sc > best + 1e-9) { best = sc; pool = [m]; } else if (Math.abs(sc - best) <= 1e-9) pool.push(m);
  }
  return { move: pick(pool, rng), delaySec, score: best };
}

module.exports = { choose, LEVELS, MAX_DELAY_SEC, evaluate };
