'use strict';
// 학생·교사 로그인. 로그인하면 임시 열쇠(token)를 주고, DB에는 열쇠의 해시만 저장한다.
// 교사는 처음 접속할 때 자기 아이디·비밀번호·학급 코드를 직접 정해 등록한다(teacherRegister).
const crypto = require('crypto');
const { getSql } = require('./db');
const { ApiError } = require('./errors');

const STUDENT_HOURS = 12;
const TEACHER_HOURS = 8;
const LIMITS = { student: 60, teacher: 10, signup: 10 }; // 10분 동안 같은 와이파이(IP)에서 허용하는 횟수

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// 교사 비밀번호는 소금(salt)을 섞어 scrypt 로 저장
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); };
const checkPw = (pw, stored) => {
  const [salt, hash] = String(stored || ':').split(':');
  const a = crypto.scryptSync(String(pw), salt || 'x', 32), b = Buffer.from(hash || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const DUMMY = hashPw('dummy-password');

// 학생 비밀번호: 영문 소문자/숫자 4자 (대소문자 구분 없이 쓰도록 소문자로 통일)
const normPw = (p) => String(p == null ? '' : p).trim().toLowerCase();
const validPw = (p) => /^[a-z0-9]{4}$/.test(p);
// 교사 아이디 / 학급 코드 (소문자로 통일)
const normId = (s) => String(s == null ? '' : s).trim().toLowerCase();
const validId = (s) => /^[a-z0-9_.-]{3,20}$/.test(s);
const normCode = (s) => String(s == null ? '' : s).trim().toLowerCase();
const validCode = (s) => /^[a-z0-9]{4,10}$/.test(s);

async function limited(ip, role) {
  const rows = await getSql()`SELECT count(*)::int AS n FROM login_attempts WHERE ip = ${ip} AND role = ${role} AND at > now() - interval '10 minutes'`;
  if (rows[0].n >= LIMITS[role]) throw new ApiError('시도가 너무 많아요. 10분 뒤에 다시 해 주세요', 429);
}
const record = (ip, role) => getSql()`INSERT INTO login_attempts (ip, role) VALUES (${ip}, ${role})`;
async function fail(ip, role, msg) { await record(ip, role); throw new ApiError(msg, 401); }

async function newSession(role, refId, hours) {
  const sql = getSql();
  const token = crypto.randomBytes(24).toString('hex');
  if (Math.random() < 0.05) {
    await sql`DELETE FROM sessions WHERE expires_at < now()`;
    await sql`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`;
  }
  await sql`INSERT INTO sessions (token_hash, role, student_id, expires_at)
            VALUES (${sha(token)}, ${role}, ${refId}, now() + ${hours + ' hours'}::interval)`;
  return token;
}

async function studentLogin({ code, password }, ip) {
  await limited(ip, 'student');
  const c = normCode(code), pw = normPw(password);
  if (!validCode(c) || !validPw(pw)) return fail(ip, 'student', '학급 코드나 비밀번호가 맞지 않아요');
  const rows = await getSql()`SELECT id, num, name FROM students WHERE class_code = ${c} AND password = ${pw} ORDER BY num LIMIT 1`;
  if (!rows.length) return fail(ip, 'student', '학급 코드나 비밀번호가 맞지 않아요');
  const token = await newSession('student', rows[0].id, STUDENT_HOURS);
  return { token, student: { num: rows[0].num, name: rows[0].name } };
}

// 교사 처음 등록: 아이디 + 비밀번호 + 학급 코드를 직접 정한다 (이미 쓰는 아이디·학급 코드는 불가)
async function teacherRegister({ id, password, code }, ip) {
  await limited(ip, 'signup');
  await record(ip, 'signup');
  const tid = normId(id), c = normCode(code), pw = String(password == null ? '' : password);
  if (!validId(tid)) throw new ApiError('아이디는 영문·숫자(그리고 _ . -) 3~20자로 만들어 주세요');
  if (pw.length < 6 || pw.length > 50) throw new ApiError('비밀번호는 6자 이상으로 정해 주세요');
  if (!validCode(c)) throw new ApiError('학급 코드는 영문·숫자 4~10자로 정해 주세요 (예: 6200)');
  const sql = getSql();
  if ((await sql`SELECT id FROM teachers WHERE teacher_id = ${tid}`).length) throw new ApiError('이미 사용 중인 아이디예요', 409);
  if ((await sql`SELECT id FROM teachers WHERE class_code = ${c}`).length) throw new ApiError('다른 선생님이 쓰고 있는 학급 코드예요. 다른 코드를 정해 주세요', 409);
  let row;
  try {
    row = await sql`INSERT INTO teachers (teacher_id, pw, class_code) VALUES (${tid}, ${hashPw(pw)}, ${c}) RETURNING id`;
  } catch (e) { throw new ApiError('이미 사용 중인 아이디 또는 학급 코드예요', 409); }
  return { token: await newSession('teacher', row[0].id, TEACHER_HOURS), teacher: { id: tid, code: c } };
}

async function teacherLogin({ id, password }, ip) {
  await limited(ip, 'teacher');
  const tid = normId(id);
  const rows = await getSql()`SELECT id, teacher_id, pw, class_code FROM teachers WHERE teacher_id = ${tid}`;
  const ok = checkPw(password, rows.length ? rows[0].pw : DUMMY) && rows.length > 0;
  if (!ok) return fail(ip, 'teacher', '아이디나 비밀번호가 맞지 않아요');
  return { token: await newSession('teacher', rows[0].id, TEACHER_HOURS), teacher: { id: rows[0].teacher_id, code: rows[0].class_code } };
}

async function getSession(token, role) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const rows = await getSql()`SELECT role, student_id FROM sessions WHERE token_hash = ${sha(token)} AND expires_at > now()`;
  return rows.length && rows[0].role === role ? rows[0] : null;
}

// 로그인한 학생 정보 (없으면 null)
async function studentFromToken(token) {
  const s = await getSession(token, 'student');
  if (!s) return null;
  const rows = await getSql()`SELECT id, num, name FROM students WHERE id = ${s.student_id}`;
  return rows.length ? rows[0] : null;
}

// 로그인한 교사 { id, teacherId, classCode } — 없으면 401
async function requireTeacher(token) {
  const s = await getSession(token, 'teacher');
  const rows = s ? await getSql()`SELECT id, teacher_id, class_code FROM teachers WHERE id = ${s.student_id}` : [];
  if (!rows.length) throw new ApiError('교사 로그인이 필요해요', 401);
  return { id: rows[0].id, teacherId: rows[0].teacher_id, classCode: rows[0].class_code };
}

async function logout(token) {
  if (token && typeof token === 'string') await getSql()`DELETE FROM sessions WHERE token_hash = ${sha(token)}`;
}

module.exports = { studentLogin, teacherRegister, teacherLogin, studentFromToken, requireTeacher, logout, normPw, validPw };
