'use strict';
// 결합 — 서버 쪽 게임 모듈 (규격: create / join / advance / handle / view / stableForPoll)
//
// 진행: 3·5·10라운드 중 선택. 라운드마다 카드 9장이 공개되고, 두 사람이 번갈아 "턴"을 가진다.
//  - 컴퓨터는 자기 턴이 시작되고 10초 안에 반드시 답한다(난이도마다 실수 확률이 다름, bot.js).
//  - 턴 시간 30초(원래 규칙은 10초). 이 안에 '합'(3장 지목) / '결'(합이 더 없음) / 패스.
//  - 합 정답 +1, 오답 -1 / 결 정답 +3(라운드 끝), 오답 -1 후 턴 넘김.
//  - 이미 불린 합은 다시 불러도 점수가 없고(안내만 나옴), 아무도 합·결을 부르지 않은 채 6턴이 지나면 라운드 종료.
//  - 힌트(문제를 풀면 사용): ⏱ 이번 턴 +10초 / 💡 결합 힌트(남은 합 개수, 0이면 '결').
//  서버리스라 타이머가 없으므로 요청이 올 때마다 advance()가 "지난 시각"까지 한꺼번에 처리한다.
const { ApiError } = require('../../errors');
const rules = require('./rules');
const bot = require('./bot');
const Q = require('./questions');

const ROUNDS = 10;           // 기본 라운드 수 (설정에서 3·5·10 중 선택)
const ROUND_CHOICES = [3, 5, 10];
const TURN_SEC = 30;
const NAME_SEC = 5;          // '합'을 외친 뒤 세 장을 지목하는 시간
const NAME_GRACE_MS = 1500;  // 네트워크 지연 여유
const TIME_BONUS_SEC = 10;   // 시간 힌트로 늘어나는 시간
const IDLE_LIMIT = 6;        // 이만큼 연속으로 아무도 합/결을 부르지 않으면 라운드 종료
const BETWEEN_SEC = 6;       // 라운드 사이 쉬는 시간
const FIRST_SEC = 3;         // 첫 라운드 시작 전 카운트다운
const INFO_LIMIT = 3;        // 결합 힌트는 한 게임에 3번
const SCORE = { set: 1, bad: -1, gyeol: 3 };

function cleanSettings(s) {
  s = s || {};
  const scope = Q.cleanScope(s.grade, s.semester);
  const rounds = ROUND_CHOICES.includes(Number(s.rounds)) ? Number(s.rounds) : ROUNDS;
  return { ...scope, rounds, botLevel: ['easy', 'normal', 'hard'].includes(s.botLevel) ? s.botLevel : 'normal' };
}

const newPlayer = (id, name, token, isBot) => ({
  id, name, token, isBot: !!isBot, score: 0, rematch: false,
  hint: { kind: null, q: null }, timeTurn: -1, infoLeft: INFO_LIMIT, infoTurn: -1,
});

const roundsOf = (state) => state.settings.rounds || ROUNDS;
const other = (state, pid) => state.players.find((p) => p.id !== pid);
const me = (state, pid) => state.players.find((p) => p.id === pid);
const remainingSets = (state) => {
  const done = new Set(state.found.map((f) => rules.keyOf(f.t)));
  return state.sets.filter((t) => !done.has(rules.keyOf(t)));
};

function resetGame(state, now) {
  state.round = 0; state.turnNo = 0; state.result = null; state.usedQ = [];
  state.phase = 'between'; state.nextAt = now + FIRST_SEC * 1000; state.lastAct = null; state.missed = []; state.cards = [];
  state.found = []; state.sets = [];
  for (const p of state.players) {
    p.score = 0; p.rematch = false; p.hint = { kind: null, q: null }; p.timeTurn = -1; p.infoLeft = INFO_LIMIT; p.infoTurn = -1;
  }
}

function create({ mode, settings, host, now }) {
  const state = {
    phase: 'waiting', mode, settings: cleanSettings(settings),
    players: [newPlayer('p1', host.name, host.token, false)],
    round: 0, turnNo: 0, usedQ: [], cards: [], sets: [], found: [], idle: 0, turn: null, bot: null,
    nextAt: null, lastAct: null, last: null, missed: [], result: null,
  };
  if (mode === 'cpu') { state.players.push(newPlayer('p2', '컴퓨터', '', true)); resetGame(state, now); }
  return state;
}

function join(state, { name, token }, now) {
  if (state.mode !== 'pvp') throw new ApiError('컴퓨터와 연습하는 방이에요');
  if (state.players.length >= 2) throw new ApiError('이미 두 명이 입장한 방이에요');
  state.players.push(newPlayer('p2', name, token, false));
  resetGame(state, now);
  return 'p2';
}

/* ---------- 라운드·턴 진행 ---------- */
function startRound(state, at) {
  state.round += 1;
  state.cards = rules.deal();
  state.sets = rules.allSets(state.cards);
  state.found = []; state.idle = 0; state.missed = []; state.last = null; state.lastAct = null;
  startTurn(state, state.round % 2 === 1 ? 'p1' : 'p2', at); // 선공은 라운드마다 번갈아
}

function startTurn(state, pid, at) {
  state.phase = 'play';
  state.turnNo += 1;
  state.turn = { pid, no: state.turnNo, startAt: at, endsAt: at + TURN_SEC * 1000, naming: null };
  state.bot = null;
  for (const p of state.players) p.hint = { kind: null, q: null };
  const p = me(state, pid);
  if (p.isBot) {
    const plan = bot.plan(state.settings.botLevel, state.cards, remainingSets(state));
    state.bot = { at: at + Math.min(plan.delaySec, TURN_SEC - 2) * 1000, act: plan.act, set: plan.set || null };
  }
}

function nextTurn(state, at) {
  if (state.idle >= IDLE_LIMIT) return endRound(state, at, 'idle', null);
  startTurn(state, other(state, state.turn.pid).id, at);
}

function endRound(state, at, reason, by, events) {
  state.missed = remainingSets(state);
  state.last = { round: state.round, reason, by, missed: state.missed.length };
  state.turn = null; state.bot = null;
  for (const p of state.players) p.hint = { kind: null, q: null };
  if (state.round >= roundsOf(state)) finish(state, events || []);
  else { state.phase = 'between'; state.nextAt = at + BETWEEN_SEC * 1000; }
}

function finish(state, events) {
  const [a, b] = state.players;
  const winner = a.score > b.score ? a.id : b.score > a.score ? b.id : 'draw';
  state.phase = 'result'; state.nextAt = null;
  state.result = { winner, scores: { [a.id]: a.score, [b.id]: b.score } };
  events.push({ type: 'result', p1: a.name, p2: b.name, winner, hands: { scores: state.result.scores } });
}

/* ---------- 행동 결과 처리 (사람·컴퓨터 공통) ---------- */
const act = (state, pid, kind, set) => { state.lastAct = { no: state.turn.no, pid, kind, set: set || null }; };

function applyPass(state, pid, at, timeout) {
  act(state, pid, timeout ? 'timeout' : 'pass');
  state.idle += 1;
  nextTurn(state, at);
}

function applySet(state, pid, triple, at, events) {
  const p = me(state, pid);
  const ok = triple.length === 3 && new Set(triple).size === 3 && rules.isSet(...triple.map((i) => state.cards[i]));
  state.idle = 0;
  if (ok) {
    p.score += SCORE.set;
    state.found.push({ t: triple.slice().sort((a, b) => a - b), by: pid });
    act(state, pid, 'set_ok', triple);
  } else {
    p.score += SCORE.bad;
    act(state, pid, triple.length === 3 ? 'set_bad' : 'set_timeout', triple.length === 3 ? triple : null);
  }
  nextTurn(state, at);
  return ok;
}

function applyGyeol(state, pid, at, events) {
  const p = me(state, pid);
  if (remainingSets(state).length === 0) {
    p.score += SCORE.gyeol;
    act(state, pid, 'gyeol_ok');
    endRound(state, at, 'gyeol', pid, events);
    return true;
  }
  p.score += SCORE.bad;
  state.idle = 0;
  act(state, pid, 'gyeol_bad');
  nextTurn(state, at);
  return false;
}

function doBot(state, events) {
  const b = state.bot, pid = state.turn.pid, at = b.at;
  if (b.act === 'set') applySet(state, pid, b.set, at, events);
  else if (b.act === 'wrongset') applySet(state, pid, b.set, at, events);
  else if (b.act === 'gyeol') applyGyeol(state, pid, at, events);
  else applyPass(state, pid, at, false);
}

// 시간이 지났으면 그 시각까지의 일을 순서대로 처리
function advance(state, now) {
  const events = [];
  let changed = false;
  for (let guard = 0; guard < 60; guard++) {
    if (state.phase === 'between' && now >= state.nextAt) {
      startRound(state, state.nextAt);
    } else if (state.phase === 'play') {
      const t = state.turn;
      if (t.naming) {
        if (now < t.naming.endsAt + NAME_GRACE_MS) break;
        applySet(state, t.pid, [], t.naming.endsAt, events); // 시간 안에 못 고름 → 오답
      } else if (state.bot && now >= state.bot.at) {
        doBot(state, events);
      } else if (now >= t.endsAt) {
        applyPass(state, t.pid, t.endsAt, true);
      } else break;
    } else break;
    changed = true;
  }
  return { changed, events };
}

const need = (cond, msg) => { if (!cond) throw new ApiError(msg || '지금은 할 수 없어요'); };
const myTurn = (state, player) => state.phase === 'play' && state.turn && state.turn.pid === player.id;

function handle(state, player, action, payload, now) {
  const events = [];
  switch (action) {
    case 'call_set': {
      need(myTurn(state, player) && !state.turn.naming, '지금은 합을 부를 수 없어요');
      player.hint = { kind: null, q: null };
      state.turn.naming = { endsAt: now + NAME_SEC * 1000 };
      return { events, response: {} };
    }
    case 'name_set': {
      need(myTurn(state, player) && state.turn.naming, '먼저 "합!"을 눌러 주세요');
      const t = Array.isArray(payload.cards) ? payload.cards.map(Number) : [];
      need(t.length === 3 && new Set(t).size === 3 && t.every((i) => Number.isInteger(i) && i >= 0 && i < 9), '카드를 3장 골라 주세요');
      const key = rules.keyOf(t);
      if (state.found.some((f) => rules.keyOf(f.t) === key) && rules.isSet(...t.map((i) => state.cards[i]))) {
        throw new ApiError('이미 나온 합이에요. 다른 합을 골라 보세요'); // 점수 변화 없이 다시 고를 수 있음
      }
      const ok = applySet(state, player.id, t, now, events);
      return { events, response: { correct: ok } };
    }
    case 'call_none': {
      need(myTurn(state, player) && !state.turn.naming, '지금은 결을 부를 수 없어요');
      const ok = applyGyeol(state, player.id, now, events);
      return { events, response: { correct: ok } };
    }
    case 'pass': {
      need(myTurn(state, player) && !state.turn.naming, '지금은 넘길 수 없어요');
      applyPass(state, player.id, now, false);
      return { events, response: {} };
    }
    case 'hint_start': {
      need(myTurn(state, player) && !state.turn.naming, '내 차례에만 힌트를 쓸 수 있어요');
      const kind = payload.kind;
      need(kind === 'time' || kind === 'info', '힌트 종류를 확인해 주세요');
      if (player.hint.kind && player.hint.q) return { events, response: {} }; // 이미 푸는 중
      if (kind === 'time') need(player.timeTurn !== state.turn.no, '시간 힌트는 한 턴에 한 번만 쓸 수 있어요');
      else {
        need(player.infoTurn !== state.turn.no, '이번 턴에는 이미 결합 힌트를 봤어요');
        need(player.infoLeft > 0, '결합 힌트를 모두 썼어요');
      }
      player.hint = { kind, q: Q.make(state.settings, state.usedQ) };
      return { events, response: {} };
    }
    case 'hint_skip': {
      need(myTurn(state, player) && !state.turn.naming && player.hint.q, '풀고 있는 문제가 없어요');
      player.hint.q = Q.make(state.settings, state.usedQ);
      return { events, response: {} };
    }
    case 'hint_answer': {
      need(myTurn(state, player) && !state.turn.naming && player.hint.q, '풀고 있는 문제가 없어요');
      const q = player.hint.q, kind = player.hint.kind;
      const ok = Q.check(q, payload);
      events.push({ type: 'answer', pid: player.id, player: player.name, kind: 'social', prompt: `[${q.label}] ${q.text} → ${q.answer}`, correct: ok });
      if (ok) {
        if (kind === 'time') { state.turn.endsAt += TIME_BONUS_SEC * 1000; player.timeTurn = state.turn.no; }
        else { player.infoLeft -= 1; player.infoTurn = state.turn.no; }
        player.hint = { kind: null, q: null };
      } else {
        player.hint.q = Q.make(state.settings, state.usedQ); // 틀리면 새 문제
      }
      return { events, response: { correct: ok, answer: ok ? undefined : q.answer } };
    }
    case 'rematch': {
      need(state.phase === 'result', '게임이 아직 끝나지 않았어요');
      player.rematch = true;
      if (state.players.every((p) => p.isBot || p.rematch)) resetGame(state, now);
      return { events, response: {} };
    }
    default:
      throw new ApiError('알 수 없는 동작이에요');
  }
}

// 플레이어에게 보낼 정보. 정답 문제의 답, 컴퓨터가 정한 행동은 보내지 않는다.
function view(state, pid, now) {
  const mine = me(state, pid), opp = other(state, pid);
  const t = state.turn;
  const live = state.phase === 'play' && t;
  let deadline = null;
  if (live) deadline = t.naming ? t.naming.endsAt + NAME_GRACE_MS : t.endsAt;
  else if (state.phase === 'between') deadline = state.nextAt;

  const hint = mine.hint;
  const v = {
    game: 'gyeolhap', mode: state.mode, phase: state.phase, round: state.round,
    settings: { rounds: roundsOf(state), turnSec: TURN_SEC, nameSec: NAME_SEC, timeBonus: TIME_BONUS_SEC, infoLimit: INFO_LIMIT, idleLimit: IDLE_LIMIT, scope: { grade: state.settings.grade, semester: state.settings.semester } },
    deadline,
    me: {
      id: mine.id, name: mine.name, score: mine.score, rematch: mine.rematch,
      hint: {
        kind: hint.q ? hint.kind : null,
        question: hint.q ? { label: hint.q.label, sec: hint.q.sec, text: hint.q.text } : null,
        timeUsed: !!(live && mine.timeTurn === t.no),
        infoLeft: mine.infoLeft,
        info: live && mine.infoTurn === t.no ? { remaining: remainingSets(state).length } : null,
      },
    },
    opp: opp ? { name: opp.name, isBot: opp.isBot, score: opp.score, rematch: opp.rematch } : null,
  };
  if (state.phase === 'play' || state.phase === 'between' || state.phase === 'result') {
    v.cards = state.cards;
    v.found = state.found;
    v.lastAct = state.lastAct;
  }
  if (live) {
    v.turn = { pid: t.pid, no: t.no, endsAt: t.endsAt, naming: t.naming ? { endsAt: t.naming.endsAt } : null };
    v.idle = state.idle;
  }
  if (state.phase === 'between' || state.phase === 'result') { v.last = state.last; v.missed = state.missed; v.nextAt = state.nextAt; }
  if (state.phase === 'result') v.result = state.result;
  return v;
}

// 화면에 보이는 정보가 시간만으로는 바뀌지 않으므로, 변화가 없으면 짧게 응답해도 된다.
const stableForPoll = () => true;

module.exports = { create, join, advance, handle, view, stableForPoll, constants: { ROUNDS, TURN_SEC, NAME_SEC, TIME_BONUS_SEC, IDLE_LIMIT } };
