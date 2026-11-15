/* 교사 탭: 학생 명단(엑셀/붙여넣기 일괄 등록) · 학생별 활동 · 학급 오답 분석 · 엑셀 내려받기
   엑셀 읽기/쓰기는 SheetJS(cdnjs)를 이 탭을 쓸 때만 불러옵니다. 불러오지 못해도 붙여넣기·CSV는 쓸 수 있어요. */
(function () {
  'use strict';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  let ctx, box, h;
  const T = { tab: 'students', students: null, classCode: '', sel: null, act: null, report: null, preview: null, showPw: true, onlyWrong: false, edit: null };

  /* ---------- 공통 ---------- */
  async function call(action, payload) {
    try { return await ctx.api({ action, tauth: ctx.token(), ...(payload || {}) }); }
    catch (e) { if (e.status === 401) { ctx.expired(); throw e; } throw e; }
  }
  const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');
  const GAME = { 'memory-poker': '기억 포커', gyeolhap: '결합' };

  let xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxP) xlsxP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = XLSX_URL;
      s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('x')));
      s.onerror = () => { xlsxP = null; rej(new Error('엑셀 도구를 불러오지 못했어요')); };
      document.head.append(s);
    });
    return xlsxP;
  }
  function saveCsv(name, aoa) {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const blob = new Blob(['\ufeff' + aoa.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- 일괄 등록: 표 → 학생 목록 ---------- */
  // aoa: 2차원 배열(엑셀 시트나 붙여넣은 글). 첫 줄이 '번호/이름/비밀번호' 머리글이면 칸 위치를 거기서 찾는다.
  function parseTable(aoa) {
    const rows = [];
    let ci = { num: 0, name: 1, pw: 2 }, start = 0;
    const head = (aoa[0] || []).map((c) => String(c == null ? '' : c).replace(/\s/g, ''));
    if (head.some((c) => /번호|이름|비밀번호|암호/.test(c))) {
      const f = (re, d) => { const i = head.findIndex((c) => re.test(c)); return i >= 0 ? i : d; };
      ci = { num: f(/번호$|^번$|^no/i, 0), name: f(/이름|성명/, 1), pw: f(/비밀번호|암호|비번/, 2) };
      start = 1;
    }
    for (let i = start; i < aoa.length; i++) {
      const r = aoa[i] || [];
      if (r.every((c) => c == null || String(c).trim() === '')) continue;
      let pw = r[ci.pw];
      pw = pw == null ? '' : String(pw).trim();
      if (/^\d{1,3}$/.test(pw)) pw = pw.padStart(4, '0'); // 엑셀이 0123 을 123 으로 바꾼 경우
      rows.push({ num: String(r[ci.num] == null ? '' : r[ci.num]).trim(), name: String(r[ci.name] == null ? '' : r[ci.name]).trim(), password: pw });
    }
    return rows;
  }
  const parseText = (text) => parseTable(text.split(/\r?\n/).map((l) => l.split(/\t|,/).map((c) => c.trim())));
  const localCheck = (r) => {
    const n = Number(r.num);
    if (!Number.isInteger(n) || n < 1 || n > 999) return '번호 확인';
    if (!r.name) return '이름 없음';
    if (r.name.length > 8) return '이름 8자 초과';
    if (!/^[A-Za-z0-9]{4}$/.test(r.password)) return '비밀번호는 영문·숫자 4자';
    return '';
  };

  async function downloadTemplate() {
    try {
      const X = await loadXlsx();
      const ws = X.utils.aoa_to_sheet([['번호', '이름', '비밀번호'], [1, '홍길동', '1234'], [2, '김철수', 'a2b3']]);
      ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 12 }];
      ['C2', 'C3'].forEach((a) => { ws[a].t = 's'; ws[a].z = '@'; });
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, '학생명단');
      X.writeFile(wb, '학생등록_양식.xlsx');
    } catch (e) { saveCsv('학생등록_양식.csv', [['번호', '이름', '비밀번호'], [1, '홍길동', '1234'], [2, '김철수', 'a2b3']]); ctx.toast('엑셀 도구를 못 불러와 CSV 양식을 받았어요'); }
  }

  async function onFile(file) {
    if (!file) return;
    try {
      let aoa;
      if (/\.csv$/i.test(file.name)) {
        aoa = (await file.text()).replace(/^\ufeff/, '').split(/\r?\n/).map((l) => l.split(','));
      } else {
        const X = await loadXlsx();
        const wb = X.read(await file.arrayBuffer(), { type: 'array' });
        aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }); // raw:false → 보이는 글자 그대로
      }
      const rows = parseTable(aoa);
      if (!rows.length) return ctx.toast('읽을 학생이 없어요. 번호·이름·비밀번호 칸을 확인해 주세요');
      T.preview = { rows, errors: [] }; draw();
    } catch (e) { ctx.toast(e.message || '파일을 읽지 못했어요'); }
  }

  async function register(rows) {
    try {
      const r = await call('students_upsert', { rows: rows.map((x) => ({ num: x.num, name: x.name, password: x.password })) });
      if (!r.ok) { T.preview = { rows, errors: r.errors }; draw(); return false; }
      ctx.toast(`등록했어요: ${r.added}명 추가 · ${r.updated}명 수정`);
      T.preview = null; T.edit = null; await loadStudents(); return true;
    } catch (e) { if (e.status !== 401) ctx.toast(e.message); return false; }
  }

  /* ---------- 데이터 읽기 ---------- */
  async function loadStudents() {
    const r = await call('students_list');
    T.students = r.students; T.classCode = r.classCode; draw();
  }
  async function openActivity(num) {
    T.tab = 'activity'; T.sel = num; T.act = null; draw();
    try { T.act = await call('student_activity', { num }); } catch (e) { if (e.status !== 401) ctx.toast(e.message); }
    draw();
  }
  async function loadReport() {
    try { T.report = await call('class_report'); } catch (e) { if (e.status !== 401) ctx.toast(e.message); }
    draw();
  }
  async function exportAll() {
    try {
      const [{ students }, { rows }] = await Promise.all([call('students_list'), call('activity_export')]);
      const sum = [['번호', '이름', '푼 문제', '맞힌 문제', '정답률', '게임 수', '승', '최근 활동']]
        .concat(students.map((s) => [s.num, s.name, s.total, s.ok, pct(s.ok, s.total), s.games, s.wins, when(s.lastAt)]));
      const log = [['번호', '이름', '시각', '게임', '구분', '문제', '결과']]
        .concat(rows.map((r) => [r.num, r.name, when(r.at), GAME[r.game] || r.game, r.kind, r.prompt, r.correct ? '정답' : '오답']));
      const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      try {
        const X = await loadXlsx();
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sum), '학생별 요약');
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(log), '문제 풀이 기록');
        X.writeFile(wb, `학습기록_${day}.xlsx`);
      } catch (e) { saveCsv(`학습기록_${day}.csv`, log); ctx.toast('엑셀 도구를 못 불러와 CSV로 받았어요'); }
    } catch (e) { if (e.status !== 401) ctx.toast(e.message); }
  }

  /* ---------- 화면 조각 ---------- */
  const th = (...c) => h('tr', {}, c.map((x) => h('th', {}, x)));
  const td = (...c) => h('tr', {}, c.map((x) => (x instanceof Node ? x : h('td', {}, x))));

  function registerPanel() {
    let ta, fnum, fname, fpw;
    const edit = T.edit;
    const saveOne = async () => {
      const row = { num: fnum.value.trim(), name: fname.value.trim(), password: fpw.value.trim() };
      const bad = localCheck(row);
      if (bad) return ctx.toast(bad);
      if (await register([row])) { /* register 가 다시 그려 줌 */ }
    };
    const preview = () => {
      const rows = parseText(ta.value);
      if (!rows.length) return ctx.toast('붙여넣은 내용에서 학생을 찾지 못했어요');
      T.preview = { rows, errors: [] }; draw();
    };
    const p = T.preview;
    return h('section', { class: 'tpanel' },
      h('h3', {}, '학생 등록'),
      h('div', { class: 'trow' },
        h('button', { class: 'ghost', onclick: downloadTemplate }, '⬇ 엑셀 양식 받기'),
        h('label', { class: 'ghost filebtn' }, '📂 엑셀/CSV 올리기',
          h('input', { type: 'file', accept: '.xlsx,.xls,.csv', hidden: true, onchange: (e) => { onFile(e.target.files[0]); e.target.value = ''; } }))),
      h('p', { class: 'hintline left' }, '양식: 번호 · 이름 · 비밀번호(영문·숫자 4자, 학생마다 달라야 해요). 같은 번호를 다시 올리면 이름·비밀번호가 수정돼요.'),
      h('details', {}, h('summary', {}, '엑셀에서 복사해서 붙여넣기'),
        ta = h('textarea', { rows: 5, placeholder: '번호\t이름\t비밀번호\n1\t홍길동\t1234\n2\t김철수\ta2b3' }),
        h('button', { class: 'ghost', onclick: preview }, '미리보기')),
      h('div', { class: 'trow form' },
        fnum = h('input', { placeholder: '번호', inputmode: 'numeric', value: edit ? edit.num : '', style: 'width:5em' }),
        fname = h('input', { placeholder: '이름', maxlength: 8, value: edit ? edit.name : '', style: 'width:8em' }),
        fpw = h('input', { placeholder: '비밀번호 4자', maxlength: 4, value: edit ? edit.password : '', style: 'width:8em', autocomplete: 'off' }),
        h('button', { class: 'primary small', onclick: saveOne }, edit ? '수정 저장' : '한 명 추가'),
        edit ? h('button', { class: 'ghost small', onclick: () => { T.edit = null; draw(); } }, '취소') : null),
      p ? h('div', { class: 'preview' },
        h('h4', {}, `등록 미리보기 (${p.rows.length}명)`),
        p.errors.length ? h('div', { class: 'errbox' }, h('b', {}, '등록하지 못했어요. 아래를 고쳐 다시 올려 주세요'), h('ul', {}, p.errors.map((e) => h('li', {}, e)))) : null,
        h('div', { class: 'tscroll' }, h('table', { class: 'tbl' }, h('thead', {}, th('번호', '이름', '비밀번호', '확인')),
          h('tbody', {}, p.rows.map((r) => { const m = localCheck(r); return h('tr', { class: m ? 'bad' : '' }, h('td', {}, r.num), h('td', {}, r.name), h('td', {}, r.password), h('td', {}, m || '✔')); })))),
        h('div', { class: 'trow' },
          h('button', { class: 'primary small', disabled: p.rows.some((r) => localCheck(r)), onclick: () => register(p.rows) }, `${p.rows.length}명 등록하기`),
          h('button', { class: 'ghost small', onclick: () => { T.preview = null; draw(); } }, '취소'))) : null);
  }

  function studentsTab() {
    const list = T.students;
    return h('div', {}, registerPanel(),
      h('section', { class: 'tpanel' },
        h('div', { class: 'trow between' }, h('h3', {}, `학급 명단 ${list ? `(${list.length}명)` : ''}`),
          h('div', { class: 'trow' },
            h('button', { class: 'ghost small', onclick: () => { T.showPw = !T.showPw; draw(); } }, T.showPw ? '비밀번호 가리기' : '비밀번호 보기'),
            h('button', { class: 'ghost small', onclick: exportAll }, '⬇ 활동 기록 엑셀'))),
        h('p', { class: 'hintline left' }, `학급 코드: ${T.classCode || '…'} · 학생은 학급 코드와 자기 비밀번호로 로그인해요.`),
        !list ? h('p', {}, '불러오는 중…') : !list.length ? h('p', { class: 'hintline left' }, '아직 등록된 학생이 없어요. 위에서 엑셀로 올려 보세요.') :
          h('div', { class: 'tscroll' }, h('table', { class: 'tbl' },
            h('thead', {}, th('번호', '이름', '비밀번호', '푼 문제', '정답률', '게임(승/전체)', '최근 활동', '')),
            h('tbody', {}, list.map((s) => h('tr', {},
              h('td', {}, s.num), h('td', {}, s.name), h('td', { class: 'mono' }, T.showPw ? s.password : '••••'),
              h('td', {}, s.total), h('td', {}, pct(s.ok, s.total)), h('td', {}, `${s.wins}/${s.games}`), h('td', {}, when(s.lastAt)),
              h('td', { class: 'acts' },
                h('button', { class: 'ghost small', onclick: () => openActivity(s.num) }, '기록'),
                h('button', { class: 'ghost small', onclick: () => { T.edit = { num: s.num, name: s.name, password: s.password }; draw(); window.scrollTo(0, 0); } }, '수정'),
                h('button', { class: 'ghost small danger', onclick: async () => {
                  if (!confirm(`${s.num}번 ${s.name} 학생과 그 학생의 문제 풀이 기록을 삭제할까요?`)) return;
                  try { await call('student_delete', { num: s.num }); ctx.toast('삭제했어요'); loadStudents(); } catch (e) { if (e.status !== 401) ctx.toast(e.message); }
                } }, '삭제')))))))));
  }

  function activityTab() {
    const list = T.students || [];
    const sel = h('select', { onchange: (e) => { if (e.target.value) openActivity(Number(e.target.value)); } },
      h('option', { value: '' }, '학생을 고르세요'), list.map((s) => h('option', { value: s.num, selected: s.num === T.sel }, `${s.num}번 ${s.name}`)));
    const a = T.act;
    let body = h('p', { class: 'hintline left' }, T.sel ? '불러오는 중…' : '학생을 고르면 최근 문제 풀이와 게임 결과가 보여요.');
    if (a) {
      const ans = T.onlyWrong ? a.answers.filter((x) => !x.correct) : a.answers;
      const ok = a.answers.filter((x) => x.correct).length;
      body = h('div', {},
        h('p', { class: 'sumline' }, `${a.student.num}번 ${a.student.name} · 최근 ${a.answers.length}문제 중 ${ok}개 정답 (${pct(ok, a.answers.length)})`),
        h('h4', {}, '게임 결과'),
        a.games.length ? h('div', { class: 'tscroll' }, h('table', { class: 'tbl' }, h('thead', {}, th('시각', '게임', '상대', '결과', '점수')),
          h('tbody', {}, a.games.map((g) => h('tr', {}, h('td', {}, when(g.at)), h('td', {}, (GAME[g.game] || g.game) + (g.mode === 'cpu' ? ' (컴퓨터)' : '')), h('td', {}, g.opp),
            h('td', {}, g.result === 'win' ? '승' : g.result === 'lose' ? '패' : '무'), h('td', {}, g.score || '-')))))) : h('p', { class: 'hintline left' }, '아직 끝난 게임이 없어요.'),
        h('h4', {}, '문제 풀이 기록'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: T.onlyWrong, onchange: (e) => { T.onlyWrong = e.target.checked; draw(); } }), ' 오답만 보기'),
        ans.length ? h('div', { class: 'tscroll' }, h('table', { class: 'tbl' }, h('thead', {}, th('시각', '게임', '문제', '결과')),
          h('tbody', {}, ans.map((x) => h('tr', { class: x.correct ? '' : 'bad' }, h('td', {}, when(x.at)), h('td', {}, GAME[x.game] || x.game), h('td', { class: 'prompt' }, x.prompt), h('td', {}, x.correct ? '정답' : '오답')))))) : h('p', { class: 'hintline left' }, '기록이 없어요.'));
    }
    return h('section', { class: 'tpanel' }, h('div', { class: 'trow' }, h('h3', {}, '학생별 활동'), sel), body);
  }

  function reportTab() {
    const r = T.report;
    return h('section', { class: 'tpanel' },
      h('div', { class: 'trow between' }, h('h3', {}, '학급 오답 분석'), h('button', { class: 'ghost small', onclick: loadReport }, '새로고침')),
      !r ? h('p', {}, '불러오는 중…') : h('div', {},
        h('p', { class: 'sumline' }, `학급 전체 문제 풀이 ${r.total}개 중 ${r.ok}개 정답 (${pct(r.ok, r.total)})`),
        r.wrong.length ? h('div', { class: 'tscroll' }, h('table', { class: 'tbl' }, h('thead', {}, th('틀린 횟수', '푼 횟수', '문제')),
          h('tbody', {}, r.wrong.map((x) => h('tr', {}, h('td', {}, x.wrong), h('td', {}, x.total), h('td', { class: 'prompt' }, x.prompt)))))) : h('p', { class: 'hintline left' }, '아직 오답 기록이 없어요.')));
  }

  function draw() {
    if (!box) return;
    const tabs = [['students', '학생 명단·등록'], ['activity', '학생별 활동'], ['report', '오답 분석']];
    box.replaceChildren(
      h('header', { class: 'thead' },
        h('h2', {}, '👩‍🏫 교사 메뉴'),
        h('div', { class: 'trow' }, h('button', { class: 'ghost small', onclick: ctx.back }, '← 학생 화면'), h('button', { class: 'ghost small', onclick: ctx.logout }, '로그아웃'))),
      h('nav', { class: 'ttabs' }, tabs.map(([k, label]) => h('button', { class: T.tab === k ? 'on' : '', onclick: () => {
        T.tab = k; if (k === 'report') { T.report = null; loadReport(); } draw();
      } }, label))),
      T.tab === 'students' ? studentsTab() : T.tab === 'activity' ? activityTab() : reportTab());
  }

  function mount(el, c) {
    box = el; ctx = c; h = c.h;
    T.preview = null; T.edit = null;
    draw();
    loadStudents().catch(() => {});
  }

  window.App.teacher = { mount };
})();
