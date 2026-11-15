'use strict';
// 기억 포커 — 서버 쪽 게임 모듈
// 모든 게임 모듈이 따르는 규격: create / join / advance / handle / view / stableForPoll
const { ApiError } = require('../../errors');
const rules = require('./rules');
const bot = require('./bot');
const Q = require('./questions');

const MEMORIZE_SEC = 20; // 카드 암기 시간
const SELECT_SEC = 180;  // 카드 선택 최대 시간(3분)
const COUNTDOWN_SEC = 3; // 시작 전 카운트다운
const N = 16;            // 암기 카드 수

function cleanSettings(s) {
  s = s || {};
  return {
    hintKinds: ['frac', 'dec', 'ratio', 'mix'].includes(s.hintKinds) ? s.hintKinds : 'mix',
    botLevel: ['easy', 'normal', 'hard'].includes(s.botLevel) ? s.botLevel : 'normal',
  };
}

function newPlayer(id, name, token, isBot) {
  return { id, name, token, isBot: !!isBot, picks: [], confirmed: false, rematch: false,
    hint: { status: 'none', q: null, revealed: null } };
}

function deal(state, now) {
  const cards = rules.shuffle(rules.fullDeck());
  state.deck = cards.slice(0, N);
  state.shared = cards.slice(N, N + 3);
  state.phase = 'memorize';
  state.startsAt = now + COUNTDOWN_SEC * 1000;
  state.phaseEndsAt = state.startsAt + MEMORIZE_SEC * 1000;
  state.result = null;
  state.round = (state.round || 0) + 1;
  for (const p of state.players) {
    p.picks = []; p.confirmed = false; p.rematch = false;
    p.hint = { status: 'none', q: null, revealed: null };
  }
}

function create({ mode, settings, host, now }) {
  const state = {
    phase: 'waiting', mode, round: 0,
    settings: cleanSettings(settings),
    players: [newPlayer('p1', host.name, host.token, false)],
  };
  if (mode === 'cpu') {
    state.players.push(newPlayer('p2', '컴퓨터', '', true));
    deal(state, now);
  }
  return state;
}

function join(state, { name, token }, now) {
  if (state.mode !== 'pvp') throw new ApiError('컴퓨터와 연습하는 방이에요');
  if (state.players.length >= 2) throw new ApiError('이미 두 명이 입장한 방이에요');
  state.players.push(newPlayer('p2', name, token, false));
  deal(state, now);
  return 'p2';
}

function startSelect(state) {
  // 선택 시간은 암기가 끝난 시각부터 계산 (서버가 늦게 확인해도 시간이 어긋나지 않음)
  state.phase = 'select';
  state.phaseEndsAt = state.phaseEndsAt + SELECT_SEC * 1000;
  for (const p of state.players) {
    if (p.isBot) {
      p.picks = bot.choose(state.deck, state.shared, state.settings.botLevel);
      p.confirmed = true;
    }
  }
}

function finish(state, events, timedOut) {
  const evals = {}, hands = {};
  for (const p of state.players) {
    const picks = p.picks.slice();
    const pool = rules.shuffle([...Array(N).keys()].filter((i) => !picks.includes(i)));
    while (picks.length < 2) picks.push(pool.pop()); // 못 고른 칸은 무작위로 채움
    p.picks = picks;
    const cards = [...state.shared, state.deck[picks[0]], state.deck[picks[1]]];
    const ev = rules.evaluate(cards);
    evals[p.id] = ev;
    hands[p.id] = { picks, cards, name: ev.name, cat: ev.cat };
  }
  const [a, b] = state.players;
  const c = rules.compare(evals[a.id], evals[b.id]);
  const winner = c > 0 ? a.id : c < 0 ? b.id : 'draw';
  state.result = { winner, hands, timedOut: !!timedOut };
  state.phase = 'result';
  events.push({ type: 'result', p1: a.name, p2: b.name, winner, hands });
}

// 시간이 지났으면 다음 단계로. (서버리스라 타이머가 없으므로 요청이 올 때마다 확인)
function advance(state, now) {
  const events = [];
  let changed = false;
  if (state.phase === 'memorize' && now >= state.phaseEndsAt) { startSelect(state); changed = true; }
  if (state.phase === 'select' && now >= state.phaseEndsAt) { finish(state, events, true); changed = true; }
  return { changed, events };
}

function need(cond, msg) { if (!cond) throw new ApiError(msg || '지금은 할 수 없어요'); }

function handle(state, player, action, payload, now) {
  const events = [];
  const hint = player.hint;
  switch (action) {
    case 'hint_start': {
      need(state.phase === 'select' && !player.confirmed, '지금은 힌트를 쓸 수 없어요');
      need(hint.status !== 'used' && hint.status !== 'ready', '힌트는 한 게임에 한 번만 쓸 수 있어요');
      if (hint.status !== 'asking') { hint.q = Q.make(state.settings.hintKinds); hint.status = 'asking'; }
      return { events, response: {} };
    }
    case 'hint_answer': {
      need(state.phase === 'select' && hint.status === 'asking', '풀고 있는 힌트 문제가 없어요');
      const ok = Q.check(hint.q, payload);
      events.push({ type: 'answer', player: player.name, kind: hint.q.kind, prompt: hint.q.prompt, correct: ok });
      if (ok) { hint.status = 'ready'; hint.q = null; }
      else hint.q = Q.make(state.settings.hintKinds); // 틀리면 새 문제
      return { events, response: { correct: ok } };
    }
    case 'hint_reveal': {
      need(state.phase === 'select' && hint.status === 'ready', '아직 힌트를 쓸 수 없어요');
      const idx = Number(payload.idx);
      need(Number.isInteger(idx) && idx >= 0 && idx < N, '카드를 다시 골라 주세요');
      hint.revealed = { idx, card: state.deck[idx] };
      hint.status = 'used';
      return { events, response: {} };
    }
    case 'confirm': {
      need(state.phase === 'select' && !player.confirmed, '이미 확정했거나 시간이 끝났어요');
      const picks = Array.isArray(payload.picks) ? payload.picks.map(Number) : [];
      need(picks.length === 2 && picks[0] !== picks[1] && picks.every((i) => Number.isInteger(i) && i >= 0 && i < N),
        '카드를 2장 골라 주세요');
      player.picks = picks;
      player.confirmed = true;
      if (state.players.every((p) => p.confirmed)) finish(state, events, false);
      return { events, response: {} };
    }
    case 'rematch': {
      need(state.phase === 'result', '게임이 아직 끝나지 않았어요');
      player.rematch = true;
      if (state.players.every((p) => p.isBot || p.rematch)) deal(state, now);
      return { events, response: {} };
    }
    default:
      throw new ApiError('알 수 없는 동작이에요');
  }
}

// 플레이어에게 보여줄 정보만 걸러서 보냄 (상대 선택, 아직 안 열린 카드는 숨김)
function view(state, pid, now) {
  const me = state.players.find((p) => p.id === pid);
  const opp = state.players.find((p) => p.id !== pid);
  const v = {
    game: 'memory-poker', mode: state.mode, phase: state.phase, round: state.round,
    startsAt: state.startsAt || null, phaseEndsAt: state.phaseEndsAt || null,
    settings: { memorizeSec: MEMORIZE_SEC, selectSec: SELECT_SEC },
    me: {
      id: me.id, name: me.name, confirmed: me.confirmed, rematch: me.rematch,
      picks: me.confirmed ? me.picks : [],
      hint: {
        status: me.hint.status,
        question: me.hint.status === 'asking' ? { kind: me.hint.q.kind, prompt: me.hint.q.prompt, unit: me.hint.q.unit || null } : null,
        revealed: me.hint.revealed,
      },
    },
    opp: opp ? { name: opp.name, isBot: opp.isBot, confirmed: opp.confirmed, rematch: opp.rematch } : null,
  };
  if (state.phase === 'memorize' && now >= state.startsAt) v.deck = state.deck;
  if (state.phase === 'select' || state.phase === 'result') v.shared = state.shared;
  if (state.phase === 'result') { v.result = state.result; v.deck = state.deck; }
  return v;
}

// 암기 단계는 시간에 따라 보이는 정보가 달라지므로 매번 응답, 그 밖에는 변화가 없으면 짧게 응답
const stableForPoll = (state) => state.phase !== 'memorize';

module.exports = { create, join, advance, handle, view, stableForPoll };
