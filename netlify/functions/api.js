'use strict';
const { ensureSchema } = require('./lib/db');
const rooms = require('./lib/rooms');
const auth = require('./lib/auth');
const teacher = require('./lib/teacher');
const cfg = require('./lib/config');
const { ApiError } = require('./lib/errors');

const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const clientIp = (event) => {
  const h = event.headers || {};
  return String(h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim().slice(0, 64);
};

// 로그인한 학생으로 방을 만들거나 입장 (테스트용 ALLOW_GUEST=1 일 때만 이름만으로 입장)
async function who(body) {
  const st = await auth.studentFromToken(body.auth);
  if (st) return { name: st.name, sid: st.id };
  if (cfg.allowGuest()) return { name: body.name, sid: null };
  throw new ApiError('먼저 로그인해 주세요', 401);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST 요청만 받아요' });
  const raw = event.body || '';
  if (raw.length > 100000) return reply(413, { error: '요청이 너무 커요' });
  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { return reply(400, { error: '잘못된 요청이에요' }); }
  if (raw.length > 4000 && body.action !== 'students_upsert') return reply(413, { error: '요청이 너무 커요' });
  try {
    await ensureSchema();
    switch (body.action) {
      // ----- 로그인 -----
      case 'student_login': return reply(200, await auth.studentLogin(body, clientIp(event)));
      case 'teacher_register': return reply(200, await auth.teacherRegister(body, clientIp(event)));
      case 'teacher_login': return reply(200, await auth.teacherLogin(body, clientIp(event)));
      case 'whoami': { const st = await auth.studentFromToken(body.auth); return reply(200, { student: st ? { num: st.num, name: st.name } : null }); }
      case 'logout': await auth.logout(body.auth); await auth.logout(body.tauth); return reply(200, { ok: true });
      // ----- 교사 -----
      case 'students_list': case 'students_upsert': case 'student_delete': case 'student_activity': case 'class_report': case 'activity_export': {
        const t = await auth.requireTeacher(body.tauth);
        const fn = { students_list: teacher.list, students_upsert: teacher.upsert, student_delete: teacher.remove,
          student_activity: teacher.activity, class_report: teacher.report, activity_export: teacher.exportAll }[body.action];
        return reply(200, await fn(t, body));
      }
      // ----- 게임 방 -----
      case 'create': return reply(200, await rooms.create({ ...body, ...(await who(body)) }));
      case 'join': return reply(200, await rooms.join({ ...body, ...(await who(body)) }));
      case 'state': return reply(200, await rooms.state(body));
      default: return reply(200, await rooms.act(body));
    }
  } catch (e) {
    if (e instanceof ApiError) return reply(e.status, { error: e.message });
    console.error(e);
    return reply(500, { error: '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요' });
  }
};
