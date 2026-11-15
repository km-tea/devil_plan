'use strict';
// 힌트 문제: 사회 단답식 (알짜 정리 학습지의 빈칸 단어가 정답)
const bank = require('./bank-social').map(([g, s, u, unit, sec, text, answer]) => ({ g, s, u, unit, sec, text, answer }));

const norm = (x) => String(x == null ? '' : x).normalize('NFC').toLowerCase().replace(/[\s·ㆍ.,\-_~]/g, '');

const grades = () => [...new Set(bank.map((b) => b.g))].sort();
const semesters = (g) => [...new Set(bank.filter((b) => b.g === g).map((b) => b.s))].sort();
const pool = (g, s) => bank.map((b, i) => [b, i]).filter(([b]) => b.g === g && (s === 'all' || b.s === Number(s)));

// 사용 가능한 학년·학기 값으로 정리 (잘못된 값이면 기본값)
function cleanScope(grade, semester) {
  const gs = grades();
  const g = gs.includes(Number(grade)) ? Number(grade) : gs[gs.length - 1];
  const s = semester === 'all' || semesters(g).includes(Number(semester)) ? String(semester) : 'all';
  return { grade: g, semester: s };
}

// 같은 판에서 낸 문제는 되도록 반복하지 않음 (used: 은행 번호 목록, 문제를 다 쓰면 처음부터)
function make(settings, used) {
  let p = pool(settings.grade, settings.semester);
  if (!p.length) p = pool(settings.grade, 'all');
  let fresh = p.filter(([, i]) => !used.includes(i));
  if (!fresh.length) { for (const [, i] of p) { const k = used.indexOf(i); if (k >= 0) used.splice(k, 1); } fresh = p; }
  const [b, i] = fresh[Math.floor(Math.random() * fresh.length)];
  used.push(i);
  return { text: b.text, answer: b.answer, label: `${b.g}-${b.s} ${b.u}단원 ${b.unit}`, sec: b.sec };
}

const check = (q, input) => {
  const a = norm(input && input.text);
  return a.length > 0 && a === norm(q.answer);
};

const maxAnswerLen = () => Math.max(...bank.map((b) => b.answer.length));

module.exports = { maxAnswerLen, make, check, cleanScope, grades, semesters, size: bank.length, norm };
