'use strict';
// Neon 서버리스 드라이버(HTTP 방식): 요청마다 연결을 만들지 않아 동시 접속이 몰려도 연결 수 제한에 걸리지 않습니다.
const { neon } = require('@neondatabase/serverless');

let sql = null;
let ready = null;

function getSql() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다');
    sql = neon(url);
  }
  return sql;
}

// 테이블이 없으면 만든다 (서버 인스턴스당 1번만 실행)
function ensureSchema() {
  if (ready) return ready;
  const q = getSql();
  ready = (async () => {
    await q`CREATE TABLE IF NOT EXISTS rooms (
      code       text PRIMARY KEY,
      game_id    text NOT NULL,
      mode       text NOT NULL,
      state      jsonb NOT NULL,
      version    integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await q`CREATE INDEX IF NOT EXISTS rooms_updated_idx ON rooms (updated_at)`;
    await q`CREATE TABLE IF NOT EXISTS answer_logs (
      id          bigserial PRIMARY KEY,
      room_code   text,
      game_id     text,
      player_name text,
      kind        text,
      prompt      text,
      correct     boolean,
      created_at  timestamptz NOT NULL DEFAULT now()
    )`;
    await q`CREATE TABLE IF NOT EXISTS game_results (
      id         bigserial PRIMARY KEY,
      room_code  text,
      game_id    text,
      mode       text,
      p1_name    text,
      p2_name    text,
      winner     text,
      detail     jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

module.exports = { getSql, ensureSchema };
