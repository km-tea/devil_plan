'use strict';
// 워드 타워 — 서버 쪽 게임 모듈 (규격: create / join / advance / handle / view / stableForPoll)
//
// 협력 게임: 1~7명이 같은 판을 함께 만진다.
//  - 한 라운드 = 주제 1개. 그 주제의 영어 단어 7개를 섞은 알파벳 큐브가 주어지고, 큐브를 하나도 남기지 않고 7개의 단어를 만든다.
//  - 어떤 단어를 만들어야 하는지는 알려주지 않는다(주제만 공개). 주제에 맞는 단어이면 정답 예시와 달라도 인정한다.
//  - 한 라운드 최대 5분. 모두 맞히면 바로 다음 라운드, 시간이 끝나면 정답 예시를 보여 주고 다음으로 넘어간다.
//  - 라운드는 난이도 하 → 중 → 상 순서로 배치된다(설정으로 단계 선택 가능).
// 서버리스라 타이머가 없으므로 요청이 올 때마다 advance()가 "지난 시각"까지 한꺼번에 처리한다.
const { ApiError } = require('../../errors');
const TOPICS = require('./topics');

const ROUND_SEC = 300;       // 한 라운드 최대 시간 (5분)
const BETWEEN_SEC = 20;      // 라운드 사이 정답·뜻 확인 시간
const WORDS = 7;             // 만들 단어 수 (고정)
const MAX_PLAYERS = 7;
const MAX_ROW = 12;          // 한 줄에 놓을 수 있는 큐브 수
const LEVELS = ['low', 'mid', 'high'];
const LEVEL_LABEL = { low: '하', mid: '중', high: '상' };

const byId = (id) => TOPICS.find((t) => t.id === id);
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function cleanSettings(s) {
  s = s || {};
  return {
    level: ['all', 'mix3', 'low', 'mid', 'high'].includes(s.level) ? s.level : 'all',
    feedback: ['rows', 'count'].includes(s.feedback) ? s.feedback : 'rows', // rows: 맞은 줄 표시 / count: 맞은 개수만
  };
}

// 난이도 순서(하→중→상)로 라운드 주제 목록을 만든다. 같은 단계 안에서는 매번 섞는다.
function buildQueue(level) {
  const pool = (l) => shuffle(TOPICS.filter((t) => t.level === l).map((t) => t.id));
  if (level === 'all') return LEVELS.flatMap(pool);
  if (level === 'mix3') return LEVELS.map((l) => pool(l)[0]);
  return pool(level);
}

const newPlayer = (id, name, token) => ({ id, name, token });
const me = (state, pid) => state.players.find((p) => p.id === pid);
const isHost = (state, player) => player.id === state.hostId;

function create({ mode, settings, host, now }) {
  const state = {
    phase: 'lobby', mode, settings: cleanSettings(settings), hostId: 'p1',
    players: [newPlayer('p1', host.name, host.token)],
    queue: [], round: 0, results: [], cubes: [], rows: [], startAt: null, endsAt: null, nextAt: null,
    check: null, checkNo: 0, last: null, final: null,
  };
  if (mode === 'cpu') startGame(state, now); // 혼자 하기: 바로 시작
  return state;
}

function join(state, { name, token }) {
  if (state.mode !== 'pvp') throw new ApiError('혼자 하는 방이에요');
  if (state.phase !== 'lobby') throw new ApiError('이미 시작한 방이에요. 다음 판에 들어와 주세요');
  if (state.players.length >= MAX_PLAYERS) throw new ApiError(`한 방에는 ${MAX_PLAYERS}명까지 들어올 수 있어요`);
  const id = 'p' + (state.players.length + 1);
  state.players.push(newPlayer(id, name, token));
  return id;
}

/* ---------- 라운드 진행 ---------- */
function startGame(state, now) {
  state.queue = buildQueue(state.settings.level);
  state.round = 0; state.results = []; state.final = null; state.last = null;
  startRound(state, now);
}

function startRound(state, at) {
  state.round += 1;
  const topic = byId(state.queue[state.round - 1]);
  const letters = shuffle(topic.answer.join('').split(''));
  state.cubes = letters.map((ch, i) => ({ id: 'c' + i, ch }));
  state.rows = Array.from({ length: WORDS }, () => []);
  state.phase = 'play'; state.startAt = at; state.endsAt = at + ROUND_SEC * 1000; state.nextAt = null;
  state.check = null; state.last = null;
}

const rowWord = (state, row) => row.map((id) => state.cubes.find((c) => c.id === id).ch).join('');
const usedCount = (state) => state.rows.reduce((n, r) => n + r.length, 0);

// 지금 놓인 줄을 평가: 줄마다 주제에 맞는 단어인지, 전체가 7개 서로 다른 정답이고 큐브를 다 썼는지
function evaluate(state) {
  const topic = byId(state.queue[state.round - 1]);
  const words = state.rows.map((r) => rowWord(state, r));
  const ok = words.map((w) => w.length > 0 && topic.accept.includes(w));
  const valid = ok.filter(Boolean).length;
  const distinct = new Set(words.filter((w, i) => ok[i])).size === valid;
  const solved = valid === WORDS && distinct && usedCount(state) === state.cubes.length;
  return { words, ok, valid, solved, topic };
}

function endRound(state, at, solved, reason, events) {
  const topic = byId(state.queue[state.round - 1]);
  const sec = Math.min(ROUND_SEC, Math.round((at - state.startAt) / 1000));
  const words = solved
    ? state.rows.map((r) => rowWord(state, r))
    : topic.answer.slice();
  state.results.push({ topic: topic.id, name: topic.name, level: topic.level, solved, sec });
  state.last = { solved, reason, topic: topic.id, name: topic.name, level: topic.level, sec, words: words.map((w) => ({ w, ko: topic.ko[w] || null })) };
  for (const p of state.players) {
    events.push({ type: 'answer', pid: p.id, player: p.name, kind: 'wordtower', prompt: `[워드 타워 ${LEVEL_LABEL[topic.level]}] ${topic.name}`, correct: solved });
  }
  state.phase = 'between'; state.nextAt = at + BETWEEN_SEC * 1000;
}

function finish(state, events) {
  const solved = state.results.filter((r) => r.solved).length;
  const seconds = state.results.reduce((n, r) => n + r.sec, 0);
  state.phase = 'result'; state.nextAt = null;
  state.final = { solved, total: state.results.length, seconds };
  events.push({ type: 'coop', players: state.players.map((p) => ({ pid: p.id, name: p.name })), together: state.players.length > 1 ? `${state.players.length}명이 함께` : '혼자',
    hands: { solved, total: state.results.length, seconds, players: state.players.length } });
}

function advance(state, now) {
  const events = [];
  let changed = false;
  for (let guard = 0; guard < 30; guard++) {
    if (state.phase === 'play' && now >= state.endsAt) endRound(state, state.endsAt, false, 'time', events);
    else if (state.phase === 'between' && now >= state.nextAt) {
      if (state.round >= state.queue.length) finish(state, events); else startRound(state, state.nextAt);
    } else break;
    changed = true;
  }
  return { changed, events };
}

const need = (cond, msg) => { if (!cond) throw new ApiError(msg || '지금은 할 수 없어요'); };
const rowIndex = (state, id) => state.rows.findIndex((r) => r.includes(id));

function handle(state, player, action, payload, now) {
  const events = [];
  const playing = () => need(state.phase === 'play', '지금은 할 수 없어요');
  switch (action) {
    case 'start': {
      need(state.phase === 'lobby' && isHost(state, player), '방장만 시작할 수 있어요');
      startGame(state, now);
      return { events, response: {} };
    }
    case 'add': { // 큐브를 줄 맨 끝에 놓기
      playing();
      const row = Number(payload.row), cube = String(payload.cube);
      need(Number.isInteger(row) && row >= 0 && row < WORDS, '줄을 확인해 주세요');
      need(state.cubes.some((c) => c.id === cube), '없는 큐브예요');
      need(rowIndex(state, cube) < 0, '이미 다른 곳에 놓인 큐브예요');
      need(state.rows[row].length < MAX_ROW, '한 줄에는 큐브를 12개까지 놓을 수 있어요');
      state.rows[row].push(cube);
      return { events, response: {} };
    }
    case 'remove': { // 놓인 큐브를 다시 판으로
      playing();
      const cube = String(payload.cube), r = rowIndex(state, cube);
      need(r >= 0, '이미 빼 놓은 큐브예요');
      state.rows[r] = state.rows[r].filter((id) => id !== cube);
      return { events, response: {} };
    }
    case 'clear': {
      playing();
      const row = Number(payload.row);
      need(Number.isInteger(row) && row >= 0 && row < WORDS, '줄을 확인해 주세요');
      state.rows[row] = [];
      return { events, response: {} };
    }
    case 'check': {
      playing();
      const ev = evaluate(state);
      state.checkNo += 1;
      state.check = {
        no: state.checkNo, by: player.id, valid: ev.valid, solved: ev.solved,
        rows: state.settings.feedback === 'rows' ? state.rows.map((r, i) => ({ sig: r.join(','), ok: ev.ok[i] })) : null,
        unused: state.cubes.length - usedCount(state),
      };
      if (ev.solved) endRound(state, now, true, 'solved', events);
      return { events, response: { valid: ev.valid, solved: ev.solved } };
    }
    case 'giveup': {
      need(state.phase === 'play' && isHost(state, player), '방장만 이 라운드를 넘길 수 있어요');
      endRound(state, now, false, 'giveup', events);
      return { events, response: {} };
    }
    case 'next': {
      need(state.phase === 'between' && isHost(state, player), '방장만 바로 넘길 수 있어요');
      if (state.round >= state.queue.length) finish(state, events); else startRound(state, now);
      return { events, response: {} };
    }
    case 'rematch': {
      need(state.phase === 'result' && isHost(state, player), '방장만 다시 시작할 수 있어요');
      startGame(state, now);
      return { events, response: {} };
    }
    default:
      throw new ApiError('알 수 없는 동작이에요');
  }
}

// 플레이어에게 보낼 정보. 정답 예시는 라운드가 끝나기 전에는 보내지 않는다.
function view(state, pid) {
  const idx = state.players.findIndex((p) => p.id === pid);
  const v = {
    game: 'word-tower', mode: state.mode, phase: state.phase,
    settings: { roundSec: ROUND_SEC, words: WORDS, maxPlayers: MAX_PLAYERS, feedback: state.settings.feedback, level: state.settings.level },
    me: { id: pid, index: idx, host: pid === state.hostId },
    players: state.players.map((p) => ({ id: p.id, name: p.name })),
    round: state.round, totalRounds: state.queue.length,
    deadline: state.phase === 'play' ? state.endsAt : state.phase === 'between' ? state.nextAt : null,
  };
  if (state.phase === 'play' || state.phase === 'between') {
    const t = byId(state.queue[state.round - 1]);
    v.topic = { id: t.id, name: t.name, emoji: t.emoji, level: t.level };
    v.cubes = state.cubes; v.rows = state.rows; v.check = state.check;
    if (state.phase === 'play') v.endsAt = state.endsAt;
  }
  if (state.phase === 'between') { v.last = state.last; v.nextAt = state.nextAt; }
  if (state.phase === 'between' || state.phase === 'result') v.results = state.results;
  if (state.phase === 'result') v.final = state.final;
  return v;
}

const stableForPoll = () => true;

module.exports = {
  create, join, advance, handle, view, stableForPoll,
  constants: { ROUND_SEC, BETWEEN_SEC, WORDS, MAX_PLAYERS, MAX_ROW, LEVEL_LABEL },
};
