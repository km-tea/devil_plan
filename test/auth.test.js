// 로그인(학생·교사)·교사 기능·학습 기록 연결 검사 (가짜 sql 사용, 이 파일에서는 ALLOW_GUEST 를 켜지 않음)
const test = require('node:test');
const assert = require('node:assert/strict');

const db = { teachers: [], students: [], sessions: [], attempts: [], logs: [], results: [], rooms: new Map(), nextId: 1 };
const norm = (strings, vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? '$' + (i + 1) : ''), '').replace(/\s+/g, ' ').trim();
async function fakeSql(strings, ...v) {
  await Promise.resolve();
  const q = norm(strings, v);
  const has = (s) => q.includes(s);
  // --- 로그인 ---
  if (has('FROM login_attempts WHERE ip')) return [{ n: db.attempts.filter((a) => a.ip === v[0] && a.role === v[1]).length }];
  if (q.startsWith('INSERT INTO login_attempts')) { db.attempts.push({ ip: v[0], role: v[1] }); return []; }
  if (q.startsWith('DELETE FROM sessions WHERE expires_at') || q.startsWith('DELETE FROM login_attempts')) return [];
  if (q.startsWith('INSERT INTO sessions')) { db.sessions.push({ hash: v[0], role: v[1], student_id: v[2], exp: Date.now() + parseInt(v[3], 10) * 3600e3 }); return []; }
  if (q.startsWith('SELECT role, student_id FROM sessions')) return db.sessions.filter((s) => s.hash === v[0] && s.exp > Date.now()).map((s) => ({ role: s.role, student_id: s.student_id }));
  if (q.startsWith('DELETE FROM sessions WHERE token_hash')) { db.sessions = db.sessions.filter((s) => s.hash !== v[0]); return []; }
  if (q.startsWith('DELETE FROM sessions WHERE student_id')) { db.sessions = db.sessions.filter((s) => s.student_id !== v[0]); return []; }
  if (q.startsWith('SELECT id, num, name FROM students WHERE class_code') && has('password')) return db.students.filter((s) => s.class_code === v[0] && s.password === v[1]).slice(0, 1);
  if (q.startsWith('SELECT id, num, name FROM students WHERE class_code')) return db.students.filter((s) => s.class_code === v[0] && s.num === v[1]);
  if (q.startsWith('SELECT id FROM students WHERE class_code')) return db.students.filter((s) => s.class_code === v[0] && s.num === v[1]).map((s) => ({ id: s.id }));
  if (q.startsWith('SELECT id, num, name FROM students WHERE id')) return db.students.filter((s) => s.id === v[0]);
  // --- 교사 계정 ---
  if (q.startsWith('SELECT id FROM teachers WHERE teacher_id')) return db.teachers.filter((t) => t.teacher_id === v[0]).map((t) => ({ id: t.id }));
  if (q.startsWith('SELECT id FROM teachers WHERE class_code')) return db.teachers.filter((t) => t.class_code === v[0]).map((t) => ({ id: t.id }));
  if (q.startsWith('INSERT INTO teachers')) { const t = { id: db.nextId++, teacher_id: v[0], pw: v[1], class_code: v[2] }; db.teachers.push(t); return [{ id: t.id }]; }
  if (q.startsWith('SELECT id, teacher_id, pw, class_code FROM teachers')) return db.teachers.filter((t) => t.teacher_id === v[0]);
  if (q.startsWith('SELECT id, teacher_id, class_code FROM teachers WHERE id')) return db.teachers.filter((t) => t.id === v[0]);
  // --- 교사: 내 학급만 ---
  if (q.startsWith('SELECT num, name, password FROM students')) return db.students.filter((s) => s.class_code === v[0]);
  if (q.startsWith('INSERT INTO students')) {
    const [code, num, name, pw] = v; const ex = db.students.find((s) => s.class_code === code && s.num === num);
    if (ex) { ex.name = name; ex.password = pw; } else db.students.push({ id: db.nextId++, class_code: code, num, name, password: pw });
    return [];
  }
  if (q.startsWith('SELECT s.id, s.num')) return db.students.filter((s) => s.class_code === v[0]).map((s) => {
    const a = db.logs.filter((l) => l.student_id === s.id);
    return { ...s, total: a.length, ok_cnt: a.filter((l) => l.correct).length, last_at: a.length ? new Date().toISOString() : null };
  }).sort((x, y) => x.num - y.num);
  if (q.startsWith('SELECT p1_sid, p2_sid, winner')) return db.results;
  if (q.startsWith('DELETE FROM answer_logs WHERE student_id')) { db.logs = db.logs.filter((l) => l.student_id !== v[0]); return []; }
  if (q.startsWith('DELETE FROM students WHERE id')) { db.students = db.students.filter((s) => s.id !== v[0]); return []; }
  if (q.startsWith('SELECT created_at, game_id, kind, prompt, correct FROM answer_logs')) return db.logs.filter((l) => l.student_id === v[0]).map((l) => ({ created_at: 'x', game_id: l.game, kind: l.kind, prompt: l.prompt, correct: l.correct }));
  if (q.startsWith('SELECT created_at, game_id, mode, p1_name')) return db.results.filter((r) => r.p1_sid === v[0] || r.p2_sid === v[0]);
  const mine = (code) => db.logs.filter((l) => (db.students.find((x) => x.id === l.student_id) || {}).class_code === code);
  if (q.startsWith('SELECT a.prompt, count(*)')) {
    const m = new Map(); for (const l of mine(v[0])) { const x = m.get(l.prompt) || { prompt: l.prompt, total: 0, wrong: 0 }; x.total++; if (!l.correct) x.wrong++; m.set(l.prompt, x); }
    return [...m.values()].filter((x) => x.wrong).sort((a, b) => b.wrong - a.wrong);
  }
  if (q.startsWith('SELECT count(*)::int AS total')) return [{ total: mine(v[0]).length, ok_cnt: mine(v[0]).filter((l) => l.correct).length }];
  // --- 방 · 기록 ---
  if (q.startsWith('DELETE FROM rooms')) return [];
  if (q.startsWith('INSERT INTO rooms')) { db.rooms.set(v[0], { game_id: v[1], mode: v[2], state: JSON.parse(v[3]), version: 1 }); return [{ code: v[0] }]; }
  if (q.startsWith('SELECT game_id')) { const r = db.rooms.get(v[0]); return r ? [{ game_id: r.game_id, mode: r.mode, state: JSON.parse(JSON.stringify(r.state)), version: r.version }] : []; }
  if (q.startsWith('UPDATE rooms')) { const r = db.rooms.get(v[1]); if (!r || r.version !== v[2]) return []; r.state = JSON.parse(v[0]); r.version++; return [{ version: r.version }]; }
  if (q.startsWith('INSERT INTO answer_logs')) { db.logs.push({ game: v[1], kind: v[3], prompt: v[4], correct: v[5], student_id: v[6] }); return []; }
  if (q.startsWith('INSERT INTO game_results')) { db.results.push({ created_at: 'x', game_id: v[1], mode: v[2], p1_name: v[3], p2_name: v[4], winner: v[5], detail: JSON.parse(v[6]), p1_sid: v[7], p2_sid: v[8] }); return []; }
  throw new Error('예상 못한 쿼리: ' + q);
}
const dbPath = require.resolve('../netlify/functions/lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql: () => fakeSql, ensureSchema: async () => {} } };
const { handler } = require('../netlify/functions/api');
const call = async (body, ip = '1.1.1.1') => {
  const r = await handler({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': ip }, body: JSON.stringify(body) });
  return { status: r.statusCode, ...JSON.parse(r.body) };
};

let T, TB; // 교사 A(6200), 교사 B 열쇠
const roster = [{ num: 1, name: '홍길동', password: '1234' }, { num: 2, name: '김철수', password: 'A2b3' }, { num: 3, name: '이영희', password: '0007' }];

test('교사 처음 등록: 아이디·비밀번호·학급 코드를 직접 정하고, 겹치거나 형식이 틀리면 거절', async () => {
  const reg = (o, ip) => call({ action: 'teacher_register', ...o }, ip);
  assert.equal((await reg({ id: 'ab', password: 'secret1', code: '6200' })).status, 400, '아이디 너무 짧음');
  assert.equal((await reg({ id: '0227kkm', password: '123', code: '6200' })).status, 400, '비밀번호 너무 짧음');
  assert.equal((await reg({ id: '0227kkm', password: 'secret1', code: '12' })).status, 400, '학급 코드 형식');
  const a = await reg({ id: '0227KKM', password: 'secret1', code: '6200' });
  assert.equal(a.status, 200); assert.equal(a.teacher.id, '0227kkm'); assert.equal(a.teacher.code, '6200'); T = a.token;
  assert.notEqual(db.teachers[0].pw, 'secret1', '비밀번호는 그대로 저장하지 않음');
  assert.equal((await reg({ id: '0227kkm', password: 'other-pw', code: '7777' })).status, 409, '아이디 중복');
  assert.equal((await reg({ id: 'teacher2', password: 'other-pw', code: '6200' })).status, 409, '학급 코드 중복');
  const b = await reg({ id: 'teacher2', password: 'other-pw', code: '7777' });
  assert.equal(b.status, 200); TB = b.token;
  assert.equal(db.teachers.length, 2);
});

test('교사 로그인: 아이디(대소문자 무시)·비밀번호 확인, 다른 사람 열쇠·학생 열쇠로는 교사 기능 불가', async () => {
  assert.equal((await call({ action: 'teacher_login', id: '0227kkm', password: 'wrong-pw' })).status, 401);
  assert.equal((await call({ action: 'teacher_login', id: 'nobody', password: 'secret1' })).status, 401);
  const ok = await call({ action: 'teacher_login', id: '0227KKM', password: 'secret1' });
  assert.equal(ok.status, 200); assert.equal(ok.teacher.code, '6200');
  assert.equal((await call({ action: 'students_list', tauth: 'x' })).status, 401);
  assert.equal((await call({ action: 'students_list', tauth: ok.token })).classCode, '6200');
});

test('학생 일괄 등록: 정상 / 비밀번호 중복·형식 오류는 하나도 저장하지 않음 / 같은 번호는 수정', async () => {
  const bad = await call({ action: 'students_upsert', tauth: T, rows: [{ num: 1, name: '홍길동', password: '1234' }, { num: 2, name: '김철수', password: '1234' }] });
  assert.equal(bad.ok, false); assert.match(bad.errors.join(), /같이 쓰고/); assert.equal(db.students.length, 0);
  const fmt = await call({ action: 'students_upsert', tauth: T, rows: [{ num: 1, name: '홍길동', password: '12' }, { num: 'x', name: '가', password: '1234' }, { num: 3, name: '', password: '1234' }] });
  assert.equal(fmt.ok, false); assert.equal(fmt.errors.length, 3);
  const dupNum = await call({ action: 'students_upsert', tauth: T, rows: [{ num: 1, name: '가', password: '1111' }, { num: 1, name: '나', password: '2222' }] });
  assert.equal(dupNum.ok, false);
  const ok = await call({ action: 'students_upsert', tauth: T, rows: roster });
  assert.deepEqual([ok.ok, ok.added, ok.updated], [true, 3, 0]);
  assert.equal(db.students.find((s) => s.num === 2).password, 'a2b3', '대소문자 구분 없이 소문자로 저장');
  assert.ok(db.students.every((s) => s.class_code === '6200'), '교사의 학급 코드로 저장');
  const upd = await call({ action: 'students_upsert', tauth: T, rows: [{ num: 3, name: '이영희', password: '9999' }] });
  assert.deepEqual([upd.added, upd.updated], [0, 1]);
  const clash = await call({ action: 'students_upsert', tauth: T, rows: [{ num: 3, name: '이영희', password: '1234' }] });
  assert.equal(clash.ok, false);
  await call({ action: 'students_upsert', tauth: T, rows: [{ num: 3, name: '이영희', password: '0007' }] });
});

test('학급 분리: 다른 선생님 학급에서는 같은 비밀번호·번호를 써도 되고, 서로의 학생·기록은 보이지 않는다', async () => {
  const r = await call({ action: 'students_upsert', tauth: TB, rows: [{ num: 1, name: '박민수', password: '1234' }] });
  assert.equal(r.ok, true);
  assert.equal((await call({ action: 'students_list', tauth: TB })).students.length, 1);
  assert.equal((await call({ action: 'students_list', tauth: T })).students.length, 3);
  const a = await call({ action: 'student_login', code: '6200', password: '1234' });
  const b = await call({ action: 'student_login', code: '7777', password: '1234' });
  assert.equal(a.student.name, '홍길동'); assert.equal(b.student.name, '박민수');
  assert.equal((await call({ action: 'student_login', code: '7777', password: 'a2b3' })).status, 401, '남의 학급 코드로는 우리 반 학생 비밀번호가 안 통함');
  assert.equal((await call({ action: 'student_activity', tauth: TB, num: 2 })).status, 404, '내 학급에 없는 번호');
  assert.equal((await call({ action: 'student_delete', tauth: TB, num: 2 })).status, 404);
  await call({ action: 'student_delete', tauth: TB, num: 1 });
  assert.equal(db.students.filter((s) => s.class_code === '6200').length, 3);
  await call({ action: 'students_upsert', tauth: TB, rows: [{ num: 1, name: '박민수', password: '1234' }] });
});

test('학생 로그인: 학급 코드 + 비밀번호(대소문자 무시), 틀리면 같은 안내, 로그아웃하면 무효', async () => {
  const a = await call({ action: 'student_login', code: '9999', password: '1234' });
  const b = await call({ action: 'student_login', code: '6200', password: 'zzzz' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.error, b.error);
  const ok = await call({ action: 'student_login', code: '6200', password: 'A2B3' });
  assert.equal(ok.status, 200); assert.equal(ok.student.name, '김철수'); assert.equal(ok.student.num, 2);
  assert.equal((await call({ action: 'whoami', auth: ok.token })).student.name, '김철수');
  assert.equal((await call({ action: 'whoami', auth: 'bad' })).student, null);
  await call({ action: 'logout', auth: ok.token });
  assert.equal((await call({ action: 'whoami', auth: ok.token })).student, null);
  assert.equal((await call({ action: 'students_list', tauth: ok.token })).status, 401, '학생 열쇠로 교사 기능 불가');
});

test('실패·가입 시도가 너무 많으면 잠시 막는다 (같은 IP 기준, 다른 IP는 영향 없음)', async () => {
  for (let i = 0; i < 60; i++) await call({ action: 'student_login', code: '6200', password: 'nnnn' }, '9.9.9.9');
  assert.equal((await call({ action: 'student_login', code: '6200', password: '1234' }, '9.9.9.9')).status, 429);
  assert.equal((await call({ action: 'student_login', code: '6200', password: '1234' }, '8.8.8.8')).status, 200);
  for (let i = 0; i < 10; i++) await call({ action: 'teacher_register', id: 'x' + i, password: '12', code: '12' }, '7.7.7.7');
  assert.equal((await call({ action: 'teacher_register', id: 'spam1', password: 'secret1', code: '5555' }, '7.7.7.7')).status, 429);
});

test('로그인 없이는 방을 못 만들고, 로그인하면 계정 이름으로 입장하며 힌트 풀이가 학생에게 기록된다', async () => {
  assert.equal((await call({ action: 'create', game: 'gyeolhap', mode: 'cpu', name: '아무개', settings: {} })).status, 401);
  const lg = await call({ action: 'student_login', code: '6200', password: '1234' });
  const c = await call({ action: 'create', game: 'gyeolhap', mode: 'cpu', auth: lg.token, name: '가짜이름', settings: { semester: '2' } });
  assert.equal(c.status, 200);
  const room = db.rooms.get(c.code);
  assert.equal(room.state.players[0].name, '홍길동', '이름은 계정에서 가져옴');
  assert.equal(room.state.players[0].sid, db.students.find((s) => s.num === 1).id);
  const st = await call({ action: 'state', code: c.code, token: c.token, v: -1 });
  assert.ok(!JSON.stringify(st).includes('"sid"'), '학생 번호는 화면으로 보내지 않음');
  // 게임을 시작시키고(3초 뒤) 내 차례에 힌트 문제 풀기
  const realNow = Date.now; Date.now = () => realNow() + 4000;
  try {
    await call({ action: 'state', code: c.code, token: c.token, v: -1 });
    const r = db.rooms.get(c.code).state;
    assert.equal(r.turn.pid, 'p1');
    const hs = await call({ action: 'hint_start', code: c.code, token: c.token, payload: { kind: 'time' } });
    assert.equal(hs.status, 200, hs.error);
    const ans = db.rooms.get(c.code).state.players[0].hint.q.answer;
    const res = await call({ action: 'hint_answer', code: c.code, token: c.token, payload: { text: ans } });
    assert.equal(res.response.correct, true);
  } finally { Date.now = realNow; }
  const log = db.logs[db.logs.length - 1];
  assert.equal(log.student_id, db.students.find((s) => s.num === 1).id);
  assert.equal(log.correct, true); assert.match(log.prompt, /^\[6-2/);
});

test('교사: 명단 통계 · 학생별 기록 · 오답 분석 · 삭제', async () => {
  const sid = db.students.find((s) => s.num === 1).id;
  db.logs.push({ student_id: sid, game: 'gyeolhap', kind: 'social', prompt: '[6-2] 문제 A → 답', correct: false });
  db.results.push({ created_at: 'x', game_id: 'gyeolhap', mode: 'cpu', p1_name: '홍길동', p2_name: '컴퓨터', winner: 'p1', detail: { scores: { p1: 9, p2: 4 } }, p1_sid: sid, p2_sid: null });
  const list = await call({ action: 'students_list', tauth: T });
  const s1 = list.students.find((s) => s.num === 1);
  assert.equal(s1.total, 2); assert.equal(s1.ok, 1); assert.equal(s1.games, 1); assert.equal(s1.wins, 1);
  assert.equal(list.classCode, '6200'); assert.equal(s1.password, '1234');
  const act = await call({ action: 'student_activity', tauth: T, num: 1 });
  assert.equal(act.answers.length, 2); assert.equal(act.games[0].result, 'win'); assert.equal(act.games[0].score, '9 : 4');
  const rep = await call({ action: 'class_report', tauth: T });
  assert.equal(rep.wrong[0].wrong, 1);
  assert.equal((await call({ action: 'class_report', tauth: TB })).total, 0, '다른 선생님 학급 기록은 보이지 않음');
  assert.equal((await call({ action: 'student_activity', tauth: T, num: 77 })).status, 404);
  assert.equal((await call({ action: 'student_delete', tauth: T, num: 1 })).ok, true);
  assert.ok(!db.students.some((s) => s.num === 1 && s.class_code === '6200'));
  assert.equal(db.logs.filter((l) => l.student_id === sid).length, 0);
});
