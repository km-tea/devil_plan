'use strict';
// 십이장기 — 서버 쪽 게임 모듈 (규격: create / join / advance / handle / view / stableForPoll)
//
// 규칙: rules.js (판·말 움직임) · 이기는 조건: ① 상대 왕 잡기 ② 내 왕이 상대 진영(상대의 첫 줄)에 들어간 뒤
//       상대가 다음 한 수에서 잡지 못하고 1턴을 버티기.
// 학습 연계(힌트): 말을 둔 뒤 5초 안에 힌트를 쓰면 수학 문제가 나오고,
//       맞히면 방금 둔 수를 물리고(무르기) 같은 턴에 다시 둘 수 있다. 틀리면 힌트는 그대로 사라진다.
//       힌트는 내 턴 5번마다 1개씩 충전(최대 3개), 한 턴에 1번만 사용.
// 서버리스라 타이머가 없으므로 요청이 올 때마다 advance()가 "지난 시각"까지 한꺼번에 처리한다.
const { ApiError } = require('../../errors');
const R = require('./rules');
const AI = require('./ai');
const Q = require('./questions');

const TURN_SEC = 60;          // 한 번에 둘 수 있는 시간 (넘으면 아무 수나 자동으로 둠)
const WINDOW_SEC = 5;         // 말을 놓은 뒤 힌트를 쓸지 정하는 시간
const GRACE_MS = 1500;        // 네트워크 지연 여유
const QUIZ_SEC = 45;          // 힌트 문제 푸는 시간 (넘으면 틀린 것으로 처리)
const START_CHARGES = 1;      // 시작할 때 가진 힌트 수
const RECHARGE_EVERY = 5;     // 내 턴 5번마다 힌트 1개 충전
const MAX_CHARGES = 3;
const MAX_PLIES = 200;        // 이 수를 넘기면 무승부 (끝없는 게임 방지)
const REPEAT_DRAW = 3;        // 같은 판이 3번 나오면 무승부

const KINDS = ['mix', 'frac', 'dec', 'ratio', 'times'];
function cleanSettings(s) {
  s = s || {};
  return {
    botLevel: ['easy', 'normal', 'hard'].includes(s.botLevel) ? s.botLevel : 'normal',
    hintKinds: KINDS.includes(s.hintKinds) ? s.hintKinds : 'mix',
  };
}

const newPlayer = (id, name, token, isBot) => ({ id, name, token, isBot: !!isBot, rematch: false, charges: START_CHARGES, turns: 0 });
const me = (state, pid) => state.players.find((p) => p.id === pid);
const other = R.other;

function startGame(state, now) {
  state.phase = 'play';
  state.board = R.initialBoard();
  state.hands = R.emptyHands();
  state.pending = null; state.snap = null; state.positions = {}; state.plies = 0; state.turnNo = 0;
  state.result = null; state.note = null; state.lastMove = null; state.usedQ = []; state.bot = null;
  for (const p of state.players) { p.rematch = false; p.charges = START_CHARGES; p.turns = 0; }
  state.first = state.first ? other(state.first) : 'p1';   // 다시 할 때는 선공을 바꾼다
  startTurn(state, state.first, now);
}

function create({ mode, settings, host, now }) {
  const state = {
    phase: 'waiting', mode, settings: cleanSettings(settings),
    players: [newPlayer('p1', host.name, host.token, false)],
    first: null, board: [], hands: R.emptyHands(), turn: null, bot: null, snap: null, pending: null,
    positions: {}, plies: 0, turnNo: 0, usedQ: [], lastMove: null, note: null, result: null,
  };
  if (mode === 'cpu') { state.players.push(newPlayer('p2', '컴퓨터', '', true)); startGame(state, now); }
  return state;
}

function join(state, { name, token }, now) {
  if (state.mode !== 'pvp') throw new ApiError('컴퓨터와 연습하는 방이에요');
  if (state.players.length >= 2) throw new ApiError('이미 두 명이 입장한 방이에요');
  state.players.push(newPlayer('p2', name, token, false));
  startGame(state, now);
  return 'p2';
}

/* ---------- 턴 진행 ---------- */
function startTurn(state, pid, at) {
  state.turnNo += 1;
  state.turn = { pid, no: state.turnNo, stage: 'move', endsAt: at + TURN_SEC * 1000, used: false, q: null };
  state.snap = null; state.bot = null;
  const p = me(state, pid);
  if (p.isBot) {
    const c = AI.choose(state.board, state.hands, pid, state.settings.botLevel);
    state.bot = { at: at + c.delaySec * 1000, move: c.move };
  }
}

function endGame(state, winner, reason, events) {
  state.phase = 'result'; state.turn = null; state.bot = null; state.snap = null;
  state.result = { winner, reason, plies: state.plies };
  const [a, b] = state.players;
  events.push({ type: 'result', p1: a.name, p2: b.name, winner, hands: { reason, plies: state.plies } });
}

// 한 수를 두고 나서 호출. 힌트 확인 시간(5초)을 줄지 정한다.
function doMove(state, pid, m, at, events, opts) {
  const o = opts || {};
  const p = me(state, pid);
  const before = { board: state.board, hands: state.hands, lastMove: state.lastMove };
  const r = R.applyMove(state.board, state.hands, pid, m);
  state.board = r.board; state.hands = r.hands;
  state.lastMove = { pid, from: m.f == null ? null : m.f, drop: m.d || null, to: m.t, cap: r.cap, promoted: r.promoted, auto: !!o.auto };
  if (r.cap === 'K') return endGame(state, pid, 'capture', events); // 왕을 잡으면 바로 끝 (무르기 없음)
  if (!p.isBot && !o.auto && p.charges > 0 && !state.turn.used) {
    state.snap = before;
    state.turn.stage = 'window';
    state.turn.windowEndsAt = at + WINDOW_SEC * 1000;
    return undefined;
  }
  return finalize(state, at, events);
}

// 턴을 확정: 충전·시도 규칙·반복·다음 사람
function finalize(state, at, events) {
  const pid = state.turn.pid, opp = other(pid), p = me(state, pid);
  state.snap = null;
  p.turns += 1;
  if (p.turns % RECHARGE_EVERY === 0 && p.charges < MAX_CHARGES) p.charges += 1;
  state.plies += 1;

  // 상대 왕이 내 진영에 들어간 뒤, 내가 한 수로 잡지 못했다면 상대 승리
  if (state.pending === opp && R.kingInGoal(state.board, opp)) return endGame(state, opp, 'try', events);
  state.pending = R.kingInGoal(state.board, pid) ? pid : null;

  const key = R.positionKey(state.board, state.hands, opp);
  state.positions[key] = (state.positions[key] || 0) + 1;
  if (state.positions[key] >= REPEAT_DRAW) return endGame(state, 'draw', 'repeat', events);
  if (state.plies >= MAX_PLIES) return endGame(state, 'draw', 'long', events);
  if (!R.legalMoves(state.board, state.hands, opp).length) return endGame(state, pid, 'nomoves', events);
  return startTurn(state, opp, at);
}

function randomMove(state, pid) {
  const moves = R.legalMoves(state.board, state.hands, pid);
  return moves[Math.floor(Math.random() * moves.length)];
}

function advance(state, now) {
  const events = [];
  let changed = false;
  for (let guard = 0; guard < 40; guard++) {
    if (state.phase !== 'play' || !state.turn) break;
    const t = state.turn;
    if (t.stage === 'window') {
      if (now < t.windowEndsAt + GRACE_MS) break;
      finalize(state, t.windowEndsAt, events);                 // 힌트를 쓰지 않음 → 그대로 확정
    } else if (t.stage === 'quiz') {
      if (now < t.quizEndsAt) break;
      state.note = { pid: t.pid, kind: 'quiz_timeout', no: t.no };
      finalize(state, t.quizEndsAt, events);                   // 시간 안에 못 풂 → 힌트 실패
    } else if (state.bot && now >= state.bot.at) {
      const m = state.bot.move;
      if (!m) { endGame(state, other(t.pid), 'nomoves', events); }
      else doMove(state, t.pid, m, state.bot.at, events, {});
    } else if (now >= t.endsAt) {
      state.note = { pid: t.pid, kind: 'timeout', no: t.no };
      doMove(state, t.pid, randomMove(state, t.pid), t.endsAt, events, { auto: true });
    } else break;
    changed = true;
  }
  return { changed, events };
}

const need = (cond, msg) => { if (!cond) throw new ApiError(msg || '지금은 할 수 없어요'); };
const myTurn = (state, player, stage) => state.phase === 'play' && state.turn && state.turn.pid === player.id && state.turn.stage === stage;

function handle(state, player, action, payload, now) {
  const events = [];
  switch (action) {
    case 'move': case 'drop': {
      need(myTurn(state, player, 'move'), '내 차례가 아니에요');
      const m = action === 'move' ? { f: Number(payload.from), t: Number(payload.to) } : { d: String(payload.type), t: Number(payload.to) };
      const ok = R.legalMoves(state.board, state.hands, player.id).some((x) => x.t === m.t && (m.d ? x.d === m.d : x.f === m.f));
      need(ok, '그렇게는 둘 수 없어요');
      doMove(state, player.id, m, now, events, {});
      return { events, response: {} };
    }
    case 'confirm': { // 힌트를 쓰지 않고 바로 확정
      need(myTurn(state, player, 'window'), '지금은 확정할 수 없어요');
      finalize(state, now, events);
      return { events, response: {} };
    }
    case 'hint_start': {
      need(myTurn(state, player, 'window') && now <= state.turn.windowEndsAt + GRACE_MS, '힌트를 쓸 수 있는 시간이 지났어요');
      need(!state.turn.used, '힌트는 한 턴에 한 번만 쓸 수 있어요');
      need(player.charges > 0, '힌트가 없어요');
      player.charges -= 1;                      // 문제를 푸는 순간 힌트는 소모된다 (틀려도 돌아오지 않음)
      state.turn.used = true;
      state.turn.stage = 'quiz';
      state.turn.quizEndsAt = now + QUIZ_SEC * 1000;
      state.turn.q = Q.make(state.settings.hintKinds);
      return { events, response: {} };
    }
    case 'hint_answer': {
      need(myTurn(state, player, 'quiz'), '풀고 있는 힌트 문제가 없어요');
      const q = state.turn.q;
      need(now <= state.turn.quizEndsAt + GRACE_MS, '시간이 지났어요');
      const ok = Q.check(q, payload);
      events.push({ type: 'answer', pid: player.id, player: player.name, kind: q.kind, prompt: q.prompt, correct: ok });
      if (ok) { // 방금 둔 수를 물리고 같은 턴에 다시 둔다
        state.board = state.snap.board; state.hands = state.snap.hands; state.lastMove = state.snap.lastMove;
        state.snap = null; state.turn.q = null; state.turn.stage = 'move';
        state.turn.endsAt = now + TURN_SEC * 1000;
        state.note = { pid: player.id, kind: 'undo', no: state.turn.no };
        return { events, response: { correct: true } };
      }
      state.note = { pid: player.id, kind: 'quiz_fail', no: state.turn.no };
      const answer = Q.answerText(q);
      finalize(state, now, events); // 틀림: 힌트 기회는 사라지고 둔 수가 그대로 확정
      return { events, response: { correct: false, answer } };
    }
    case 'rematch': {
      need(state.phase === 'result', '게임이 아직 끝나지 않았어요');
      player.rematch = true;
      if (state.players.every((p) => p.isBot || p.rematch)) startGame(state, now);
      return { events, response: {} };
    }
    default:
      throw new ApiError('알 수 없는 동작이에요');
  }
}

// 플레이어에게 보낼 정보. 정답과 컴퓨터가 정한 수는 보내지 않는다.
function view(state, pid, now) {
  const mine = me(state, pid), opp = state.players.find((p) => p.id !== pid);
  const t = state.turn;
  const live = state.phase === 'play' && t;
  let deadline = null;
  if (live) deadline = t.stage === 'window' ? t.windowEndsAt + GRACE_MS : t.stage === 'quiz' ? t.quizEndsAt : t.endsAt;
  const v = {
    game: 'twelve-janggi', mode: state.mode, phase: state.phase, deadline,
    settings: { turnSec: TURN_SEC, windowSec: WINDOW_SEC, quizSec: QUIZ_SEC, every: RECHARGE_EVERY, maxCharges: MAX_CHARGES },
    me: {
      id: mine.id, name: mine.name, rematch: mine.rematch,
      hint: {
        charges: mine.charges, untilNext: mine.charges >= MAX_CHARGES ? null : RECHARGE_EVERY - (mine.turns % RECHARGE_EVERY),
        canUse: !!(live && t.pid === pid && t.stage === 'window' && !t.used && mine.charges > 0),
        usedThisTurn: !!(live && t.pid === pid && t.used),
        question: live && t.pid === pid && t.stage === 'quiz' ? { kind: t.q.kind, prompt: t.q.prompt, unit: t.q.unit || null } : null,
      },
    },
    opp: opp ? { name: opp.name, isBot: opp.isBot, charges: opp.charges, rematch: opp.rematch } : null,
  };
  if (state.phase !== 'waiting') {
    v.board = state.board; v.hands = state.hands; v.lastMove = state.lastMove; v.note = state.note; v.plies = state.plies;
  }
  if (live) {
    v.turn = { pid: t.pid, no: t.no, stage: t.stage, endsAt: t.endsAt, windowEndsAt: t.windowEndsAt || null, quizEndsAt: t.quizEndsAt || null };
    if (t.pid === pid && t.stage === 'move') v.legal = R.legalMoves(state.board, state.hands, pid).map((m) => ({ f: m.f == null ? null : m.f, d: m.d || null, t: m.t }));
  }
  if (state.phase === 'result') v.result = state.result;
  return v;
}

const stableForPoll = () => true;

module.exports = {
  create, join, advance, handle, view, stableForPoll, _finalize: finalize, // _finalize 는 테스트용
  constants: { TURN_SEC, WINDOW_SEC, QUIZ_SEC, START_CHARGES, RECHARGE_EVERY, MAX_CHARGES, MAX_PLIES },
};
