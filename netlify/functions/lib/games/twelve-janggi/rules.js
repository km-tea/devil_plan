'use strict';
// 십이장기 — 판과 말의 규칙 (순수 함수만)
//  판: 가로 3칸 × 세로 4칸 = 12칸. 칸 번호 0~11 (왼쪽 위가 0, 한 줄에 3칸). p1 은 아래쪽, p2 는 위쪽에서 시작한다.
//  말: K 왕(8방향) · G 장(상하좌우) · S 상(대각선 4방향) · P 자(앞으로 1칸) · H 후(자가 상대 진영에서 승급: 대각선 뒤쪽을 뺀 6방향)
//  잡은 말은 내 말이 되어 빈 칸에 놓을 수 있다(상대 진영 줄에는 놓을 수 없음). 후를 잡으면 자로 돌아간다.
const N = 12;
const rowOf = (i) => Math.floor(i / 3);
const colOf = (i) => i % 3;
const other = (o) => (o === 'p1' ? 'p2' : 'p1');
const fwd = (o) => (o === 'p1' ? -1 : 1);          // 앞쪽 방향(행의 증감)
const goalRow = (o) => (o === 'p1' ? 0 : 3);       // o 가 목표로 하는 상대 진영(상대의 첫 번째 줄)

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ALL8 = ORTH.concat(DIAG);

function dirs(t, o) {
  const f = fwd(o);
  switch (t) {
    case 'K': return ALL8;
    case 'G': return ORTH;
    case 'S': return DIAG;
    case 'P': return [[f, 0]];
    case 'H': return ORTH.concat([[f, -1], [f, 1]]);
    default: return [];
  }
}

// 시작 배치 (영상 화면과 같음: 뒷줄 상·왕·장, 왕 앞에 자)
function initialBoard() {
  const b = Array(N).fill(null);
  const P = (t, o) => ({ t, o });
  b[0] = P('G', 'p2'); b[1] = P('K', 'p2'); b[2] = P('S', 'p2'); b[4] = P('P', 'p2');
  b[7] = P('P', 'p1'); b[9] = P('S', 'p1'); b[10] = P('K', 'p1'); b[11] = P('G', 'p1');
  return b;
}
const emptyHands = () => ({ p1: { G: 0, S: 0, P: 0 }, p2: { G: 0, S: 0, P: 0 } });

// o 가 둘 수 있는 모든 수: { f, t } (이동) 또는 { d, t } (잡은 말 내려놓기)
function legalMoves(board, hands, o) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const pc = board[i];
    if (!pc || pc.o !== o) continue;
    for (const [dr, dc] of dirs(pc.t, o)) {
      const r = rowOf(i) + dr, c = colOf(i) + dc;
      if (r < 0 || r > 3 || c < 0 || c > 2) continue;
      const j = r * 3 + c, tg = board[j];
      if (!tg || tg.o !== o) out.push({ f: i, t: j });
    }
  }
  for (const d of ['G', 'S', 'P']) {
    if (!hands[o][d]) continue;
    for (let j = 0; j < N; j++) if (!board[j] && rowOf(j) !== goalRow(o)) out.push({ d, t: j });
  }
  return out;
}

// 수를 두어 새 판을 돌려준다 (원래 판은 바꾸지 않음). cap: 잡은 말 종류, promoted: 자→후
function applyMove(board, hands, o, m) {
  const b = board.slice();
  const h = { p1: { ...hands.p1 }, p2: { ...hands.p2 } };
  let cap = null, promoted = false;
  if (m.d) {
    h[o][m.d] -= 1;
    b[m.t] = { t: m.d, o };
  } else {
    const pc = b[m.f], tg = b[m.t];
    if (tg) { cap = tg.t; if (tg.t !== 'K') h[o][tg.t === 'H' ? 'P' : tg.t] += 1; }
    let t = pc.t;
    if (t === 'P' && rowOf(m.t) === goalRow(o)) { t = 'H'; promoted = true; }
    b[m.t] = { t, o };
    b[m.f] = null;
  }
  return { board: b, hands: h, cap, promoted };
}

const kingAt = (board, o) => board.findIndex((p) => p && p.t === 'K' && p.o === o);
const kingInGoal = (board, o) => { const k = kingAt(board, o); return k >= 0 && rowOf(k) === goalRow(o); };
const canCapture = (board, hands, by, idx) => legalMoves(board, hands, by).some((m) => m.f != null && m.t === idx);

const positionKey = (board, hands, toMove) =>
  board.map((p) => (p ? p.o[1] + p.t : '--')).join('') + '|' + ['p1', 'p2'].map((o) => `${hands[o].G}${hands[o].S}${hands[o].P}`).join('') + '|' + toMove;

module.exports = { N, rowOf, colOf, other, fwd, goalRow, dirs, initialBoard, emptyHands, legalMoves, applyMove, kingAt, kingInGoal, canCapture, positionKey };
