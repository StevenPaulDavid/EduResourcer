(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const AL = (ER.allocate = {});
  const { h, clear, toast } = ER.util;
  const U = ER.util, M = ER.model, A = ER.auth;

  const ui = (AL.ui = { week: 'A', teacher: '', room: '', year: '', faculty: '', subject: '', q: '', mine: false, bankType: null, bankQ: '', bankFaculty: '', armed: null, drag: null, bankHidden: false });
  let gridEl = null, bankEl = null, infoEl = null, armedEl = null, alertEl = null;
  let overCard = null, tipEl = null;
  let slotHl = { prev: [], cell: null };
  let gridParts = null;

  // ---------- helpers ----------
  const canDrag = () => A.canAllocateAny() || A.user().role === 'staff';

  function chipEl(res, { alloc, bank } = {}) {
    const used = (M.allocsByRes.get(res.key) || []).length;
    const el = h('span', {
      class: 'chip' + (alloc ? ' alloc' : ' in-bank') + (alloc && alloc.conflict ? ' conflict' : '') + (ui.armed === res.key && bank ? ' armed' : ''),
      dataset: Object.assign({ t: String(M.typeColour(res.typeId)) }, alloc ? { aid: alloc.id } : { rkey: res.key }),
      title: alloc
        ? `${res.typeName}: ${res.name}${alloc.conflict ? ' — CLASHES with another booking' : ''}${alloc.by ? '\nAllocated by ' + alloc.by : ''}`
        : `${res.typeName}: ${res.name}${res.faculty ? '\nFaculty: ' + res.faculty : ''}${res.location ? '\nLocation: ' + res.location : ''}${res.notes ? '\n' + res.notes : ''}\nAllocated to ${used} class slot(s)`,
      draggable: !!(alloc ? alloc._editable : canDrag()),
    }, h('span', { class: 'chip-dot' }),
      alloc && !alloc.conflict ? h('span', { class: 'chip-ok', 'aria-hidden': 'true' }, '✓') : null,   // green + tick = allocated
      h('span', { class: 'chip-name' }, res.name),
      bank && used ? h('span', { class: 'chip-count' }, String(used)) : null,
      alloc && alloc._editable ? h('button', { class: 'chip-x', type: 'button', 'aria-label': 'Remove ' + res.name }, '×') : null,
      alloc && alloc.conflict ? h('span', { class: 'chip-warn', 'aria-hidden': 'true' }, '⚠') : null);
    return el;
  }

  function cardEl(c) {
    const mine = A.session && U.norm(A.user().teacher) && U.norm(c.teacher) === U.norm(A.user().teacher);
    const editable = A.canEditClass(c);
    const chips = M.resourcesOfClass(c.key).filter((x) => x.res).map(({ alloc, res }) => {
      alloc._editable = editable;
      return chipEl(res, { alloc });
    });
    // shared-resource markers: has it / shared with … / not this lesson (worked out live from the groups and priorities)
    // green ✓ has it · blue ⇄ shared, staff to agree · orange ✕ shared resource, cannot have it this lesson
    const markData = ER.shared ? ER.shared.markersFor(c.key, ui.week) : [];
    const SYMBOL = { holder: '✓ ', shared: '⇄ ', missing: '✕ ' };
    const marks = markData.map((m) =>
      h('span', { class: 'chip sh-mark sh-' + m.status, title: m.title }, h('span', { class: 'chip-name' }, SYMBOL[m.status] + m.text)));
    // only cards with something to look at get a coloured edge: red (real clash) > orange > blue
    const clash = M.resourcesOfClass(c.key).some((x) => x.res && x.alloc.conflict);
    const edge = clash ? 'edge-red' : markData.some((m) => m.status === 'missing') ? 'edge-orange' : markData.some((m) => m.status === 'shared') ? 'edge-blue' : '';
    return h('div', { class: 'card' + (mine ? ' mine' : '') + (editable ? '' : ' locked') + (edge ? ' ' + edge : ''), dataset: { key: c.key } },
      h('div', { class: 'card-top' }, h('strong', { class: 'card-name' }, c.name),
        c.week === 'AB' ? h('span', { class: 'wk-badge', title: 'Runs every week' }, 'A+B') : null),
      h('div', { class: 'card-meta' }, [c.year ? h('span', { class: 'yr-badge', title: c.year }, U.yearShort(c.year)) : null, c.room ? h('span', null, '⌂ ' + c.room) : null, c.teacher ? h('span', null, c.teacher) : null,
        c.subject && !U.norm(c.name).includes(U.norm(c.subject)) ? h('span', { class: 'subj-tag', title: c.faculty ? `${c.faculty} · ${c.subject}` : c.subject }, c.subject) : null]),
      h('div', { class: 'card-chips' }, chips.length || marks.length ? [...chips, ...marks] : (editable ? h('span', { class: 'drop-hint' }, 'Drop a resource here') : null)));
  }

  const matches = (c) => {
    if (ui.teacher && c.teacher !== ui.teacher) return false;
    if (ui.room && c.room !== ui.room) return false;
    if (ui.year && c.year !== ui.year) return false;
    if (ui.faculty && c.faculty !== ui.faculty) return false;
    if (ui.subject && c.subject !== ui.subject) return false;
    if (ui.mine && U.norm(c.teacher) !== U.norm(A.user().teacher)) return false;
    const q = U.norm(ui.q);
    if (q) {
      const hay = U.norm([c.name, c.room, c.teacher, c.year, c.faculty, c.subject, ...M.resourcesOfClass(c.key).filter((x) => x.res).map((x) => x.res.name)].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  // ---------- grid ----------
  function renderGrid() {
    if (!gridEl) return;
    clear(gridEl);
    if (!M.classes.length) {
      gridEl.appendChild(emptyState());
      infoEl.textContent = '';
      return;
    }
    const classes = M.classes.filter((c) => (c.week === 'AB' || c.week === ui.week) && matches(c));
    const days = M.days, periods = M.periods;
    const buckets = new Map();
    for (const c of classes) {
      const k = c.day + '|' + c.pkey;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    const grid = h('div', { class: 'grid', style: { gridTemplateColumns: `76px repeat(${days.length}, minmax(210px, 1fr))` } });
    slotHl = { prev: [], cell: null };
    gridParts = { days: new Map(), periods: new Map(), cells: [] };
    grid.appendChild(h('div', { class: 'g-corner' }, h('span', null, 'Week'), h('strong', null, ui.week)));
    days.forEach((d) => {
      const el = h('div', { class: 'g-day' }, d);
      gridParts.days.set(d, el);
      grid.appendChild(el);
    });
    periods.forEach((p, pi) => {
      const band = pi % 2 ? ' band' : '';
      const pel = h('div', { class: 'g-period' + band }, h('span', null, 'Period'), h('strong', null, p.label));
      gridParts.periods.set(p.pkey, pel);
      grid.appendChild(pel);
      const tag = /^\d+$/.test(p.label) ? 'P' + p.label : p.label;
      for (const d of days) {
        const list = (buckets.get(d + '|' + p.pkey) || []).sort((a, b) => U.natCmp(a.name, b.name));
        const cell = h('div', { class: 'g-cell' + band + (list.length ? '' : ' vacant'), dataset: { day: d, p: p.pkey } },
          h('span', { class: 'cell-tag' }, `${d} · ${tag}`), list.map(cardEl));
        gridParts.cells.push(cell);
        grid.appendChild(cell);
      }
    });
    gridEl.appendChild(grid);
    infoEl.textContent = `${classes.length} class${classes.length === 1 ? '' : 'es'} in Week ${ui.week}`;
    if (ui.armed) markTargets(armedDrag());
  }

  function emptyState() {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art' }, '▦'),
      h('h2', null, 'No classes yet'),
      A.canManageData()
        ? [h('p', null, 'Import a CSV of your classes to build the timetable.'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => ER.importer.openClasses() }, 'Import classes')]
        : h('p', null, 'Ask your resource admin to import the class list.'));
  }

  // ---------- resource bank ----------
  function renderBank() {
    if (!bankEl) return;
    clear(bankEl);
    bankEl.classList.toggle('collapsed', ui.bankHidden);
    if (A.user().role === 'readonly') { bankEl.classList.add('hidden'); return; }
    bankEl.classList.remove('hidden');

    if (!M.types.some((t) => t.id === ui.bankType)) ui.bankType = M.types.length ? M.types[0].id : null;
    const tabs = h('div', { class: 'tabs bank-tabs', role: 'tablist' }, M.types.map((t) =>
      h('button', { class: 'tab' + (t.id === ui.bankType ? ' on' : ''), role: 'tab', type: 'button', dataset: { t: String(M.typeColour(t.id)) },
        onclick: () => { ui.bankType = t.id; renderBank(); } },
      h('span', { class: 'tab-dot' }), t.name, h('span', { class: 'tab-count' }, String(t.items.filter((it) => !ui.bankFaculty || it.faculty === ui.bankFaculty).length)))));

    const search = h('input', { type: 'search', class: 'bank-search', placeholder: 'Find resource…', value: ui.bankQ, 'aria-label': 'Find resource',
      oninput: U.debounce((e) => { ui.bankQ = e.target.value; renderBankChips(); }) });
    // resources can belong to a faculty; narrow the bank to one faculty's resources
    if (ui.bankFaculty && !M.resFaculties.includes(ui.bankFaculty)) ui.bankFaculty = '';
    const facSel = M.resFaculties.length
      ? h('select', { class: 'bank-fac', 'aria-label': 'Filter resources by faculty', title: 'Show only this faculty’s resources', onchange: (e) => { ui.bankFaculty = e.target.value; renderBank(); } },
        [h('option', { value: '' }, 'All faculties'), ...M.resFaculties.map((f) => h('option', { value: f, selected: f === ui.bankFaculty }, f))])
      : null;
    const toggle = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { ui.bankHidden = !ui.bankHidden; renderBank(); } }, ui.bankHidden ? 'Show ▴' : 'Hide ▾');
    bankEl.appendChild(h('div', { class: 'bank-head' }, h('h3', null, 'Resources'), M.types.length ? tabs : null, h('span', { class: 'spacer' }), M.types.length ? facSel : null, M.types.length ? search : null, toggle));

    const body = h('div', { class: 'bank-body' });
    bankEl.appendChild(body);
    bankEl.bodyEl = body;
    renderBankChips();
  }

  function renderBankChips() {
    const body = bankEl && bankEl.bodyEl;
    if (!body) return;
    clear(body);
    if (!M.types.length) {
      body.appendChild(h('div', { class: 'bank-empty' }, A.canManageData()
        ? [h('span', null, 'No resources yet. '), h('button', { class: 'btn small primary', type: 'button', onclick: () => ER.importer.openResources() }, 'Import resources')]
        : 'No resources have been imported yet.'));
      return;
    }
    const t = M.types.find((x) => x.id === ui.bankType);
    const q = U.norm(ui.bankQ);
    const items = (t ? t.items : []).filter((it) => (!ui.bankFaculty || it.faculty === ui.bankFaculty)
      && (!q || U.norm(it.name + ' ' + (it.location || '') + ' ' + (it.faculty || '')).includes(q)));
    if (!items.length) { body.appendChild(h('div', { class: 'bank-empty' }, 'No matching resources.')); return; }
    for (const it of items) body.appendChild(chipEl(M.resByKey.get(t.id + '|' + it.id), { bank: true }));
  }

  // ---------- drag, drop and click-to-place ----------
  function markTargets(drag) {
    gridEl.querySelectorAll('.card').forEach((el) => {
      const cls = M.classByKey.get(el.dataset.key);
      if (!drag || !cls) { el.classList.remove('no-drop', 'can-drop'); el.removeAttribute('title'); return; }
      const st = M.dropStatus(drag.resKey, cls, drag.kind === 'alloc' ? drag.id : null);
      const same = drag.kind === 'alloc' && drag.classKey === cls.key;
      el.classList.toggle('no-drop', !st.ok || same);
      el.classList.toggle('can-drop', st.ok && !same);
      if (!st.ok) el.title = st.reason; else el.removeAttribute('title');
    });
  }
  const armedDrag = () => (ui.armed ? { kind: 'res', resKey: ui.armed } : null);

  function endDrag() {
    ui.drag = null;
    document.body.classList.remove('dragging');
    if (overCard) { overCard.classList.remove('drop-over'); overCard = null; }
    bankEl && bankEl.classList.remove('drop-remove');
    clearSlot(); hideTip();
    markTargets(armedDrag());
  }

  // ---- "where am I?" aids: crosshair highlight of the day/period + a floating drop summary ----
  function clearSlot() {
    for (const el of slotHl.prev) el.classList.remove('hl', 'hl-row', 'hl-col', 'hot');
    slotHl.prev = []; slotHl.cell = null;
  }
  function highlightSlot(cell) {
    if (!cell || cell === slotHl.cell || !gridParts) return;
    clearSlot();
    slotHl.cell = cell;
    const { day, p } = cell.dataset;
    const add = (el, ...cls) => { if (el) { el.classList.add(...cls); slotHl.prev.push(el); } };
    add(gridParts.days.get(day), 'hl');
    add(gridParts.periods.get(p), 'hl');
    for (const c of gridParts.cells) {
      if (c === cell) add(c, 'hot');
      else if (c.dataset.day === day) add(c, 'hl-col');
      else if (c.dataset.p === p) add(c, 'hl-row');
    }
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }
  function showTip(drag, card, verb) {
    const cls = M.classByKey.get(card.dataset.key), res = M.resByKey.get(drag.resKey);
    if (!cls || !res || !tipEl) return;
    const st = M.dropStatus(drag.resKey, cls, drag.kind === 'alloc' ? drag.id : null);
    const same = drag.kind === 'alloc' && drag.classKey === cls.key;
    clear(tipEl);
    tipEl.classList.toggle('bad', !st.ok || same);
    if (same) tipEl.append(h('span', null, 'Already on this class'));
    else if (!st.ok) tipEl.append(h('span', null, st.reason));
    else tipEl.append(h('span', null, verb + ' '), h('strong', null, res.name), h('span', null, ' on '), h('strong', null, cls.name),
      h('span', { class: 'tip-slot' }, `${cls.day} · Period ${cls.period} · Week ${cls.week === 'AB' ? 'A+B' : cls.week}`));
    tipEl.style.bottom = (bankEl && !bankEl.classList.contains('hidden') ? bankEl.offsetHeight : 0) + 14 + 'px';
    tipEl.hidden = false;
  }

  // an action can return false to cancel quietly (no "done" message)
  async function perform(fn, okMsg) {
    try { const r = await fn(); if (r !== false && okMsg) toast(okMsg, 'success', 2200); }
    catch (err) { toast(err.message || String(err), 'error'); }
    AL.refreshAll();
  }

  // Booking a shared resource by hand wins the lesson, so warn which groups lose it before doing it.
  async function sharedGuard(resKey, classKey) {
    if (!ER.shared) return true;
    const lose = ER.shared.affectedByBooking(resKey, classKey);
    if (!lose.length) return true;
    const res = M.resByKey.get(resKey), cls = M.classByKey.get(classKey);
    return U.confirm(`${res ? res.name : 'This resource'} is a shared resource. Booking it for ${cls ? cls.name : 'this class'} by hand wins this lesson, so ${lose.join(', ')} will lose it.`,
      { ok: 'Book it anyway', title: 'Shared resource' });
  }
  const bookShared = async (resKey, classKey) => ((await sharedGuard(resKey, classKey)) ? M.allocate(resKey, classKey) : false);

  function arm(resKey) {
    ui.armed = ui.armed === resKey ? null : resKey;
    document.body.classList.toggle('armed', !!ui.armed);
    renderBankChips();
    markTargets(armedDrag());
    const r = ui.armed && M.resByKey.get(ui.armed);
    armedEl.hidden = !r;
    if (r) { clear(armedEl); armedEl.append(h('span', null, 'Placing '), h('strong', null, r.name), h('span', null, ' — click a class to assign it. '),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => arm(ui.armed) }, 'Done')); }
  }

  function wire() {
    // bank: drag out, click to arm, drop an allocation back to remove it
    bankEl.addEventListener('dragstart', (e) => {
      const chip = e.target.closest('.chip.in-bank');
      if (!chip) return;
      ui.drag = { kind: 'res', resKey: chip.dataset.rkey };
      e.dataTransfer.setData('text/plain', chip.dataset.rkey);
      e.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('dragging');
      markTargets(ui.drag);
    });
    bankEl.addEventListener('dragend', endDrag);
    bankEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip.in-bank');
      if (chip && canDrag()) arm(chip.dataset.rkey);
    });
    bankEl.addEventListener('dragover', (e) => {
      if (!ui.drag || ui.drag.kind !== 'alloc') return;
      e.preventDefault();
      bankEl.classList.add('drop-remove');
    });
    bankEl.addEventListener('dragleave', (e) => { if (!bankEl.contains(e.relatedTarget)) bankEl.classList.remove('drop-remove'); });
    bankEl.addEventListener('drop', (e) => {
      if (!ui.drag || ui.drag.kind !== 'alloc') return;
      e.preventDefault();
      const id = ui.drag.id;
      endDrag();
      perform(() => M.deallocate(id), 'Resource removed.');
    });

    // grid: drag allocated chips, remove, drop targets, click-to-place
    gridEl.addEventListener('dragstart', (e) => {
      const chip = e.target.closest('.chip.alloc');
      if (!chip) return;
      const a = M.allocById.get(chip.dataset.aid);
      if (!a) return;
      ui.drag = { kind: 'alloc', id: a.id, resKey: a.resKey, classKey: a.classKey };
      e.dataTransfer.setData('text/plain', a.id);
      e.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('dragging');
      markTargets(ui.drag);
    });
    gridEl.addEventListener('dragend', endDrag);
    gridEl.addEventListener('dragover', (e) => {
      if (!ui.drag) return;
      const cell = e.target.closest('.g-cell');
      if (cell) highlightSlot(cell);
      const card = e.target.closest('.card');
      if (!card) { if (overCard) { overCard.classList.remove('drop-over'); overCard = null; } hideTip(); return; }
      if (card !== overCard) showTip(ui.drag, card, ui.drag.kind === 'alloc' ? 'Move' : 'Assign');
      if (card.classList.contains('no-drop')) { if (overCard) { overCard.classList.remove('drop-over'); overCard = null; } return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = ui.drag.kind === 'alloc' ? 'move' : 'copy';
      if (card !== overCard) {
        if (overCard) overCard.classList.remove('drop-over');
        overCard = card; card.classList.add('drop-over');
      }
    });
    gridEl.addEventListener('dragleave', (e) => {
      if (overCard && !overCard.contains(e.relatedTarget)) { overCard.classList.remove('drop-over'); overCard = null; }
      if (!gridEl.contains(e.relatedTarget)) { clearSlot(); hideTip(); }
    });
    // hovering (no drag): highlight the day and period you're over; in click-to-place mode also preview the result
    gridEl.addEventListener('mouseover', (e) => {
      if (ui.drag) return;
      highlightSlot(e.target.closest('.g-cell'));
      const card = e.target.closest('.card');
      if (ui.armed && card) showTip(armedDrag(), card, 'Click to place'); else hideTip();
    });
    gridEl.addEventListener('mouseleave', () => { if (!ui.drag) { clearSlot(); hideTip(); } });
    gridEl.addEventListener('drop', (e) => {
      const card = e.target.closest('.card');
      if (!ui.drag || !card || card.classList.contains('no-drop')) return;
      e.preventDefault();
      const d = ui.drag, key = card.dataset.key;
      endDrag();
      if (d.kind === 'alloc') perform(() => M.moveAlloc(d.id, key), 'Resource moved.');
      else perform(() => bookShared(d.resKey, key), 'Resource assigned.');
    });
    gridEl.addEventListener('click', (e) => {
      const x = e.target.closest('.chip-x');
      if (x) {
        const chip = x.closest('.chip');
        perform(() => M.deallocate(chip.dataset.aid), 'Resource removed.');
        return;
      }
      if (ui.armed) {
        const card = e.target.closest('.card');
        if (card && !e.target.closest('.chip')) perform(() => bookShared(ui.armed, card.dataset.key), 'Resource assigned.');
      }
    });
  }

  // ---------- print the whole timetable ----------
  function filterSummary() {
    const bits = [];
    if (ui.teacher) bits.push('Teacher: ' + ui.teacher);
    if (ui.room) bits.push('Room: ' + ui.room);
    if (ui.year) bits.push('Year: ' + ui.year);
    if (ui.faculty) bits.push('Faculty: ' + ui.faculty);
    if (ui.subject) bits.push('Subject: ' + ui.subject);
    if (ui.mine) bits.push('My classes');
    if (ui.q.trim()) bits.push(`Search: “${ui.q.trim()}”`);
    return bits;
  }

  function openPrintDialog() {
    if (!A.canExport()) return;
    if (!M.classes.length) { toast('There are no classes to print yet.', 'error'); return; }
    const filters = filterSummary();
    let weeks = ui.week, scope = filters.length ? 'filtered' : 'all', byYear = false;
    const radio = (name, value, label, checked, disabled) => h('label', { class: 'check radio' },
      h('input', { type: 'radio', name, value, checked, disabled, onchange: () => { if (name === 'pw') weeks = value; else scope = value; update(); } }), label);
    const countEl = h('p', { class: 'muted' });
    const classesFor = () => (scope === 'filtered' ? M.classes.filter(matches) : M.classes);
    const update = () => {
      const list = classesFor();
      const n = list.length;
      const pages = byYear ? `One landscape page per year group per week` : 'One landscape page per week';
      countEl.textContent = `${n} class slot${n === 1 ? '' : 's'} will be printed, with their resources. ${pages} (long ones continue onto more pages).`;
    };
    const body = h('div', { class: 'stack' },
      h('div', null, h('div', { class: 'field-label' }, 'Weeks'),
        h('div', { class: 'radio-row' }, radio('pw', 'A', 'Week A', weeks === 'A'), radio('pw', 'B', 'Week B', weeks === 'B'), radio('pw', 'AB', 'Both weeks', weeks === 'AB'))),
      h('div', null, h('div', { class: 'field-label' }, 'Which classes'),
        h('div', { class: 'radio-col' },
          radio('ps', 'all', 'Everything', scope === 'all'),
          radio('ps', 'filtered', filters.length ? `Only what is on screen (${filters.join(', ')})` : 'Only what is on screen (no filters are active)', scope === 'filtered', !filters.length))),
      M.years.length ? h('label', { class: 'check' },
        h('input', { type: 'checkbox', onchange: (e) => { byYear = e.target.checked; update(); } }),
        'Start a separate page for each year group') : null,
      countEl);
    update();
    U.modal({ title: 'Print timetable', body, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Print', kind: 'primary', onClick: () => {
        const list = classesFor();
        if (!list.length) { toast('No classes match.', 'error'); return false; }
        ER.reports.printTimetable({
          classes: list, weeks: weeks === 'AB' ? ['A', 'B'] : [weeks], byYear,
          title: scope === 'filtered' && filters.length ? 'Timetable' : 'School timetable',
          subtitle: scope === 'filtered' ? filters.join(' · ') : '',
        });
      } }] });
  }

  // ---------- page ----------
  function updateAlerts() {
    if (!alertEl) return;
    clear(alertEl);
    const orphans = M.orphans().length, conflicts = M.conflicts().length;
    if (conflicts) alertEl.appendChild(h('span', { class: 'pill bad', title: 'Two bookings overlap — remove one' }, `⚠ ${conflicts} clash${conflicts > 1 ? 'es' : ''}`));
    if (orphans && A.canManageData()) alertEl.appendChild(h('button', { class: 'pill warn', type: 'button', onclick: () => ER.ui.go('data') }, `${orphans} allocation${orphans > 1 ? 's' : ''} to review`));
  }

  AL.refreshAll = () => {
    if (!gridEl) return;
    renderGrid(); renderBank(); updateAlerts();
  };
  AL.isDragging = () => !!ui.drag;
  // forget one person's filters/selection when the screen locks or someone else signs in
  AL.resetUi = () => Object.assign(ui, { week: 'A', teacher: '', room: '', year: '', faculty: '', subject: '', q: '', mine: false, bankType: null, bankQ: '', bankFaculty: '', armed: null, drag: null });

  AL.render = (container) => {
    clear(container);
    ui.armed = null;
    document.body.classList.remove('armed');
    const user = A.user();
    const sel = (value, options, onchange, label) => h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) },
      options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Timetable week' }, ['A', 'B'].map((w) =>
      h('button', { class: 'seg-btn' + (ui.week === w ? ' on' : ''), type: 'button', 'aria-pressed': String(ui.week === w),
        onclick: () => { ui.week = w; seg.querySelectorAll('.seg-btn').forEach((b, i) => { const on = ['A', 'B'][i] === w; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); renderGrid(); } }, 'Week ' + w)));

    infoEl = h('span', { class: 'muted info' });
    alertEl = h('span', { class: 'alerts' });
    armedEl = h('div', { class: 'armed-bar', hidden: true });
    const myTeacher = U.norm(user.teacher);
    const mineBtn = myTeacher ? h('button', { class: 'btn ghost small toggle' + (ui.mine ? ' on' : ''), type: 'button', 'aria-pressed': String(ui.mine),
      onclick: (e) => { ui.mine = !ui.mine; e.currentTarget.classList.toggle('on', ui.mine); e.currentTarget.setAttribute('aria-pressed', String(ui.mine)); renderGrid(); } }, 'My classes') : null;

    // faculty narrows the subject list; both filter the classes on the grid
    if (ui.faculty && !M.faculties.includes(ui.faculty)) ui.faculty = '';
    if (ui.subject && !M.subjectsOf(ui.faculty).includes(ui.subject)) ui.subject = '';
    const subjOptions = () => [['', 'All subjects'], ...M.subjectsOf(ui.faculty).map((t) => [t, t])];
    const fill = (select, options, value) => {
      clear(select);
      options.forEach(([v, t]) => select.appendChild(h('option', { value: v, selected: v === value }, t)));
      select.value = value;
    };
    const subjSel = M.subjects.length ? sel(ui.subject, subjOptions(), (v) => { ui.subject = v; renderGrid(); }, 'Filter by subject') : null;
    const facSel = M.faculties.length ? sel(ui.faculty, [['', 'All faculties'], ...M.faculties.map((t) => [t, t])], (v) => {
      ui.faculty = v;
      if (ui.subject && !M.subjectsOf(v).includes(ui.subject)) ui.subject = '';
      if (subjSel) fill(subjSel, subjOptions(), ui.subject);
      renderGrid();
    }, 'Filter by faculty') : null;

    const toolbar = h('div', { class: 'toolbar' },
      seg,
      sel(ui.teacher, [['', 'All teachers'], ...M.teachers.map((t) => [t, t])], (v) => { ui.teacher = v; renderGrid(); }, 'Filter by teacher'),
      M.years.length ? sel(ui.year, [['', 'All year groups'], ...M.years.map((t) => [t, t])], (v) => { ui.year = v; renderGrid(); }, 'Filter by year group') : null,
      facSel, subjSel,
      sel(ui.room, [['', 'All rooms'], ...M.rooms.map((t) => [t, t])], (v) => { ui.room = v; renderGrid(); }, 'Filter by room'),
      h('input', { type: 'search', class: 'tb-search', placeholder: 'Search classes, rooms, resources…', value: ui.q, 'aria-label': 'Search',
        oninput: U.debounce((e) => { ui.q = e.target.value; renderGrid(); }) }),
      mineBtn, h('span', { class: 'spacer' }), alertEl, infoEl,
      A.canExport() ? h('button', { class: 'btn ghost small', type: 'button', onclick: openPrintDialog }, 'Print timetable…') : null,
      A.canManageData() ? h('button', { class: 'btn danger-ghost small', type: 'button', title: 'Clear allocations (starts from your current filters)', onclick: () => {
        const pre = { years: ui.year ? [ui.year] : [], faculties: ui.faculty ? [ui.faculty] : [], subjects: ui.subject ? [ui.subject] : [],
          teachers: ui.teacher ? [ui.teacher] : [], rooms: ui.room ? [ui.room] : [] };
        ER.ui.go('auto');
        ER.autoUi.openClear(pre);
      } }, 'Clear…') : null);

    let note = null;
    if (user.role === 'readonly') note = 'Read-only account: you can view the timetable and run reports.';
    else if (user.role === 'staff' && !myTeacher) note = 'Your login is not linked to a teacher name yet, so you can view but not assign. Ask your System admin to set it.';
    else if (user.role === 'staff') note = 'You can assign resources to your own classes (highlighted).';

    gridEl = h('div', { class: 'gridwrap' });
    bankEl = h('div', { class: 'bank' });
    tipEl = h('div', { class: 'drop-tip', hidden: true, 'aria-live': 'polite' });
    // colour key: one meaning per colour
    const key = h('div', { class: 'status-key', role: 'note', 'aria-label': 'Colour key' },
      h('span', { class: 'k k-green' }, '✓ Allocated'),
      h('span', { class: 'k k-blue' }, '⇄ Shared, staff to agree'),
      h('span', { class: 'k k-orange' }, '✕ Shared, can’t have it this lesson'),
      h('span', { class: 'k k-red' }, '⚠ Clash'));
    container.append(...[toolbar, note ? h('div', { class: 'note-bar' }, note) : null, key, armedEl, gridEl, bankEl, tipEl].filter(Boolean));
    wire();
    AL.refreshAll();
  };
})();

