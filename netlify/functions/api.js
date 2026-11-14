'use strict';
const { ensureSchema } = require('./lib/db');
const rooms = require('./lib/rooms');
const { ApiError } = require('./lib/errors');

const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST 요청만 받아요' });
  if ((event.body || '').length > 4000) return reply(413, { error: '요청이 너무 커요' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: '잘못된 요청이에요' }); }
  try {
    await ensureSchema();
    switch (body.action) {
      case 'create': return reply(200, await rooms.create(body));
      case 'join': return reply(200, await rooms.join(body));
      case 'state': return reply(200, await rooms.state(body));
      default: return reply(200, await rooms.act(body));
    }
  } catch (e) {
    if (e instanceof ApiError) return reply(e.status, { error: e.message });
    console.error(e);
    return reply(500, { error: '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요' });
  }
};
