(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const R = (ER.reports = {});
  const { h, clear } = ER.util;
  const U = ER.util, M = ER.model, CSV = ER.csv, A = ER.auth;

  const state = { view: 'list', tab: 'resource', type: '', rFaculty: '', res: '', q: '', noRes: false, room: '', teacher: '', year: '', faculty: '', subject: '', fType: '', fFaculty: '', fDay: '', fPeriod: '', fWeek: 'A' };
  let outEl = null;
  let current = null;

  const TABS = [
    ['resource', 'By resource'],
    ['class', 'By class'],
    ['year', 'By year group'],
    ['subject', 'By subject / faculty'],
    ['room', 'By room'],
    ['teacher', 'By teacher'],
    ['free', 'Free resources finder'],
  ];

  const weekLabel = (w) => (w === 'AB' ? 'A+B' : w);
  const slotCmp = (a, b) =>
    U.DAYS.indexOf(a.day) - U.DAYS.indexOf(b.day) || U.natCmp(a.pkey, b.pkey) || U.natCmp(a.week, b.week);
  const resNames = (c) => M.resourcesOfClass(c.key).filter((x) => x.res).map((x) => x.res.name).join(', ');

  // ---------- report builders: each returns { title, sections:[{title?, columns, rows, flag?}] } ----------
  function resourceReport() {
    const items = [...M.resByKey.values()].filter((r) => (!state.type || r.typeId === state.type) && (!state.rFaculty || r.faculty === state.rFaculty))
      .sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name));
    const total = Math.max(1, M.days.length * M.periods.length * 2);

    if (state.res) {
      const r = M.resByKey.get(state.res);
      if (!r) return { title: 'Resource usage', sections: [] };
      const rows = (M.allocsByRes.get(r.key) || [])
        .map((a) => ({ a, c: M.classByKey.get(a.classKey) })).filter((x) => x.c)
        .sort((x, y) => slotCmp(x.c, y.c))
        .map(({ a, c }) => [c.day, c.period, weekLabel(c.week), c.name, c.room, c.teacher, a.by || '']);
      return {
        title: `${r.name} (${r.typeName})`,
        subtitle: `${rows.length} allocation(s)` + (r.faculty ? ` · ${r.faculty}` : '') + (r.location ? ` · stored in ${r.location}` : ''),
        sections: [{ columns: ['Day', 'Period', 'Week', 'Class', 'Room', 'Teacher', 'Allocated by'], rows }],
      };
    }
    const rows = items.map((r) => {
      const slots = new Set();
      for (const a of M.allocsByRes.get(r.key) || []) { const c = M.classByKey.get(a.classKey); if (c) M.slotsOf(c).forEach((s) => slots.add(s)); }
      const row = [r.name, r.typeName, r.faculty, r.location, String(slots.size), String(Math.max(0, total - slots.size)), Math.round((slots.size / total) * 100) + '%'];
      return M.resFaculties.length ? row : row.filter((_, i) => i !== 2);
    });
    const cols = ['Resource', 'Type', 'Faculty', 'Location', 'Slots used', 'Slots free', 'Utilisation'].filter((c) => c !== 'Faculty' || M.resFaculties.length);
    return {
      title: state.rFaculty ? `Resource usage summary: ${state.rFaculty}` : 'Resource usage summary',
      subtitle: `${rows.length} resource(s). Utilisation is slots used out of ${total} (days × periods × weeks A/B).`,
      sections: [{ columns: cols, rows }],
    };
  }

  function classReport(by) {
    let list = M.classes.slice();
    let title = 'Classes and their resources';
    if (by === 'room') { if (state.room) { list = list.filter((c) => c.room === state.room); title = `Room ${state.room}`; } else title = 'All rooms'; }
    if (by === 'teacher') { if (state.teacher) { list = list.filter((c) => c.teacher === state.teacher); title = state.teacher; } else title = 'All teachers'; }
    if (by === 'year') { if (state.year) { list = list.filter((c) => c.year === state.year); title = state.year; } else title = 'All year groups'; }
    if (by === 'subject') {
      if (state.faculty) list = list.filter((c) => c.faculty === state.faculty);
      if (state.subject) list = list.filter((c) => c.subject === state.subject);
      title = state.subject ? (state.faculty ? `${state.faculty}: ${state.subject}` : state.subject) : state.faculty ? `${state.faculty} faculty` : 'All subjects';
    }
    if (by === 'class') {
      const q = U.norm(state.q);
      if (q) list = list.filter((c) => U.norm(c.name).includes(q));
      if (state.noRes) list = list.filter((c) => !(M.allocsByClass.get(c.key) || []).length);
    }
    const yearCmp = (a, b) => (a.year ? 0 : 1) - (b.year ? 0 : 1) || U.yearCmp(a.year || '', b.year || '');
    const sorter = by === 'room' ? (a, b) => U.natCmp(a.room, b.room) || slotCmp(a, b)
      : by === 'teacher' ? (a, b) => U.natCmp(a.teacher, b.teacher) || slotCmp(a, b)
        : by === 'year' ? (a, b) => yearCmp(a, b) || U.natCmp(a.name, b.name) || slotCmp(a, b)
          : by === 'subject' ? (a, b) => U.natCmp(a.faculty || '', b.faculty || '') || U.natCmp(a.subject || '', b.subject || '') || U.natCmp(a.name, b.name) || slotCmp(a, b)
            : (a, b) => U.natCmp(a.name, b.name) || slotCmp(a, b);
    list.sort(sorter);
    // Year / Faculty / Subject columns only appear when the classes have them
    const value = { Class: (c) => c.name, Year: (c) => c.year || '', Faculty: (c) => c.faculty || '', Subject: (c) => c.subject || '', Day: (c) => c.day, Period: (c) => c.period,
      Week: (c) => weekLabel(c.week), Room: (c) => c.room, Teacher: (c) => c.teacher, Resources: resNames };
    const order = { class: ['Class', 'Year', 'Subject', 'Day', 'Period', 'Week', 'Room', 'Teacher', 'Resources'],
      room: ['Room', 'Day', 'Period', 'Week', 'Class', 'Year', 'Subject', 'Teacher', 'Resources'],
      teacher: ['Teacher', 'Day', 'Period', 'Week', 'Class', 'Year', 'Subject', 'Room', 'Resources'],
      year: ['Year', 'Class', 'Subject', 'Day', 'Period', 'Week', 'Room', 'Teacher', 'Resources'],
      subject: ['Faculty', 'Subject', 'Class', 'Year', 'Day', 'Period', 'Week', 'Room', 'Teacher', 'Resources'] };
    const has = { Year: M.years.length, Faculty: M.faculties.length, Subject: M.subjects.length };
    const cols = order[by].filter((c) => !(c in has) || has[c]);
    const rows = list.map((c) => cols.map((col) => value[col](c)));
    const sections = [{ title: by === 'subject' ? 'Class slots' : undefined, columns: cols, rows }];

    // for a subject/faculty report, also total up which resources its classes use
    if (by === 'subject') {
      const use = new Map();
      for (const c of list) for (const { res } of M.resourcesOfClass(c.key)) {
        if (!res) continue;
        const u = use.get(res.key) || { res, slots: 0, classes: 0 };
        u.slots += M.slotsOf(c).length; u.classes++;
        use.set(res.key, u);
      }
      const rrows = [...use.values()].sort((a, b) => b.slots - a.slots || U.natCmp(a.res.name, b.res.name))
        .map(({ res, slots, classes }) => [res.name, res.typeName, res.faculty || '', String(classes), String(slots)]);
      const rcols = ['Resource', 'Type', 'Owned by faculty', 'Classes', 'Slots used'].filter((c) => c !== 'Owned by faculty' || M.resFaculties.length);
      sections.push({ title: 'Resources used by these classes', columns: rcols, rows: M.resFaculties.length ? rrows : rrows.map((r) => r.filter((_, i) => i !== 2)) });
    }
    return { title, subtitle: `${rows.length} class slot(s)`, sections };
  }

  function freeReport() {
    if (!state.fDay || !state.fPeriod) return { title: 'Free resources finder', subtitle: 'Choose a day, period and week.', sections: [] };
    const slot = `${state.fDay}|${state.fPeriod}|${state.fWeek}`;
    const occupied = new Set();
    for (const a of M.allocs) {
      if (a.orphan) continue;
      const c = M.classByKey.get(a.classKey);
      if (c && M.slotsOf(c).includes(slot)) occupied.add(a.resKey);
    }
    const free = [...M.resByKey.values()].filter((r) => (!state.fType || r.typeId === state.fType) && (!state.fFaculty || r.faculty === state.fFaculty) && !occupied.has(r.key))
      .sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name))
      .map((r) => (M.resFaculties.length ? [r.name, r.typeName, r.faculty, r.location] : [r.name, r.typeName, r.location]));
    const inSlot = M.classes.filter((c) => M.slotsOf(c).includes(slot));
    const classRows = inSlot.map((c) => {
      const mine = M.resourcesOfClass(c.key).filter((x) => x.res && (!state.fType || x.res.typeId === state.fType));
      return { c, text: mine.map((x) => x.res.name).join(', ') };
    }).sort((a, b) => (a.text ? 1 : 0) - (b.text ? 1 : 0) || U.natCmp(a.c.name, b.c.name))
      .map(({ c, text }) => [c.name, c.room, c.teacher, text || '— none —']);
    const p = M.periods.find((x) => x.pkey === state.fPeriod);
    const typeName = state.fType ? (M.types.find((t) => t.id === state.fType) || {}).name : 'all resources';
    return {
      title: `Free at ${state.fDay} ${p ? p.label : ''}, Week ${state.fWeek}`,
      subtitle: `${free.length} free (${typeName}${state.fFaculty ? ', ' + state.fFaculty : ''}) · ${inSlot.length} class(es) running`,
      sections: [
        { title: 'Free resources', columns: M.resFaculties.length ? ['Resource', 'Type', 'Faculty', 'Location'] : ['Resource', 'Type', 'Location'], rows: free },
        { title: 'Classes running in this slot', columns: ['Class', 'Room', 'Teacher', state.fType ? 'Resources of this type' : 'Resources'], rows: classRows },
      ],
    };
  }

  // ---------- timetable (grid) reports ----------
  // A "sheet" is one entity (a resource, room, teacher or class) shown as Period x Day grids for weeks A and B.
  const MAX_CLASS_SHEETS = 60;
  function makeSheet(title, subtitle, classes, mode) {
    const items = classes.map((c) => {
      const res = M.resourcesOfClass(c.key).map((x) => x.res).filter(Boolean);
      if (mode === 'resource') return { c, l1: c.name, l2: [c.room, c.teacher].filter(Boolean).join(' · '), res: [] };
      if (mode === 'room') return { c, l1: c.name, l2: c.teacher, res };
      if (mode === 'teacher') return { c, l1: c.name, l2: c.room, res };
      return { c, l1: c.name, l2: [c.room, c.teacher].filter(Boolean).join(' · '), res };
    });
    return { title, subtitle, items };
  }

  function timetableReport() {
    const tab = state.tab;
    const sheets = [];
    let title = 'Timetables', note = '';
    if (tab === 'resource') {
      const list = [...M.resByKey.values()].filter((r) => (!state.type || r.typeId === state.type) && (!state.rFaculty || r.faculty === state.rFaculty) && (!state.res || r.key === state.res))
        .sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name));
      for (const r of list) {
        const classes = (M.allocsByRes.get(r.key) || []).map((a) => M.classByKey.get(a.classKey)).filter(Boolean);
        if (!state.res && !classes.length) continue;
        sheets.push(makeSheet(r.name, r.typeName + (r.location ? ' · ' + r.location : ''), classes, 'resource'));
      }
      title = state.res && sheets[0] ? `${sheets[0].title} — timetable` : 'Resource timetables';
      note = state.res ? '' : `${sheets.length} resource(s) with bookings, one page each when printed.`;
    } else if (tab === 'subject') {
      // one timetable per subject (or per faculty when the classes only have a faculty)
      const pool = M.classes.filter((c) => (!state.faculty || c.faculty === state.faculty) && (!state.subject || c.subject === state.subject));
      const bySubject = M.subjects.length > 0;
      const keys = [...new Set(pool.map((c) => (bySubject ? c.subject : c.faculty) || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || U.natCmp(a, b));
      for (const k of keys) {
        const members = pool.filter((c) => ((bySubject ? c.subject : c.faculty) || '') === k);
        const facs = [...new Set(members.map((c) => c.faculty).filter(Boolean))];
        sheets.push(makeSheet(k || (bySubject ? 'No subject' : 'No faculty'), bySubject && facs.length ? facs.join(' · ') : '', members, 'class'));
      }
      title = state.subject ? `${state.subject} — timetable` : state.faculty ? `${state.faculty} — timetables` : bySubject ? 'Subject timetables' : 'Faculty timetables';
      note = sheets.length === 1 ? '' : `${sheets.length} ${bySubject ? 'subject(s)' : 'faculty(ies)'}, one page each when printed.`;
    } else if (tab === 'room') {
      for (const room of state.room ? [state.room] : M.rooms) sheets.push(makeSheet('Room ' + room, '', M.classes.filter((c) => c.room === room), 'room'));
      title = state.room ? `Room ${state.room} — timetable` : 'Room timetables';
      note = state.room ? '' : `${sheets.length} room(s), one page each when printed.`;
    } else if (tab === 'teacher') {
      for (const t of state.teacher ? [state.teacher] : M.teachers) sheets.push(makeSheet(t, '', M.classes.filter((c) => c.teacher === t), 'teacher'));
      title = state.teacher ? `${state.teacher} — timetable` : 'Teacher timetables';
      note = state.teacher ? '' : `${sheets.length} teacher(s), one page each when printed.`;
    } else if (tab === 'year') {
      const years = state.year ? [state.year] : M.years;
      for (const y of years) sheets.push(makeSheet(y, '', M.classes.filter((c) => c.year === y), 'class'));
      const none = M.classes.filter((c) => !c.year);
      if (!state.year && none.length && M.years.length) sheets.push(makeSheet('No year group', '', none, 'class'));
      sheets.forEach((s) => { s.hideYear = true; });
      title = state.year ? `${state.year} — timetable` : 'Year group timetables';
      note = state.year ? '' : `${sheets.length} year group(s), one page each when printed.`;
    } else if (tab === 'class') {
      const q = U.norm(state.q);
      const names = [...new Set(M.classes.map((c) => c.name))].filter((n) => !q || U.norm(n).includes(q)).sort(U.natCmp);
      title = 'Class timetables';
      if (names.length > MAX_CLASS_SHEETS) {
        return { kind: 'timetable', title, subtitle: `${names.length} classes match. Type part of a class name to narrow it to ${MAX_CLASS_SHEETS} or fewer.`, sheets: [] };
      }
      for (const n of names) {
        const classes = M.classes.filter((c) => c.name === n && (!state.noRes || !(M.allocsByClass.get(c.key) || []).length));
        if (classes.length) sheets.push(makeSheet(n, '', classes, 'class'));
      }
      note = `${sheets.length} class(es), one page each when printed.`;
    }
    return { kind: 'timetable', title, subtitle: note, sheets };
  }

  function sheetDom(sheet) {
    const days = M.days, periods = M.periods;
    const wrap = h('section', { class: 'tt-sheet' + (sheet.big ? ' tt-big' : '') },
      h('header', { class: 'tt-head' }, h('div', null, h('h2', null, sheet.title), sheet.subtitle ? h('p', { class: 'muted' }, sheet.subtitle) : null),
        h('div', { class: 'tt-meta' }, h('strong', null, 'EduResourcer'), h('span', null, new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })))));
    for (const wk of sheet.weeks || ['A', 'B']) {
      const cellItems = new Map();
      for (const it of sheet.items) {
        if (it.c.week !== 'AB' && it.c.week !== wk) continue;
        const k = it.c.day + '|' + it.c.pkey;
        if (!cellItems.has(k)) cellItems.set(k, []);
        cellItems.get(k).push(it);
      }
      const count = [...cellItems.values()].reduce((n, l) => n + l.length, 0);
      const rows = periods.map((p) => h('tr', null,
        h('th', { class: 'tt-p', scope: 'row' }, h('small', null, 'Period'), h('strong', null, p.label)),
        days.map((d) => {
          const list = (cellItems.get(d + '|' + p.pkey) || []).sort((a, b) => U.natCmp(a.l1, b.l1));
          return h('td', { class: 'tt-cell' + (list.length ? ' has' : '') }, list.map((it) => h('div', { class: 'tt-entry' },
            h('strong', null, it.l1, it.c.year && !sheet.hideYear ? h('span', { class: 'tt-yr' }, U.yearShort(it.c.year)) : null),
            it.l2 ? h('span', { class: 'tt-l2' }, it.l2) : null,
            it.res.length ? h('div', { class: 'tt-chips' }, it.res.map((r) => h('span', { class: 'tt-chip', dataset: { t: String(M.typeColour(r.typeId)) } }, r.name))) : null)));
        })));
      wrap.appendChild(h('div', { class: 'tt-week' },
        h('h3', null, 'Week ' + wk, h('span', { class: 'muted' }, `  ·  ${count} lesson${count === 1 ? '' : 's'}`)),
        h('table', { class: 'tt' },
          h('thead', null, h('tr', null, h('th', { class: 'tt-corner' }, ''), days.map((d) => h('th', null, d)))),
          h('tbody', null, rows))));
    }
    return wrap;
  }

  const BUILD = { resource: resourceReport, class: () => classReport('class'), year: () => classReport('year'), subject: () => classReport('subject'), room: () => classReport('room'), teacher: () => classReport('teacher'), free: freeReport };

  // ---------- rendering ----------
  function resultDom(rep) {
    if (rep.kind === 'timetable') {
      const wrap = h('div', { class: 'rep tt-wrap' }, h('div', { class: 'tt-intro' }, h('h2', null, rep.title), rep.subtitle ? h('p', { class: 'muted rep-sub' }, rep.subtitle) : null));
      if (!rep.sheets.length) wrap.appendChild(h('p', { class: 'empty-note' }, 'Nothing to show.'));
      rep.sheets.forEach((s) => wrap.appendChild(sheetDom(s)));
      return wrap;
    }
    const wrap = h('div', { class: 'rep' },
      h('h2', null, rep.title), rep.subtitle ? h('p', { class: 'muted rep-sub' }, rep.subtitle) : null);
    for (const s of rep.sections) {
      if (s.title) wrap.appendChild(h('h3', { class: 'sec' }, s.title, h('span', { class: 'muted' }, `  (${s.rows.length})`)));
      if (!s.rows.length) { wrap.appendChild(h('p', { class: 'empty-note' }, 'Nothing to show.')); continue; }
      wrap.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, s.columns.map((c) => h('th', null, c)))),
        h('tbody', null, s.rows.map((r) => h('tr', null, r.map((c) => h('td', { class: c === '— none —' ? 'none' : null }, c))))))));
    }
    return wrap;
  }

  function run() {
    if (!outEl) return;
    current = state.view === 'timetable' && state.tab !== 'free' ? timetableReport() : BUILD[state.tab]();
    clear(outEl);
    outEl.appendChild(resultDom(current));
  }
  R.rerun = run;

  const denyExport = () => {
    if (A.canExport()) return false;
    U.toast('Read-only accounts cannot export or print.', 'error');
    return true;
  };

  function exportCsv() {
    if (!current || denyExport()) return;
    const lines = [[current.title]];
    if (current.kind === 'timetable') {
      lines.push([], ['Sheet', 'Week', 'Day', 'Period', 'Class', 'Year group', 'Details', 'Resources']);
      for (const s of current.sheets) for (const it of s.items) {
        for (const wk of it.c.week === 'AB' ? ['A', 'B'] : [it.c.week]) lines.push([s.title, wk, it.c.day, it.c.period, it.l1, it.c.year || '', it.l2, it.res.map((r) => r.name).join(', ')]);
      }
      U.download(`EduResourcer - ${current.title}.csv`.replace(/[\\/:*?"<>|]/g, '-'), CSV.stringify(lines));
      return;
    }
    for (const s of current.sections) { lines.push([]); if (s.title) lines.push([s.title]); lines.push(s.columns, ...s.rows); }
    U.download(`EduResourcer - ${current.title}.csv`.replace(/[\\/:*?"<>|]/g, '-'), CSV.stringify(lines));
  }

  // Put `node` into the hidden print area and open the browser's print dialog.
  function printDom(node, timetable) {
    const area = document.getElementById('printArea');
    clear(area);
    if (!timetable) area.appendChild(h('div', { class: 'print-head' }, h('strong', null, 'EduResourcer'), h('span', null, new Date().toLocaleString())));
    area.appendChild(node);
    area.classList.toggle('tt-print', !!timetable);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); clear(area); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  function printIt() {
    if (!current || denyExport()) return;
    printDom(resultDom(current), current.kind === 'timetable');
  }

  // Whole-school (or filtered) timetable: one landscape sheet per week, every class in its Period x Day cell.
  // opts: { classes, weeks:['A','B'], title, subtitle, byYear }  (byYear: a separate page per year group)
  R.printTimetable = (opts) => {
    if (denyExport()) return;
    const items = opts.classes.map((c) => ({
      c, l1: c.name, l2: [c.room, c.teacher].filter(Boolean).join(' · '),
      res: M.resourcesOfClass(c.key).map((x) => x.res).filter(Boolean),
    }));
    const wrap = h('div', { class: 'rep tt-wrap' });
    if (opts.byYear) {
      const years = [...new Set(items.map((it) => it.c.year || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || U.yearCmp(a, b));
      for (const y of years) {
        for (const wk of opts.weeks) {
          wrap.appendChild(sheetDom({ title: `${y || 'No year group'} — Week ${wk}`, subtitle: opts.subtitle, items: items.filter((it) => (it.c.year || '') === y), weeks: [wk], big: true, hideYear: true }));
        }
      }
    } else {
      for (const wk of opts.weeks) {
        wrap.appendChild(sheetDom({ title: `${opts.title} — Week ${wk}`, subtitle: opts.subtitle, items, weeks: [wk], big: true }));
      }
    }
    printDom(wrap, true);
  };

  R.render = (container) => {
    clear(container);
    const sel = (value, options, onchange, label) => h('select', { 'aria-label': label, value, onchange: (e) => { onchange(e.target.value); } },
      options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));

    const controls = h('div', { class: 'rep-controls' });
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) =>
      h('button', { class: 'tab' + (state.tab === k ? ' on' : ''), role: 'tab', type: 'button', onclick: () => { state.tab = k; R.render(container); } }, t)));

    const typeOpts = [['', 'All types'], ...M.types.map((t) => [t.id, t.name])];
    if (state.tab === 'resource') {
      const resOpts = () => [['', 'All resources (summary)'], ...[...M.resByKey.values()].filter((r) => (!state.type || r.typeId === state.type) && (!state.rFaculty || r.faculty === state.rFaculty))
        .sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name)).map((r) => [r.key, state.type ? r.name : `${r.name} — ${r.typeName}`])];
      controls.append(...[
        U.field('Type', sel(state.type, typeOpts, (v) => { state.type = v; state.res = ''; R.render(container); }, 'Type')),
        M.resFaculties.length ? U.field('Faculty', sel(state.rFaculty, [['', 'All faculties'], ...M.resFaculties.map((f) => [f, f])], (v) => { state.rFaculty = v; state.res = ''; R.render(container); }, 'Resource faculty')) : null,
        U.field('Resource', sel(state.res, resOpts(), (v) => { state.res = v; run(); }, 'Resource'))].filter(Boolean));
    } else if (state.tab === 'subject') {
      if (!M.faculties.length && !M.subjects.length) {
        controls.append(h('p', { class: 'callout warn' }, 'No faculties or subjects yet. Include Faculty and/or Subject columns when you import classes (or let the importer take the subject from class names like 9B/Maths).'));
      } else {
        if (state.faculty && !M.faculties.includes(state.faculty)) state.faculty = '';
        if (state.subject && !M.subjectsOf(state.faculty).includes(state.subject)) state.subject = '';
        if (M.faculties.length) controls.append(U.field('Faculty', sel(state.faculty, [['', 'All faculties'], ...M.faculties.map((f) => [f, f])], (v) => { state.faculty = v; R.render(container); }, 'Faculty')));
        if (M.subjects.length) controls.append(U.field('Subject', sel(state.subject, [['', 'All subjects'], ...M.subjectsOf(state.faculty).map((s) => [s, s])], (v) => { state.subject = v; run(); }, 'Subject')));
      }
    } else if (state.tab === 'class') {
      controls.append(
        U.field('Class name contains', h('input', { type: 'search', value: state.q, placeholder: 'e.g. 9X or Maths', oninput: U.debounce((e) => { state.q = e.target.value; run(); }) })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.noRes, onchange: (e) => { state.noRes = e.target.checked; run(); } }), 'Only classes with no resources'));
    } else if (state.tab === 'year') {
      controls.append(M.years.length
        ? U.field('Year group', sel(state.year, [['', 'All year groups'], ...M.years.map((y) => [y, y])], (v) => { state.year = v; run(); }, 'Year group'))
        : h('p', { class: 'callout warn' }, 'No year groups yet. Include a year group column when you import classes (or let the importer work it out from class names like 9B/Maths).'));
    } else if (state.tab === 'room') {
      controls.append(U.field('Room', sel(state.room, [['', 'All rooms'], ...M.rooms.map((r) => [r, r])], (v) => { state.room = v; run(); }, 'Room')));
    } else if (state.tab === 'teacher') {
      controls.append(U.field('Teacher', sel(state.teacher, [['', 'All teachers'], ...M.teachers.map((r) => [r, r])], (v) => { state.teacher = v; run(); }, 'Teacher')));
    } else {
      controls.append(...[
        U.field('Resource type', sel(state.fType, typeOpts, (v) => { state.fType = v; run(); }, 'Resource type')),
        M.resFaculties.length ? U.field('Resource faculty', sel(state.fFaculty, [['', 'All faculties'], ...M.resFaculties.map((f) => [f, f])], (v) => { state.fFaculty = v; run(); }, 'Resource faculty')) : null,
        U.field('Day', sel(state.fDay, [['', 'Choose…'], ...M.days.map((d) => [d, d])], (v) => { state.fDay = v; run(); }, 'Day')),
        U.field('Period', sel(state.fPeriod, [['', 'Choose…'], ...M.periods.map((p) => [p.pkey, p.label])], (v) => { state.fPeriod = v; run(); }, 'Period')),
        U.field('Week', sel(state.fWeek, [['A', 'Week A'], ['B', 'Week B']], (v) => { state.fWeek = v; run(); }, 'Week'))].filter(Boolean));
    }

    const viewToggle = state.tab === 'free' ? null : h('div', { class: 'seg', role: 'group', 'aria-label': 'Report layout' }, [['list', 'List'], ['timetable', 'Timetable']].map(([v, t]) =>
      h('button', { class: 'seg-btn' + (state.view === v ? ' on' : ''), type: 'button', 'aria-pressed': String(state.view === v), onclick: () => { state.view = v; R.render(container); } }, t)));

    const actions = h('div', { class: 'rep-actions' }, viewToggle,
      A.canExport() ? h('button', { class: 'btn ghost', type: 'button', onclick: exportCsv }, 'Export CSV') : null,
      A.canExport() ? h('button', { class: 'btn ghost', type: 'button', onclick: printIt }, 'Print') : null);

    outEl = h('div', { class: 'rep-out' });
    container.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, 'Reports'), actions),
      tabs, controls, outEl));
    run();
  };
})();
