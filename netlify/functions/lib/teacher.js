'use strict';
// 교사 기능: 학생 명단(일괄 등록 포함), 학생별 활동, 학급 오답 분석, 활동 내보내기
const { getSql } = require('./db');
const { ApiError } = require('./errors');
const { normPw, validPw } = require('./auth');

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim();

async function list(t) {
  const sql = getSql(), code = t.classCode;
  const students = await sql`
    SELECT s.id, s.num, s.name, s.password,
           COALESCE(a.total, 0)::int AS total, COALESCE(a.ok_cnt, 0)::int AS ok_cnt, a.last_at
    FROM students s
    LEFT JOIN (SELECT student_id, count(*) AS total, count(*) FILTER (WHERE correct) AS ok_cnt, max(created_at) AS last_at
               FROM answer_logs WHERE student_id IS NOT NULL GROUP BY student_id) a ON a.student_id = s.id
    WHERE s.class_code = ${code} ORDER BY s.num`;
  const ids = new Set(students.map((s) => s.id));
  const games = await sql`SELECT p1_sid, p2_sid, winner FROM game_results
                          WHERE p1_sid IN (SELECT id FROM students WHERE class_code = ${code}) OR p2_sid IN (SELECT id FROM students WHERE class_code = ${code})
                          ORDER BY id DESC LIMIT 20000`;
  const g = new Map();
  const bump = (sid, win) => { if (sid == null || !ids.has(sid)) return; // 다른 학급 친구는 세지 않음
    const x = g.get(sid) || { games: 0, wins: 0 }; x.games++; if (win) x.wins++; g.set(sid, x); };
  for (const r of games) { bump(r.p1_sid, r.winner === 'p1'); bump(r.p2_sid, r.winner === 'p2'); }
  return {
    classCode: code,
    students: students.map((s) => ({
      num: s.num, name: s.name, password: s.password, total: s.total, ok: s.ok_cnt,
      lastAt: s.last_at, games: (g.get(s.id) || {}).games || 0, wins: (g.get(s.id) || {}).wins || 0,
    })),
  };
}

// rows: [{ num, name, password }] — 번호가 같으면 수정, 없으면 추가. 하나라도 문제가 있으면 아무것도 저장하지 않고 이유를 돌려준다.
async function upsert(t, { rows }) {
  if (!Array.isArray(rows) || !rows.length) throw new ApiError('등록할 학생이 없어요');
  if (rows.length > 200) throw new ApiError('한 번에 200명까지 등록할 수 있어요');
  const sql = getSql(), code = t.classCode;
  const errors = [], clean = [];
  rows.forEach((r, i) => {
    const line = `${i + 1}번째 줄`;
    const num = Number(r.num), name = cleanName(r.name), pw = normPw(r.password);
    if (!Number.isInteger(num) || num < 1 || num > 999) return errors.push(`${line}: 번호는 1~999 사이 숫자예요`);
    if (!name) return errors.push(`${line}: 이름이 비어 있어요`);
    if (name.length > 8) return errors.push(`${line}: 이름은 8글자까지예요 (${name})`);
    if (!validPw(pw)) return errors.push(`${line}(${name}): 비밀번호는 영문·숫자 4자여야 해요`);
    clean.push({ num, name, pw, line });
  });
  const seenNum = new Map();
  for (const c of clean) {
    if (seenNum.has(c.num)) errors.push(`${c.line}: 번호 ${c.num}이(가) ${seenNum.get(c.num)}과(와) 겹쳐요`);
    seenNum.set(c.num, c.line);
  }
  if (errors.length) return { ok: false, errors };

  // 등록 후 전체 명단에서 비밀번호가 겹치지 않아야 함 (비밀번호만으로 로그인하므로)
  const existing = await sql`SELECT num, name, password FROM students WHERE class_code = ${code}`;
  const finalMap = new Map(existing.map((s) => [s.num, { name: s.name, pw: s.password }]));
  let added = 0, updated = 0;
  for (const c of clean) { finalMap.has(c.num) ? updated++ : added++; finalMap.set(c.num, { name: c.name, pw: c.pw }); }
  const byPw = new Map();
  for (const [num, s] of finalMap) {
    if (byPw.has(s.pw)) errors.push(`비밀번호 "${s.pw}"를 ${byPw.get(s.pw)}번과 ${num}번이 같이 쓰고 있어요. 학생마다 달라야 해요`);
    else byPw.set(s.pw, num);
  }
  if (errors.length) return { ok: false, errors };

  for (const c of clean) {
    await sql`INSERT INTO students (class_code, num, name, password) VALUES (${code}, ${c.num}, ${c.name}, ${c.pw})
              ON CONFLICT (class_code, num) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password`;
  }
  return { ok: true, added, updated };
}

async function remove(t, { num }) {
  const sql = getSql();
  const rows = await sql`SELECT id FROM students WHERE class_code = ${t.classCode} AND num = ${Number(num)}`;
  if (!rows.length) throw new ApiError('그 번호의 학생이 없어요', 404);
  const id = rows[0].id;
  await sql`DELETE FROM answer_logs WHERE student_id = ${id}`;
  await sql`DELETE FROM sessions WHERE student_id = ${id}`;
  await sql`DELETE FROM students WHERE id = ${id}`;
  return { ok: true };
}

async function activity(t, { num }) {
  const sql = getSql();
  const st = await sql`SELECT id, num, name FROM students WHERE class_code = ${t.classCode} AND num = ${Number(num)}`;
  if (!st.length) throw new ApiError('그 번호의 학생이 없어요', 404);
  const id = st[0].id;
  const answers = await sql`SELECT created_at, game_id, kind, prompt, correct FROM answer_logs WHERE student_id = ${id} ORDER BY id DESC LIMIT 300`;
  const games = await sql`SELECT created_at, game_id, mode, p1_name, p2_name, p1_sid, p2_sid, winner, detail
                          FROM game_results WHERE p1_sid = ${id} OR p2_sid = ${id} ORDER BY id DESC LIMIT 50`;
  return {
    student: { num: st[0].num, name: st[0].name },
    answers: answers.map((a) => ({ at: a.created_at, game: a.game_id, kind: a.kind, prompt: a.prompt, correct: a.correct })),
    games: games.map((g) => {
      const mine = g.p1_sid === id ? 'p1' : 'p2';
      const scores = g.detail && g.detail.scores ? g.detail.scores : null;
      if (g.winner === 'coop') { // 협력 게임: 몇 라운드를 해결했는지
        const d = g.detail || {};
        return { at: g.created_at, game: g.game_id, mode: g.mode, opp: g.p2_name, result: 'coop', score: d.total ? `${d.solved}/${d.total} 라운드 해결` : null };
      }
      return {
        at: g.created_at, game: g.game_id, mode: g.mode, opp: mine === 'p1' ? g.p2_name : g.p1_name,
        result: g.winner === 'draw' ? 'draw' : g.winner === mine ? 'win' : 'lose',
        score: scores ? `${scores[mine]} : ${scores[mine === 'p1' ? 'p2' : 'p1']}` : null,
      };
    }),
  };
}

async function report(t) {
  const sql = getSql();
  const wrong = await sql`
    SELECT a.prompt, count(*)::int AS total, count(*) FILTER (WHERE NOT a.correct)::int AS wrong
    FROM answer_logs a JOIN students s ON s.id = a.student_id WHERE s.class_code = ${t.classCode}
    GROUP BY a.prompt HAVING count(*) FILTER (WHERE NOT a.correct) > 0
    ORDER BY wrong DESC, total DESC LIMIT 15`;
  const tot = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE a.correct)::int AS ok_cnt FROM answer_logs a JOIN students s ON s.id = a.student_id WHERE s.class_code = ${t.classCode}`;
  return { wrong, total: tot[0].total, ok: tot[0].ok_cnt };
}

async function exportAll(t) {
  const sql = getSql();
  const rows = await sql`SELECT s.num, s.name, a.created_at, a.game_id, a.kind, a.prompt, a.correct
                         FROM answer_logs a JOIN students s ON s.id = a.student_id
                         WHERE s.class_code = ${t.classCode} ORDER BY s.num, a.id LIMIT 20000`;
  return { rows: rows.map((r) => ({ num: r.num, name: r.name, at: r.created_at, game: r.game_id, kind: r.kind, prompt: r.prompt, correct: r.correct })) };
}

module.exports = { list, upsert, remove, activity, report, exportAll };
