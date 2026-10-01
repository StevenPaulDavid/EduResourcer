(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const I = (ER.importer = {});
  const { h, clear, norm, toast } = ER.util;
  const U = ER.util, M = ER.model, CSV = ER.csv;

  const FIELDS = {
    classes: [
      { k: 'name', label: 'Class name', required: true, syn: ['class name', 'class', 'classname', 'name', 'lesson', 'group', 'class code'] },
      { k: 'room', label: 'Room', syn: ['room', 'rm', 'classroom', 'location', 'venue'] },
      { k: 'period', label: 'Period', required: true, syn: ['period', 'prd', 'per', 'lesson number', 'slot', 'p'] },
      { k: 'day', label: 'Day', required: true, syn: ['day', 'weekday', 'day of week', 'dow'] },
      { k: 'week', label: 'Week (A or B)', syn: ['week', 'wk', 'week a/b', 'a/b', 'cycle', 'fortnight', 'week type'] },
      { k: 'teacher', label: 'Teacher', syn: ['teacher', 'staff', 'tutor', 'teacher name', 'instructor', 'taught by', 'teacher code'] },
      { k: 'year', label: 'Year group (optional)', syn: ['year group', 'year', 'yr', 'yeargroup', 'yr group', 'year grp', 'year level', 'grade', 'year/grade'] },
      { k: 'faculty', label: 'Faculty (optional)', syn: ['faculty', 'department', 'dept', 'faculty/department', 'subject faculty', 'faculty name', 'curriculum area'] },
      { k: 'subject', label: 'Subject (optional)', syn: ['subject', 'subject name', 'course', 'subject area', 'subject code'] },
    ],
    resources: [
      { k: 'name', label: 'Resource name', required: true, syn: ['name', 'resource', 'resource name', 'item', 'asset', 'device', 'description'] },
      { k: 'id', label: 'ID / asset tag (optional)', syn: ['id', 'asset tag', 'asset id', 'tag', 'code', 'serial', 'reference', 'ref'] },
      { k: 'location', label: 'Location (optional)', syn: ['location', 'room', 'stored', 'storage', 'home', 'base'] },
      { k: 'faculty', label: 'Faculty (optional)', syn: ['faculty', 'department', 'dept', 'owner', 'owned by', 'team', 'faculty/department', 'curriculum area'] },
      { k: 'notes', label: 'Notes (optional)', syn: ['notes', 'note', 'comments', 'comment', 'details', 'info'] },
    ],
  };

  // Match fields to columns: exact header names first, then "contains" matches, never giving one column to two fields
  // (so a "Year Group" column is claimed by Year group and not mistaken for the class name).
  const guessAll = (headers, fields) => {
    const hs = headers.map(norm);
    const claimed = new Set();
    const mapping = {};
    const pass = (test) => fields.forEach((f) => {
      if (mapping[f.k] >= 0) return;
      const i = hs.findIndex((x, ix) => !claimed.has(ix) && test(f, x));
      mapping[f.k] = i;
      if (i >= 0) claimed.add(i);
    });
    pass((f, x) => f.syn.includes(x));
    pass((f, x) => f.syn.some((s) => s.length > 2 && x.includes(s)));
    return mapping;
  };

  function open(kind) {
    const isClass = kind === 'classes';
    const fields = FIELDS[kind];
    const st = { headers: null, rows: null, fileName: '', mapping: {}, typeName: '', result: null };
    const body = h('div', { class: 'wizard' });
    const api = U.modal({
      title: isClass ? 'Import classes (CSV or Excel)' : 'Import a resource type (CSV or Excel)',
      body, wide: true,
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { id: 'go', label: 'Import', kind: 'primary', onClick: () => doImport() },
      ],
    });
    api.buttons.go.disabled = true;

    // sets up the mapping step from parsed { headers, rows } (CSV, or one sheet of an Excel workbook)
    const applyParsed = (parsed, fileName, sheetName) => {
      st.headers = parsed.headers; st.rows = parsed.rows; st.fileName = fileName;
      st.mapping = guessAll(parsed.headers, fields);
      st.guessYear = undefined;
      st.guessSubject = undefined;
      if (!isClass) {
        const generic = !sheetName || /^(sheet|table|worksheet)\s*\d*$/i.test(sheetName);
        const src = generic ? fileName.replace(/\.[^.]+$/, '') : sheetName;
        const base = src.replace(/[_-]+/g, ' ').replace(/\b(resources?|import|list|data)\b/gi, '').trim();
        st.typeName = base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
      }
    };

    const readFile = async (file) => {
      try {
        const buf = await file.arrayBuffer();
        const type = ER.xlsx.sniff(buf, file.name);
        st.book = null; st.sheet = 0;
        if (type === 'xls') throw new Error('That is an old-style .xls file. In Excel choose Save As → Excel Workbook (.xlsx) or CSV, then import that.');
        let parsed;
        if (type === 'xlsx') {
          st.book = await ER.xlsx.open(buf);
          let best = 0;                                               // start on the sheet with the most data
          for (let i = 0; i < st.book.names.length; i++) {
            const p = await st.book.read(i);
            const size = p.headers.length ? (p.rows.length + 1) * p.headers.length : 0;
            if (size > best) { best = size; parsed = p; st.sheet = i; }
          }
        } else parsed = CSV.parse(CSV.decode(buf));
        if (!parsed || !parsed.headers.length) throw new Error('That file looks empty.');
        applyParsed(parsed, file.name, st.book ? st.book.names[st.sheet] : '');
        render();
      } catch (e) { toast(e.message || 'Could not read that file.', 'error'); }
    };

    const switchSheet = async (i) => {
      try {
        const parsed = await st.book.read(i);
        if (!parsed.headers.length) { toast('That sheet is empty.', 'error'); render(); return; }
        st.sheet = i;
        applyParsed(parsed, st.fileName, st.book.names[i]);
        render();
      } catch (e) { toast(e.message || 'Could not read that sheet.', 'error'); }
    };

    function stepFile() {
      const input = h('input', { type: 'file', accept: '.csv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', class: 'visually-hidden', onchange: (e) => e.target.files[0] && readFile(e.target.files[0]) });
      const zone = h('div', { class: 'dropzone', tabindex: '0', role: 'button',
        onclick: () => input.click(),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
        ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
        ondragleave: () => zone.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); },
      },
        h('div', { class: 'dz-icon' }, '⇪'),
        h('strong', null, 'Drop a CSV or Excel (.xlsx) file here, or click to choose'),
        h('span', { class: 'muted' }, isClass
          ? 'Columns needed: class name, day, period. Room, week (A/B), teacher and year group are optional but recommended. The first row must be the column headings.'
          : 'One file = one type of resource (e.g. all your laptop trolleys). Needs at least a name column.'),
      );
      const note = isClass && M.classes.length
        ? h('p', { class: 'callout' }, `Classes are already imported (${M.classes.length}). Importing again replaces the list. Resources stay on classes that still match on name + day + period + week; anything that no longer matches is flagged for review on the Data page.`)
        : null;
      return h('div', null, note, zone, input);
    }

    function render() {
      clear(body);
      api.buttons.go.disabled = true;
      if (!st.headers) { body.appendChild(stepFile()); return; }

      const opts = (sel) => [h('option', { value: '-1', selected: sel < 0 }, '— not in file —'),
        ...st.headers.map((hd, i) => h('option', { value: String(i), selected: i === sel }, hd || `(column ${i + 1})`))];

      const maps = h('div', { class: 'map-grid' }, fields.map((f) => {
        const sel = h('select', { 'aria-label': f.label, onchange: (e) => { st.mapping[f.k] = Number(e.target.value); refresh(); } }, opts(st.mapping[f.k]));
        return U.field(f.label + (f.required ? ' *' : ''), sel);
      }));

      const head = h('div', { class: 'wiz-head' },
        h('div', null, h('strong', null, st.fileName), h('span', { class: 'muted' }, `  ·  ${st.rows.length} data rows`)),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { st.headers = null; st.book = null; render(); } }, 'Choose a different file'));
      const sheetPick = st.book && st.book.names.length > 1
        ? h('div', { class: 'sheet-pick' }, U.field('Worksheet to import', h('select', { 'aria-label': 'Worksheet', onchange: (e) => switchSheet(Number(e.target.value)) },
          st.book.names.map((n, i) => h('option', { value: String(i), selected: i === st.sheet }, n)))))
        : null;

      let typeField = null;
      if (!isClass) {
        const dl = h('datalist', { id: 'typeNames' }, M.types.map((t) => h('option', { value: t.name })));
        const inp = h('input', { type: 'text', value: st.typeName, list: 'typeNames', placeholder: 'e.g. Laptops', maxlength: '40',
          oninput: (e) => { st.typeName = e.target.value; refresh(); } });
        typeField = h('div', { class: 'type-field' }, U.field('Resource type (becomes a tab in the resource bank) *', inp,
          'Use an existing type name to update that type. Resources are matched by ID (or name), so existing allocations are kept.'), dl);
      }

      const preview = h('div', { class: 'preview' });
      st.previewEl = preview;
      body.append(...[head, sheetPick, typeField, h('h3', { class: 'sec' }, 'Match your columns'), maps, preview].filter(Boolean));
      refresh();
    }

    function refresh() {
      const el = st.previewEl;
      if (!el) return;
      clear(el);
      const missing = fields.filter((f) => f.required && st.mapping[f.k] < 0).map((f) => f.label);
      const typeMissing = !isClass && !st.typeName.trim();
      if (missing.length || typeMissing) {
        el.appendChild(h('p', { class: 'callout warn' },
          missing.length ? `Choose a column for: ${missing.join(', ')}.` : 'Enter a resource type name.'));
        st.result = null;
        api.buttons.go.disabled = true;
        return;
      }
      // no year column? offer to work it out from names like "9B/Maths" when most names start with a year number
      // (same idea for the subject: names like "9B/Maths" carry it after the slash)
      const guessBoxes = [];
      const offerGuess = (stateKey, test, label) => {
        const names = st.rows.map((r) => r[st.mapping.name] || '').filter(Boolean);
        const hits = names.filter(test).length;
        if (!names.length || hits / names.length < 0.5) return;
        if (st[stateKey] === undefined) st[stateKey] = hits / names.length >= 0.8;
        guessBoxes.push(h('label', { class: 'check guess-year' },
          h('input', { type: 'checkbox', checked: !!st[stateKey], onchange: (e) => { st[stateKey] = e.target.checked; refresh(); } }), label));
      };
      if (isClass && st.mapping.name >= 0) {
        if (st.mapping.year < 0) offerGuess('guessYear', (n) => U.yearFromName(n), 'No year group column: work out the year group from the start of the class name (e.g. 9B/Maths → Year 9)');
        if (st.mapping.subject < 0) offerGuess('guessSubject', (n) => U.subjectFromName(n), 'No subject column: take the subject from the class name after the slash (e.g. 9B/Maths → Maths)');
      }
      const res = isClass
        ? M.parseClasses(st.rows, st.mapping, { guessYear: !!st.guessYear, guessSubject: !!st.guessSubject })
        : M.parseResources(st.rows, st.mapping);
      st.result = res;
      guessBoxes.forEach((b) => el.appendChild(b));
      const diff = isClass ? M.diffClasses(res.valid) : M.diffResources(st.typeName, res.valid);

      const stats = h('div', { class: 'stats' },
        stat(res.valid.length, 'ready to import', 'ok'),
        stat(res.errors.length, 'rows with problems (skipped)', res.errors.length ? 'bad' : ''),
        stat(diff.added, 'new'),
        stat(diff.kept, 'already there'),
        stat(diff.removed, 'no longer in file', diff.removed ? 'warn' : ''));
      el.appendChild(stats);

      if (diff.affected) el.appendChild(h('p', { class: 'callout warn' },
        `${diff.affected} existing allocation(s) belong to ${isClass ? 'classes' : 'resources'} that are not in this file. They will be kept but flagged for review on the Data page.`));
      res.notes.forEach((n) => el.appendChild(h('p', { class: 'callout' }, n)));

      if (res.valid.length) {
        const cols = isClass ? ['Class', 'Year', 'Faculty', 'Subject', 'Day', 'Period', 'Week', 'Room', 'Teacher'] : ['Name', 'ID', 'Faculty', 'Location', 'Notes'];
        const rowsOut = res.valid.slice(0, 6).map((r) => isClass
          ? [r.name, r.year, r.faculty, r.subject, r.day, r.period, r.week === 'AB' ? 'A+B' : r.week, r.room, r.teacher]
          : [r.name, r.id, r.faculty, r.location, r.notes]);
        el.appendChild(h('h3', { class: 'sec' }, `Preview (first ${rowsOut.length})`));
        el.appendChild(table(cols, rowsOut));
      }
      if (res.errors.length) {
        el.appendChild(h('h3', { class: 'sec' }, 'Problems found'));
        const shown = res.errors.slice(0, 40);
        el.appendChild(h('div', { class: 'err-list' }, shown.map((e) => h('div', { class: 'err-row' },
          h('span', { class: 'err-line' }, 'Row ' + e.line), h('span', null, e.msg), h('code', null, e.row.join(' | '))))));
        if (res.errors.length > shown.length) el.appendChild(h('p', { class: 'muted' }, `…and ${res.errors.length - shown.length} more.`));
      }
      api.buttons.go.disabled = res.valid.length === 0;
      api.buttons.go.textContent = isClass ? `Import ${res.valid.length} classes` : `Import ${res.valid.length} resources`;
    }

    async function doImport() {
      if (!st.result || !st.result.valid.length) return false;
      if (isClass && M.classes.length) {
        const diff = M.diffClasses(st.result.valid);
        if (diff.removed > 0 && !(await U.confirm(
          `${diff.removed} existing class(es) are not in this file${diff.affected ? ` and ${diff.affected} allocation(s) will need review` : ''}. Continue?`,
          { ok: 'Replace class list', title: 'Replace existing classes?' }))) return false;
      }
      const diff = isClass
        ? await M.importClasses(st.result.valid, st.fileName)
        : await M.importResources(st.typeName, st.result.valid, st.fileName);
      toast(isClass
        ? `Imported ${st.result.valid.length} classes (${diff.added} new).`
        : `${diff.existing ? 'Updated' : 'Added'} “${st.typeName.trim()}”: ${st.result.valid.length} resources.`, 'success');
      if (ER.ui && ER.ui.refresh) ER.ui.refresh();
    }

    render();
  }

  const stat = (n, label, kind = '') => h('div', { class: 'stat ' + kind }, h('strong', null, String(n)), h('span', null, label));
  const table = (cols, rows) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));

  I.openClasses = () => open('classes');
  I.openResources = () => open('resources');
})();
