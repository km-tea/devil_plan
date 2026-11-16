'use strict';
const crypto = require('crypto');
const { getSql } = require('./db');
const { ApiError } = require('./errors');
const games = require('./games');

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || '학생';
const newToken = () => crypto.randomBytes(12).toString('hex');

function getGame(id) {
  const g = games[id];
  if (!g) throw new ApiError('알 수 없는 게임이에요');
  return g;
}
function checkCode(c) {
  c = String(c || '').trim();
  if (!/^\d{4}$/.test(c)) throw new ApiError('방 번호는 숫자 4자리예요');
  return c;
}
function findPlayer(state, token) {
  const p = token && state.players.find((x) => x.token === token);
  if (!p) throw new ApiError('이 방의 참가자가 아니에요', 403);
  return p;
}

/**
 * 방 상태를 읽고 → 수정하고 → 저장하는 공통 통로.
 * version 값이 바뀌지 않았을 때만 저장하는 "낙관적 잠금"이라,
 * 두 명이 동시에 요청해도 서로의 변경을 덮어쓰지 않습니다. (충돌 시 자동 재시도)
 */
async function mutate(code, fn) {
  const sql = getSql();
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await sql`SELECT game_id, mode, state, version FROM rooms WHERE code = ${code}`;
    if (!rows.length) throw new ApiError('방을 찾을 수 없어요. 번호를 다시 확인해 주세요', 404);
    const row = rows[0];
    const game = getGame(row.game_id);
    const state = row.state;
    const now = Date.now();
    const out = fn({ state, game, now });
    if (!out.changed) return { out, state, game, gameId: row.game_id, mode: row.mode, version: row.version, now };
    const upd = await sql`UPDATE rooms SET state = ${JSON.stringify(state)}::jsonb, version = version + 1, updated_at = now()
                          WHERE code = ${code} AND version = ${row.version} RETURNING version`;
    if (upd.length) return { out, state, game, gameId: row.game_id, mode: row.mode, version: upd[0].version, now };
  }
  throw new ApiError('접속이 몰려 잠시 느려요. 다시 시도해 주세요', 503);
}

// 학습 기록(문제 풀이, 게임 결과) 저장 — 실패해도 게임은 계속 진행
async function flush(events, r, code) {
  if (!events || !events.length) return;
  const sql = getSql();
  const players = r.state.players || [];
  const sidOf = (pid) => { const p = players.find((x) => x.id === pid); return p && p.sid != null ? p.sid : null; };
  for (const e of events) {
    try {
      if (e.type === 'answer') {
        await sql`INSERT INTO answer_logs (room_code, game_id, player_name, kind, prompt, correct, student_id)
                  VALUES (${code}, ${r.gameId}, ${e.player}, ${e.kind}, ${e.prompt}, ${e.correct}, ${sidOf(e.pid)})`;
      } else if (e.type === 'result') {
        await sql`INSERT INTO game_results (room_code, game_id, mode, p1_name, p2_name, winner, detail, p1_sid, p2_sid)
                  VALUES (${code}, ${r.gameId}, ${r.mode}, ${e.p1}, ${e.p2}, ${e.winner}, ${JSON.stringify(e.hands)}::jsonb, ${sidOf('p1')}, ${sidOf('p2')})`;
      } else if (e.type === 'coop') { // 협력 게임: 참가한 학생마다 결과 한 줄
        for (const pl of e.players) {
          await sql`INSERT INTO game_results (room_code, game_id, mode, p1_name, p2_name, winner, detail, p1_sid, p2_sid)
                    VALUES (${code}, ${r.gameId}, ${r.mode}, ${pl.name}, ${e.together}, 'coop', ${JSON.stringify(e.hands)}::jsonb, ${sidOf(pl.pid)}, ${null})`;
        }
      }
    } catch (err) { console.error('log failed', err.message); }
  }
}

const pack = (r, code) => ({ now: r.now, v: r.version, code, view: r.game.view(r.state, r.out.pid, r.now) });

async function create({ game: gameId, mode, name, settings, sid }) {
  const game = getGame(gameId);
  if (!['pvp', 'cpu'].includes(mode)) throw new ApiError('모드를 확인해 주세요');
  const token = newToken();
  const state = game.create({ mode, settings, host: { name: cleanName(name), token }, now: Date.now() });
  state.players[0].sid = sid == null ? null : sid; // 학습 기록을 학생과 연결
  const body = JSON.stringify(state);
  const sql = getSql();

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await sql`DELETE FROM rooms WHERE updated_at < now() - interval '3 hours'`;
  };
  if (Math.random() < 0.1) await cleanup(); // 가끔 오래된 방 정리

  for (let i = 0; i < 15; i++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const rows = await sql`INSERT INTO rooms (code, game_id, mode, state)
                           VALUES (${code}, ${gameId}, ${mode}, ${body}::jsonb)
                           ON CONFLICT (code) DO NOTHING RETURNING code`;
    if (rows.length) return { code, token, pid: 'p1', game: gameId };
    await cleanup(); // 번호가 겹치면 3시간 지난 방부터 치우고 다시 뽑기
  }
  throw new ApiError('지금 빈 방 번호가 없어요. 잠시 뒤에 다시 시도해 주세요', 503);
}

async function join({ code, name, sid }) {
  code = checkCode(code);
  const token = newToken();
  const r = await mutate(code, ({ state, game, now }) => {
    const pid = game.join(state, { name: cleanName(name), token }, now);
    state.players.find((p) => p.token === token).sid = sid == null ? null : sid;
    return { changed: true, pid };
  });
  return { code, token, pid: r.out.pid, game: r.gameId };
}

async function state({ code, token, v }) {
  code = checkCode(code);
  const r = await mutate(code, ({ state, game, now }) => {
    const p = findPlayer(state, token);
    const a = game.advance(state, now);
    return { changed: a.changed, events: a.events, pid: p.id };
  });
  await flush(r.out.events, r, code);
  // 바뀐 게 없으면 아주 작은 응답만 보낸다 (많은 학생이 동시에 폴링해도 가볍게)
  if (!r.out.changed && Number(v) === r.version && r.game.stableForPoll(r.state)) {
    return { unchanged: true, now: r.now };
  }
  return pack(r, code);
}

async function act({ code, token, action, payload }) {
  code = checkCode(code);
  const r = await mutate(code, ({ state, game, now }) => {
    const p = findPlayer(state, token);
    const a = game.advance(state, now);
    const h = game.handle(state, p, String(action || ''), payload || {}, now);
    return { changed: true, pid: p.id, events: [...a.events, ...(h.events || [])], response: h.response || {} };
  });
  await flush(r.out.events, r, code);
  return { ...pack(r, code), response: r.out.response };
}

module.exports = { create, join, state, act };
