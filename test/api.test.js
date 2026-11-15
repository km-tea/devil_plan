process.env.ALLOW_GUEST = '1'; // 로그인 없이 이름만으로 입장 (게임 흐름 검사용)
// DB 없이 전체 흐름(api.js → rooms.js → 게임 모듈)을 검사: 가짜 sql로 Neon을 대신함
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const rooms = new Map();
const logs = [];
async function fakeSql(strings, ...vals) {
  await Promise.resolve(); // 실제 네트워크처럼 요청이 서로 끼어들 수 있게
  const q = strings.reduce((a, s, i) => a + s + (i < vals.length ? '$' + (i + 1) : ''), '').replace(/\s+/g, ' ').trim();
  if (q.startsWith('DELETE FROM rooms')) return [];
  if (q.startsWith('INSERT INTO rooms')) {
    const [code, game, mode, state] = vals;
    if (rooms.has(code)) return [];
    rooms.set(code, { game_id: game, mode, state: JSON.parse(state), version: 1 });
    return [{ code }];
  }
  if (q.startsWith('SELECT game_id')) {
    const r = rooms.get(vals[0]);
    return r ? [{ game_id: r.game_id, mode: r.mode, state: JSON.parse(JSON.stringify(r.state)), version: r.version }] : [];
  }
  if (q.startsWith('UPDATE rooms')) {
    const [state, code, ver] = vals;
    const r = rooms.get(code);
    if (!r || r.version !== ver) return [];
    r.state = JSON.parse(state); r.version++;
    return [{ version: r.version }];
  }
  if (q.startsWith('INSERT INTO answer_logs') || q.startsWith('INSERT INTO game_results')) { logs.push(q.split(' ')[2]); return []; }
  throw new Error('예상 못한 쿼리: ' + q);
}
const dbPath = require.resolve('../netlify/functions/lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql: () => fakeSql, ensureSchema: async () => {} } };
const { handler } = require('../netlify/functions/api');

let skew = 0;
const realNow = Date.now;
Date.now = () => realNow() + skew;

const call = async (body) => {
  const r = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: r.statusCode, ...JSON.parse(r.body) };
};

test('방 만들기(4자리 코드) → 입장 → 폴링 → 시간 경과 → 확정 → 결과 기록', async () => {
  const c = await call({ action: 'create', game: 'memory-poker', mode: 'pvp', name: '지민', settings: {} });
  assert.match(c.code, /^\d{4}$/);
  let st = await call({ action: 'state', code: c.code, token: c.token, v: -1 });
  assert.equal(st.view.phase, 'waiting');
  const again = await call({ action: 'state', code: c.code, token: c.token, v: st.v });
  assert.equal(again.unchanged, true, '변화 없으면 짧은 응답');

  const j = await call({ action: 'join', code: c.code, name: '서준' });
  assert.equal(j.status, 200);
  assert.equal((await call({ action: 'state', code: c.code, token: 'x', v: -1 })).status, 403);

  skew += 5000;
  st = await call({ action: 'state', code: c.code, token: c.token, v: -1 });
  assert.equal(st.view.phase, 'memorize');
  assert.equal(st.view.deck.length, 16);
  skew += 20000;
  st = await call({ action: 'state', code: c.code, token: c.token, v: st.v });
  assert.equal(st.view.phase, 'select');

  const a = await call({ action: 'confirm', code: c.code, token: c.token, payload: { picks: [0, 1] } });
  assert.equal(a.view.me.confirmed, true);
  const b = await call({ action: 'confirm', code: c.code, token: j.token, payload: { picks: [2, 3] } });
  assert.equal(b.view.phase, 'result');
  assert.ok(logs.includes('game_results'));
  const bad = await call({ action: 'confirm', code: c.code, token: j.token, payload: { picks: [2, 3] } });
  assert.equal(bad.status, 400);
});

test('동시에 두 명이 같은 방에 입장 → 정확히 한 명만 성공 (낙관적 잠금)', async () => {
  const c = await call({ action: 'create', game: 'memory-poker', mode: 'pvp', name: '방장', settings: {} });
  const rs = await Promise.all([call({ action: 'join', code: c.code, name: 'A' }), call({ action: 'join', code: c.code, name: 'B' })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
});

test('여러 방이 동시에 진행돼도 서로 섞이지 않음 (40개 방)', async () => {
  const made = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    call({ action: 'create', game: 'memory-poker', mode: 'cpu', name: '학생' + i, settings: {} })));
  assert.equal(new Set(made.map((m) => m.code)).size, 40, '방 번호 중복 없음');
  skew += 30000;
  const out = await Promise.all(made.map((m) => call({ action: 'state', code: m.code, token: m.token, v: -1 })));
  for (const o of out) assert.equal(o.view.phase, 'select');
  const done = await Promise.all(made.map((m) => call({ action: 'confirm', code: m.code, token: m.token, payload: { picks: [0, 15] } })));
  for (const d of done) assert.equal(d.view.phase, 'result');
});

test('입력 검증: 잘못된 코드/없는 방/없는 게임', async () => {
  assert.equal((await call({ action: 'join', code: '12', name: 'x' })).status, 400);
  assert.equal((await call({ action: 'state', code: '0000', token: 'x', v: 0 })).status, 404);
  assert.equal((await call({ action: 'create', game: 'nope', mode: 'pvp', name: 'x' })).status, 400);
  assert.equal((await call({ action: 'create', game: 'memory-poker', mode: 'abc', name: 'x' })).status, 400);
});
