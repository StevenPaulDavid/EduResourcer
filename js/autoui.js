// Auto-allocate screen: saved rules + run history (home), rule editor, and the preview/apply step.
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const UI = (ER.autoUi = {});
  const { h, clear, toast } = ER.util;
  const U = ER.util, M = ER.model, A = ER.auth, AU = ER.auto;

  const S = { view: 'home', draft: null, plan: null, tab: 'summary', week: 'A', host: null };
  let draftIsNew = false;

  const lessonLabel = (c) => `${c.day} P${c.period} · ${c.week === 'AB' ? 'Wk A+B' : 'Wk ' + c.week}`;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- a compact multi-value picker: chips + an "add" drop-down ----------
  function multiPick({ options, get, set, addLabel, emptyText = 'Any', onChange }) {
    const wrap = h('div', { class: 'mp' });
    const label = new Map(options);
    const draw = () => {
      clear(wrap);
      const cur = get();
      const chips = cur.map((v) => h('span', { class: 'mp-chip' }, label.get(v) ?? v,
        h('button', { type: 'button', 'aria-label': 'Remove ' + (label.get(v) ?? v), onclick: () => { set(get().filter((x) => x !== v)); draw(); if (onChange) onChange(); } }, '×')));
      const rest = options.filter(([v]) => !cur.includes(v));
      const add = rest.length ? h('select', { class: 'mp-add', 'aria-label': addLabel, onchange: (e) => { const v = e.target.value; if (v) { set([...get(), v]); draw(); if (onChange) onChange(); } } },
        [h('option', { value: '' }, '+ ' + addLabel), ...rest.map(([v, l]) => h('option', { value: v }, l))]) : null;
      wrap.append(...[...chips, cur.length ? null : h('span', { class: 'mp-empty' }, emptyText), add].filter(Boolean));
    };
    draw();
    return wrap;
  }

  const numInput = (value, onInput, attrs = {}) => h('input', { type: 'number', min: '0', step: '1', value: value === 0 || value === '' || value == null ? '' : String(value), class: 'num', ...attrs,
    oninput: (e) => onInput(e.target.value === '' ? 0 : Number(e.target.value)) });

  // the "which classes" controls, shared by the rule editor and the clear screen
  function scopeControls(scope, onChange) {
    const mp = (key, options, addLabel) => multiPick({ options, addLabel, onChange, get: () => scope[key], set: (v) => { scope[key] = v; } });
    const opt = (l) => l.map((x) => [x, x]);
    return h('div', { class: 'stack' },
      h('div', { class: 'form-grid' },
        U.field('Year groups', mp('years', opt(M.years), 'Add year group')),
        U.field('Faculties', mp('faculties', opt(M.faculties), 'Add faculty')),
        U.field('Subjects', mp('subjects', opt(M.subjects), 'Add subject')),
        U.field('Teachers', mp('teachers', opt(M.teachers), 'Add teacher')),
        U.field('Rooms', mp('rooms', opt(M.rooms), 'Add room')),
        U.field('Named classes', mp('classes', opt([...new Set(M.classes.map((c) => c.name))].sort(U.natCmp)), 'Add class')),
        U.field('Days', mp('days', opt(M.days), 'Add day')),
        U.field('Periods', mp('periods', M.periods.map((p) => [p.pkey, p.label]), 'Add period'))),
      h('div', null, h('div', { class: 'field-label' }, 'Lessons that run'),
        h('div', { class: 'radio-row' }, [['A', 'Week A only'], ['B', 'Week B only'], ['AB', 'Every week (A+B)']].map(([w, t]) =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: scope.weekTypes.includes(w),
            onchange: (e) => { scope.weekTypes = e.target.checked ? [...new Set([...scope.weekTypes, w])] : scope.weekTypes.filter((x) => x !== w); if (onChange) onChange(); } }), t)))));
  }

  // The resource-pool controls, shared by the rule editor and the clear screen. `owner` has .pool and .poolMode.
  // Boxes that have a choice are combined with AND ("all") or OR ("any"); within a box any choice counts.
  function poolControls(owner, { onChange, emptyMeansAll = false } = {}) {
    const note = h('p', { class: 'pool-match' });
    const update = (notify = true) => {
      const p = owner.pool;
      const none = !p.types.length && !p.faculties.length && !p.items.length;
      const found = [...M.resByKey.values()].filter((r) => AU.inPool(p, owner.poolMode, r)).sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name));
      note.className = 'pool-match' + (!none && !found.length ? ' bad' : '');
      if (none) note.textContent = emptyMeansAll ? 'Nothing chosen, so any resource.' : 'Nothing chosen yet.';
      else if (!found.length) note.textContent = 'No resources match this combination. Check each box, or switch to “any box”. A resource’s faculty comes from the resource import.';
      else note.textContent = `${found.length} resource${found.length === 1 ? '' : 's'} match: ${found.slice(0, 8).map((r) => r.name).join(', ')}${found.length > 8 ? ` … +${found.length - 8} more` : ''}`;
      if (notify && onChange) onChange();
    };
    const box = (key, options, addLabel) => multiPick({ options, addLabel, emptyText: emptyMeansAll ? 'Any' : 'None', onChange: update, get: () => owner.pool[key], set: (v) => { owner.pool[key] = v; } });
    const uid = 'pm' + Math.random().toString(36).slice(2, 7);
    const radio = (v, text) => h('label', { class: 'check radio' }, h('input', { type: 'radio', name: uid, value: v, checked: (owner.poolMode || 'all') === v, onchange: () => { owner.poolMode = v; update(); } }), text);
    const node = h('div', { class: 'stack' },
      h('div', { class: 'radio-col' },
        radio('all', 'A resource must match ALL the boxes I fill in (e.g. type Laptops AND faculty Maths = only Maths-owned laptops)'),
        radio('any', 'A resource may match ANY box (e.g. type Laptops OR faculty Maths = all laptops plus all Maths resources)')),
      h('div', { class: 'form-grid' },
        U.field('Resource types', box('types', M.types.map((t) => [t.id, t.name]), 'Add type')),
        U.field('Resources owned by a faculty', box('faculties', M.resFaculties.map((f) => [f, f]), 'Add faculty')),
        U.field('Individual items', box('items', [...M.resByKey.values()].sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name)).map((r) => [r.key, `${r.name} (${r.typeName})`]), 'Add item'))),
      note);
    update(false);
    return node;
  }

  // ---------- descriptions ----------
  function describeScope(rule) {
    const sc = rule.scope;
    const bits = ['years', 'faculties', 'subjects', 'teachers', 'rooms', 'classes'].filter((k) => sc[k].length)
      .map((k) => `${AU.FILTER_LABELS[k]}: ${sc[k].slice(0, 3).join(', ')}${sc[k].length > 3 ? ` +${sc[k].length - 3}` : ''}`);
    if (sc.days.length) bits.push('Days: ' + sc.days.join(', '));
    if (sc.periods.length) bits.push('Periods: ' + sc.periods.map((p) => (M.periods.find((x) => x.pkey === p) || { label: p }).label).join(', '));
    if (sc.weekTypes.length < 3) bits.push('Lessons: ' + sc.weekTypes.map((w) => (w === 'AB' ? 'every week' : 'Week ' + w + ' only')).join(', '));
    return bits.length ? bits.join(' · ') : 'All classes';
  }
  const FACULTY_TEXT = { none: 'No faculty limit', own: 'Only resources from the class’s own faculty', named: 'Only resources from a chosen faculty', prefer: 'Prefer the class’s own faculty’s resources' };

  // ====================== HOME ======================
  function renderHome() {
    const host = S.host;
    clear(host);
    const rules = M.rules.map(AU.normaliseRule);

    const ruleCards = rules.map((r) => {
      const last = M.runs.find((x) => x.ruleId === r.id);
      return h('section', { class: 'panel rule-card' },
        h('div', { class: 'panel-head' },
          h('div', null, h('h2', null, r.name),
            h('p', { class: 'muted small' }, last ? `Last run ${U.fmtDateTime(last.at)} by ${last.by}${last.undoneAt ? ' (undone)' : ''}` : 'Never run')),
          h('div', { class: 'btn-row tight' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => startPreview(r) }, 'Preview & run'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor(r, false) }, 'Edit'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor({ ...clone(r), id: '', name: r.name + ' (copy)', createdAt: undefined }, true) }, 'Duplicate'),
            h('button', { class: 'btn danger-ghost', type: 'button', onclick: () => deleteRule(r) }, 'Delete'))),
        h('dl', { class: 'rule-sum' },
          h('dt', null, 'Classes'), h('dd', null, describeScope(r)),
          h('dt', null, 'Pool'), h('dd', null, AU.describePool(r)),
          h('dt', null, 'Faculty'), h('dd', null, FACULTY_TEXT[r.facultyMode] + (r.facultyMode === 'named' ? `: ${r.facultyNamed}` : '') + ((r.facultyMode === 'own' || r.facultyMode === 'named') && r.strictFaculty ? ' (strictly: no shared items)' : '')),
          h('dt', null, 'Steps'), h('dd', null, h('ol', { class: 'step-list' }, r.steps.map((s, i) => h('li', null, AU.stepName(s, i), h('span', { class: 'muted' }, `  ·  ${s.all ? 'as many as free' : s.qty + ' each'}${s.maxPerWeek ? ', max ' + s.maxPerWeek + ' lessons/week' : ''}`)))))));
    });

    const runs = M.runs.slice(0, 30);
    const runTable = runs.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['When', 'Rule / action', 'Run by', 'Changed', 'Status', '', ''].map((c) => h('th', null, c)))),
      h('tbody', null, runs.map((run) => {
        const st = M.runStatus(run);
        const clr = run.kind === 'clear';
        return h('tr', null,
          h('td', null, U.fmtDateTime(run.at)), h('td', null, run.ruleName), h('td', null, run.by),
          h('td', null, clr ? `−${run.placements.length} cleared` : `+${run.placements.length} allocated` + (run.removed && run.removed.length ? `, −${run.removed.length} replaced` : '')),
          h('td', null, run.undoneAt ? h('span', { class: 'pill' }, clr ? 'restored' : 'undone') : clr ? `${st.inPlace} of ${st.total} can be restored` : `${st.inPlace} of ${st.total} still in place`),
          h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', type: 'button', disabled: !!run.undoneAt || st.inPlace === 0, onclick: () => undo(run) }, clr ? 'Restore' : 'Undo')),
          h('td', { class: 'actions' }, run.undoneAt ? h('button', { class: 'btn link small', type: 'button', onclick: async () => { try { await M.deleteRun(run.id); renderHome(); } catch (e) { toast(e.message, 'error'); } } }, 'Remove') : null));
      })))) : h('p', { class: 'empty-note' }, 'No runs yet.');

    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Auto-allocate'),
        h('p', { class: 'muted' }, 'Set rules once, preview what they would do, then apply. Existing allocations are never touched, and any run can be undone.')),
      h('div', { class: 'btn-row tight' },
        h('button', { class: 'btn danger-ghost', type: 'button', onclick: () => openClear() }, 'Clear allocations…'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => openEditor(AU.newRule(), true) }, 'New rule'))),
      M.classes.length && M.resByKey.size ? null : h('p', { class: 'callout warn' }, 'Import your classes and resources first (Data page); auto-allocate needs both.'),
      ruleCards.length ? ruleCards : h('section', { class: 'panel' }, h('h2', null, 'No rules yet'),
        h('p', { class: 'muted' }, 'A rule says which classes it covers, which resources it can hand out, and in what priority order. For example: “Maths classes get Maths-faculty laptops, Year 11 first, then Mr Adams, then Year 8”.')),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Run history'), h('p', { class: 'muted' }, 'Undo removes the allocations a run made that are still in place; ones you have since moved or removed are left alone.'))), runTable)));
  }

  async function deleteRule(r) {
    if (!(await U.confirm(`Delete the rule “${r.name}”? Allocations it already made are not affected.`, { ok: 'Delete rule', danger: true }))) return;
    try { await M.deleteRule(r.id); renderHome(); } catch (e) { toast(e.message, 'error'); }
  }

  async function undo(run) {
    const st = M.runStatus(run);
    const clr = run.kind === 'clear';
    const msg = clr
      ? `Put back the ${st.inPlace} allocation(s) removed by this clear (${U.fmtDateTime(run.at)})?${st.inPlace < st.total ? ` ${st.total - st.inPlace} can’t be restored because the resource is now in use at that time, or the class or resource is gone.` : ''}`
      : `Remove the ${st.inPlace} allocation(s) from “${run.ruleName}” (${U.fmtDateTime(run.at)}) that are still in place?${st.inPlace < st.total ? ` ${st.total - st.inPlace} have already been changed and will be left alone.` : ''}${run.removed && run.removed.length ? ` The ${run.removed.length} existing allocation(s) this run replaced will be put back where possible.` : ''}`;
    if (!(await U.confirm(msg, { ok: clr ? 'Restore' : 'Undo run', title: clr ? 'Restore cleared allocations?' : 'Undo this run?' }))) return;
    const bar = progressModal(clr ? 'Restoring…' : 'Undoing…');
    try {
      const r = await M.undoRun(run.id, bar.update);
      bar.close();
      toast(r.restored ? `Restored ${r.removed} allocation(s).` : `Removed ${r.removed} allocation(s)` + (r.restoredCount ? ` and put back ${r.restoredCount} it had replaced.` : '.'), 'success');
    } catch (e) { bar.close(); toast(e.message, 'error'); }
    renderHome();
  }

  // ====================== CLEAR ALLOCATIONS ======================
  function openClear(prefill) {
    S.clear = AU.newClearSpec();
    if (prefill) for (const k of Object.keys(prefill)) if (prefill[k] && prefill[k].length) S.clear.scope[k] = prefill[k].slice();
    S.view = 'clear';
    render();
  }

  function renderClear() {
    const host = S.host, spec = S.clear;
    clear(host);
    const countEl = h('p', { class: 'clear-count' });
    const listEl = h('div');
    const goBtn = h('button', { class: 'btn danger', type: 'button', onclick: () => confirmClear() }, 'Clear');

    const refresh = () => {
      const targets = AU.clearTargets(spec);
      const everything = AU.clearsEverything(spec);
      const classes = new Set(targets.map((a) => a.classKey)).size;
      clear(countEl);
      countEl.append(...[h('strong', null, String(targets.length)), ` of ${M.allocs.length} allocation${M.allocs.length === 1 ? '' : 's'} will be removed` + (targets.length ? ` (${classes} class slot${classes === 1 ? '' : 's'})` : '') + '.',
        everything && M.allocs.length ? h('span', { class: 'warn-text' }, '  This is everything.') : null].filter(Boolean));
      goBtn.disabled = !targets.length;
      goBtn.textContent = targets.length ? `Clear ${targets.length} allocation${targets.length === 1 ? '' : 's'}` : 'Nothing to clear';
      clear(listEl);
      if (targets.length) {
        const rows = targets.slice().sort((a, b) => {
          const x = M.classByKey.get(a.classKey), y = M.classByKey.get(b.classKey);
          return x && y ? lessonCmpC(x, y) : x ? -1 : 1;
        });
        listEl.append(h('h3', { class: 'sec' }, `What will be removed${targets.length > 100 ? ' (first 100)' : ''}`),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, ['Class', 'Lesson', 'Teacher', 'Resource', 'Allocated by'].map((c) => h('th', null, c)))),
            h('tbody', null, rows.slice(0, 100).map((a) => {
              const c = M.classByKey.get(a.classKey), r = M.resByKey.get(a.resKey);
              return h('tr', null, h('td', null, c ? c.name : '(class no longer in list)'), h('td', null, c ? lessonLabel(c) : ''), h('td', null, c ? c.teacher : ''),
                h('td', null, r ? r.name : '(resource no longer in list)'), h('td', null, a.by || ''));
            })))));
      }
    };

    async function confirmClear() {
      const targets = AU.clearTargets(spec);
      if (!targets.length) return;
      const everything = AU.clearsEverything(spec);
      let ok;
      if (everything) {
        const typed = h('input', { type: 'text', placeholder: 'CLEAR', autocomplete: 'off' });
        ok = await new Promise((resolve) => {
          let done = false;
          const fin = (v) => { if (!done) { done = true; resolve(v); } };
          U.modal({ title: 'Clear ALL allocations?', onClose: () => fin(false),
            body: h('div', { class: 'stack' }, h('p', null, `This removes all ${targets.length} allocations in the system. You will be able to restore them from the run history, but only until resources are re-used.`),
              U.field('Type CLEAR to confirm', typed)),
            actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Clear everything', kind: 'danger', onClick: () => { if (typed.value.trim().toUpperCase() !== 'CLEAR') { toast('Type CLEAR to confirm.', 'error'); return false; } fin(true); } }] });
        });
      } else {
        ok = await U.confirm(`Remove ${targets.length} allocation(s)?\n${AU.describeClear(spec)}\n\nYou can restore them afterwards from the run history.`, { ok: 'Clear allocations', danger: true, title: 'Clear allocations?' });
      }
      if (!ok) return;
      const bar = progressModal('Clearing…');
      try {
        const r = await AU.clear(spec, bar.update);
        bar.close();
        toast(`Cleared ${r.removed} allocation(s). Restore is in the run history.`, 'success', 6000);
        S.view = 'home';
      } catch (e) { bar.close(); toast(e.message || String(e), 'error'); }
      render();
    }

    const mp = (arr, key, options, addLabel) => multiPick({ options, addLabel, emptyText: 'Any', onChange: refresh, get: () => arr[key], set: (v) => { arr[key] = v; } });
    const madeBy = h('select', { 'aria-label': 'Allocated by', onchange: (e) => { spec.madeBy = e.target.value; refresh(); } },
      [['all', 'Any allocation'], ['auto', 'Only ones made by auto-allocate'], ['manual', 'Only ones made by hand']].map(([v, t]) => h('option', { value: v, selected: v === spec.madeBy }, t)));

    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Clear allocations'),
        h('p', { class: 'muted' }, 'Choose what to clear. Leave everything empty to clear all allocations. Only matching allocations are removed, and you can restore them afterwards.')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.view = 'home'; render(); } }, '← Back')),
      h('section', { class: 'panel' },
        h('div', null, h('h2', null, 'Classes'), h('p', { class: 'muted' }, 'Clear allocations on classes matching all of these (empty box = any).')),
        scopeControls(spec.scope, refresh)),
      h('section', { class: 'panel' },
        h('div', null, h('h2', null, 'Resources'), h('p', { class: 'muted' }, 'Optionally clear only certain resources. Leave all boxes empty for any resource.')),
        poolControls(spec, { onChange: refresh, emptyMeansAll: true }),
        h('div', { class: 'form-grid' }, U.field('Made by', madeBy))),
      h('section', { class: 'panel danger-panel' }, countEl, h('div', { class: 'btn-row tight' }, goBtn), listEl)));
    refresh();
  }

  function progressModal(title) {
    const fill = h('div', { class: 'bar-fill' });
    const label = h('p', { class: 'muted' }, 'Working…');
    const api = U.modal({ title, dismissible: false, body: h('div', { class: 'stack' }, h('div', { class: 'bar' }, fill), label) });
    api.update = (done, total) => { fill.style.width = Math.round((done / total) * 100) + '%'; label.textContent = `${done} of ${total}`; };
    return api;
  }

  // ====================== EDITOR ======================
  function openEditor(rule, isNew) {
    S.draft = AU.normaliseRule(clone(rule));
    draftIsNew = isNew;
    S.view = 'edit';
    render();
  }

  function renderEditor() {
    const host = S.host, d = S.draft;
    clear(host);
    const field = U.field;

    const mp = (arr, key, options, addLabel, emptyText) => multiPick({ options, addLabel, emptyText, get: () => arr[key], set: (v) => { arr[key] = v; } });
    const opt = (list) => list.map((x) => [x, x]);

    // --- scope
    const scopePanel = h('section', { class: 'panel' },
      h('div', null, h('h2', null, '1 · Which classes?'), h('p', { class: 'muted' }, 'The rule only considers these classes. Leave a box empty for “any”.')),
      scopeControls(d.scope));

    // --- pool
    const poolPanel = h('section', { class: 'panel' },
      h('div', null, h('h2', null, '2 · Which resources can be handed out? (the pool)'),
        h('p', { class: 'muted' }, 'Choose what can be given out. Within one box any choice counts (Laptops or Chromebooks); how the boxes combine is set below.')),
      poolControls(d));

    // --- faculty limit + extras
    const named = h('select', { 'aria-label': 'Faculty the resources must come from', disabled: d.facultyMode !== 'named', onchange: (e) => { d.facultyNamed = e.target.value; } },
      [h('option', { value: '' }, 'Choose a faculty…'), ...M.resFaculties.map((f) => h('option', { value: f, selected: f === d.facultyNamed }, f))]);
    const strict = h('input', { type: 'checkbox', checked: d.strictFaculty, disabled: d.facultyMode === 'none' || d.facultyMode === 'prefer', onchange: (e) => { d.strictFaculty = e.target.checked; } });
    const facRadio = (v, text) => h('label', { class: 'check radio' }, h('input', { type: 'radio', name: 'facmode', value: v, checked: d.facultyMode === v,
      onchange: () => { d.facultyMode = v; named.disabled = v !== 'named'; strict.disabled = v === 'none' || v === 'prefer'; } }), text);
    const facPanel = h('section', { class: 'panel' },
      h('div', null, h('h2', null, '3 · Faculty limit'), h('p', { class: 'muted' }, 'Optionally restrict the pool by who owns each resource.')),
      h('div', { class: 'radio-col' },
        facRadio('none', 'No limit: any resource in the pool'),
        facRadio('own', 'Only resources owned by the same faculty as the class (e.g. Maths classes get Maths resources)'),
        h('div', { class: 'inline' }, facRadio('named', 'Only resources owned by this faculty:'), named),
        facRadio('prefer', 'Prefer the class’s own faculty’s resources, but use others if they run out')),
      h('label', { class: 'check' }, strict, 'Strictly the faculty’s own items: don’t use shared items that have no faculty as a fallback'),
      h('div', { class: 'form-grid' },
        field('Keep spare', numInput(d.spare, (v) => { d.spare = v; }), 'Resources to leave free in the bank in every lesson (0 = none).'),
        h('label', { class: 'check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: d.sameItem, onchange: (e) => { d.sameItem = e.target.checked; } }), 'Prefer giving a class the same item every lesson'),
        h('label', { class: 'check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: d.usePrefs !== false, onchange: (e) => { d.usePrefs = e.target.checked; } }),
          'Give teachers their usual resource first (see Preferences). Only resources in the pool above are used.')));

    // --- steps
    const stepsHost = h('div', { class: 'steps' });
    const drawSteps = () => {
      clear(stepsHost);
      d.steps.forEach((s, i) => {
        const fl = (key, options, addLabel) => field(AU.FILTER_LABELS[key], multiPick({ options, addLabel, get: () => s.filter[key], set: (v) => { s.filter[key] = v; } }));
        const filters = h('div', { class: 'form-grid' + (s.everyoneElse ? ' dim' : '') },
          fl('years', opt(M.years), 'Add year'), fl('subjects', opt(M.subjects), 'Add subject'), fl('teachers', opt(M.teachers), 'Add teacher'),
          fl('faculties', opt(M.faculties), 'Add faculty'), fl('rooms', opt(M.rooms), 'Add room'),
          fl('classes', opt([...new Set(M.classes.map((c) => c.name))].sort(U.natCmp)), 'Add class'));
        const all = h('input', { type: 'checkbox', checked: s.all, onchange: (e) => { s.all = e.target.checked; qty.disabled = s.all; } });
        const qty = numInput(s.qty, (v) => { s.qty = v; }, { disabled: s.all, 'aria-label': 'Resources per class', min: '1' });
        const every = h('input', { type: 'checkbox', checked: s.everyoneElse, onchange: (e) => { s.everyoneElse = e.target.checked; drawSteps(); } });
        stepsHost.appendChild(h('div', { class: 'step-card' },
          h('div', { class: 'step-head' },
            h('span', { class: 'step-no' }, String(i + 1)),
            h('input', { type: 'text', class: 'step-label', placeholder: 'Name this step (optional), e.g. “Year 11 first”', value: s.label, oninput: (e) => { s.label = e.target.value; } }),
            h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': 'Move up', onclick: () => { [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; drawSteps(); } }, '↑'),
            h('button', { class: 'btn ghost small', type: 'button', disabled: i === d.steps.length - 1, 'aria-label': 'Move down', onclick: () => { [d.steps[i + 1], d.steps[i]] = [d.steps[i], d.steps[i + 1]]; drawSteps(); } }, '↓'),
            h('button', { class: 'btn danger-ghost small', type: 'button', disabled: d.steps.length === 1, onclick: () => { d.steps.splice(i, 1); drawSteps(); } }, 'Remove')),
          h('label', { class: 'check' }, every, 'Everyone else in scope (all classes not matched by an earlier step)'),
          filters,
          h('div', { class: 'step-nums' },
            h('div', { class: 'inline' }, h('span', { class: 'field-label' }, 'Resources per class'), qty, h('label', { class: 'check' }, all, 'as many as are free')),
            h('div', { class: 'inline' }, h('span', { class: 'field-label' }, 'Max lessons per class per week'), numInput(s.maxPerWeek, (v) => { s.maxPerWeek = v; }, { 'aria-label': 'Max lessons per class per week' }), h('span', { class: 'muted small' }, '0 = no limit')))));
      });
    };
    drawSteps();
    const stepsPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', null, h('h2', null, '4 · Priority steps'),
        h('p', { class: 'muted' }, 'Step 1 gets first pick of every lesson, step 2 gets what is left, and so on. A class belongs to the first step it matches. Resources nobody is given stay in the bank.')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { d.steps.push(AU.newStep()); drawSteps(); } }, 'Add step')),
      stepsHost);

    const name = h('input', { type: 'text', value: d.name, placeholder: 'e.g. Maths laptops, Term 1', maxlength: '80', oninput: (e) => { d.name = e.target.value; } });
    const problems = h('div', { class: 'callout warn', hidden: true });
    const check = () => {
      const p = AU.validate(d);
      problems.hidden = !p.length;
      clear(problems);
      p.forEach((t) => problems.appendChild(h('div', null, t)));
      return !p.length;
    };
    const save = async (thenPreview) => {
      if (!check()) return;
      try {
        const saved = await M.saveRule(d);
        d.id = saved.id; d.createdAt = saved.createdAt; d.createdBy = saved.createdBy;
        toast('Rule saved.', 'success', 1800);
        if (thenPreview) startPreview(AU.normaliseRule(clone(saved)), true); else { S.view = 'home'; render(); }
      } catch (e) { toast(e.message, 'error'); }
    };

    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, draftIsNew && !d.id ? 'New rule' : 'Edit rule'),
        h('div', { class: 'btn-row tight' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.view = 'home'; render(); } }, 'Cancel'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => save(false) }, 'Save'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => save(true) }, 'Save & preview'))),
      h('section', { class: 'panel' }, field('Rule name', name)),
      scopePanel, poolPanel, facPanel, stepsPanel, problems));
  }

  // ====================== PREVIEW ======================
  function startPreview(rule, fromEditor) {
    const problems = AU.validate(rule);
    if (problems.length) { toast(problems[0], 'error'); return; }
    S.plan = AU.plan(rule);
    S.plan.fromEditor = !!fromEditor;
    S.fixUndo = null;
    S.view = 'preview';
    S.tab = 'summary';
    S.week = 'A';
    render();
  }

  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '0%');

  function renderPreview() {
    const host = S.host, plan = S.plan;
    const stepName = (i) => plan.steps[i].name;
    const cls = (k) => M.classByKey.get(k);
    const resOf = (k) => M.resByKey.get(k);
    const stat = (n, label, kind = '') => h('div', { class: 'stat ' + kind }, h('strong', null, String(n)), h('span', null, label));
    const tally = AU.tally(plan);   // red = lessons with nothing at all; orange = has a resource but short, or covered only from outside the pool
    const unmetLessons = tally.red;
    const nRemoved = plan.removed.length;

    const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['summary', 'Summary'], ['changes', `Changes (${plan.placements.length})`], ['unmet', `Unmet demand (${plan.unmet.length})`], ['grid', 'Timetable preview']].map(([k, t]) =>
      h('button', { class: 'tab' + (S.tab === k ? ' on' : ''), type: 'button', role: 'tab', onclick: () => { S.tab = k; renderPreview(); } }, t)));

    let body;
    if (S.tab === 'summary') {
      // explain anything that looks wrong, in plain English
      const facts = plan.scopeFacts;
      const some = (a) => (a.length > 10 ? a.slice(0, 10).join(', ') + ` … (+${a.length - 10})` : a.join(', ')) || 'none';
      const factsText = `In the lessons in scope: Year groups: ${some(facts.years)}. Teachers: ${some(facts.teachers)}. Subjects: ${some(facts.subjects)}. Faculties: ${some(facts.faculties)}.`;
      const notes = [];
      if (!plan.scopeLessons) notes.push(['warn', 'No lessons are in scope, so nothing can be allocated. The “Which classes?” filters match no classes. Check each box is spelled as it is in your class data (a class must match every box you filled in).']);
      if (!plan.poolSize) notes.push(['warn', 'The pool is empty, so there is nothing to hand out. In “Which resources can be handed out?” choose at least one type, faculty or item that exists.']);
      plan.steps.forEach((s, i) => {
        if (plan.scopeLessons && s.lessons === 0) {
          notes.push(['warn', `Step ${i + 1} matches no lessons. Its filter (${AU.describeFilter(plan.rule.steps[i].filter, plan.rule.steps[i].everyoneElse)}) finds nothing among the ${plan.scopeLessons} lessons in scope. It may also be that an earlier step already took them, because a lesson belongs to the first step it matches. ${factsText}`]);
        }
      });
      if (plan.unassigned) notes.push(['', `${plan.unassigned} of ${plan.scopeLessons} lessons in scope are not covered by any step, so this rule leaves them alone. That is normal if you only want certain classes handled. To include them, add a final step and tick “Everyone else in scope”.`]);
      if (plan.scopeLessons && plan.poolSize && !plan.placements.length) {
        const why = new Map();
        plan.unmet.forEach((u) => why.set(u.reason, (why.get(u.reason) || 0) + 1));
        const had = plan.steps.reduce((n, s) => n + s.alreadyOk, 0);
        const bits = [...why.entries()].map(([r, n]) => `${n} lesson${n > 1 ? 's' : ''}: ${r}`);
        if (had) bits.push(`${had} lesson${had > 1 ? 's' : ''} already have what the step asks for`);
        notes.push(['warn', 'Nothing would be allocated. ' + (bits.length ? 'Reasons: ' + bits.join('; ') + '.' : 'No lesson in scope is matched by a step (see above).')]);
      }
      const pt = AU.prefTally(plan);
      const prefBlock = plan.prefLessons && plan.prefLessons.length ? h('div', { class: 'stack' },
        h('h3', { class: 'sec' }, `Teachers’ usual resources: ${pt.got.length} of ${plan.prefLessons.length} lesson${plan.prefLessons.length === 1 ? '' : 's'} get${plan.prefLessons.length === 1 ? 's' : ''} the usual one`),
        pt.missed.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Teacher', 'Class', 'Lesson', 'Usual resource', 'Why not'].map((c) => h('th', null, c)))),
          h('tbody', null, pt.missed.slice(0, 300).map((m) => { const c = cls(m.classKey);
            return h('tr', null, h('td', null, m.teacher), h('td', null, c.name), h('td', null, lessonLabel(c)), h('td', null, m.items.map((k) => resOf(k).name).join(' / ')), h('td', null, m.reason)); }))))
          : h('p', { class: 'muted' }, 'Every teacher with a usual resource keeps it in every lesson in scope.')) : null;
      body = h('div', { class: 'stack' },
        ...notes.map(([kind, text]) => h('p', { class: 'callout' + (kind ? ' ' + kind : '') }, text)),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Step', 'Lessons', 'Allocated', 'Fully served', 'Part-served', 'Nothing free', 'Already covered'].map((c) => h('th', { title: c === 'Already covered' ? 'Lessons that already had what the step asks for, or were given their teacher’s usual resource' : null }, c)))),
          h('tbody', null, plan.steps.map((s) => h('tr', null, h('td', null, s.name), h('td', null, String(s.lessons)), h('td', null, h('strong', null, String(s.placed))),
            h('td', null, String(s.served)), h('td', null, String(s.partial)), h('td', null, String(s.unmet)), h('td', null, String(s.alreadyOk))))))),
        prefBlock,
        h('p', { class: 'muted' }, `Pool: ${plan.poolSize} resource(s). Their lesson-slots in use go from ${pct(plan.usedBefore, plan.capacity)} to ${pct(plan.usedAfter, plan.capacity)}; the rest stays in the bank.`));
    } else if (S.tab === 'changes') {
      const rows = plan.placements.slice().sort((a, b) => a.step - b.step || lessonCmpC(cls(a.classKey), cls(b.classKey)));
      body = rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Step', 'Class', 'Year', 'Lesson', 'Teacher', 'Resource', ''].map((c) => h('th', null, c)))),
        h('tbody', null, rows.slice(0, 600).map((p) => {
          const c = cls(p.classKey), r = resOf(p.resKey), inPool = plan.poolKeys.includes(p.resKey);
          return h('tr', null, h('td', null, p.step < 0 ? 'Manual' : String(p.step + 1)), h('td', null, c.name), h('td', null, c.year || ''), h('td', null, lessonLabel(c)), h('td', null, c.teacher), h('td', null, r.name),
            h('td', null, p.manual ? h('span', { class: 'pill' }, inPool ? 'added by you' : 'added by you, outside pool') : p.pref ? h('span', { class: 'pill' }, 'usual resource') : null));
        }))))
        : h('p', { class: 'empty-note' }, 'This rule would not allocate anything.');
      if (rows.length > 600) body = h('div', null, body, h('p', { class: 'muted' }, `Showing the first 600 of ${rows.length}.`));
      if (plan.removed.length) {
        body = h('div', { class: 'stack' }, body,
          h('h3', { class: 'sec' }, `Existing allocations that will be removed when you apply (${plan.removed.length})`),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, ['Class', 'Lesson', 'Teacher', 'Resource', 'Was allocated by', ''].map((c) => h('th', null, c)))),
            h('tbody', null, plan.removed.map((rm) => {
              const c = cls(rm.classKey), r = resOf(rm.resKey);
              return h('tr', null, h('td', null, c.name), h('td', null, lessonLabel(c)), h('td', null, c.teacher), h('td', null, r.name), h('td', null, rm.by || ''),
                h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { AU.keepExisting(plan, rm.resKey, rm.classKey); renderPreview(); } }, 'Keep it')));
            })))));
      }
    } else if (S.tab === 'unmet') {
      body = plan.unmet.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Step', 'Class', 'Lesson', 'Teacher', 'Wanted', 'Got', 'Why'].map((c) => h('th', null, c)))),
        h('tbody', null, plan.unmet.slice(0, 600).map((u) => { const c = cls(u.classKey); return h('tr', null, h('td', null, String(u.step + 1)), h('td', null, c.name), h('td', null, lessonLabel(c)), h('td', null, c.teacher), h('td', null, String(u.wanted)), h('td', null, String(u.got)), h('td', null, u.reason)); }))))
        : h('p', { class: 'empty-note' }, 'Every class in scope gets everything its step asks for.');
    } else {
      body = gridPreview(plan);
    }

    // The header buttons are always the same, and "changes by you" lives in its own fixed-height strip, so adding or
    // removing a resource never moves anything else on the page.
    const editBar = h('div', { class: 'edit-bar' },
      plan.edits ? h('span', { class: 'pill edits' }, `${plan.edits} change${plan.edits === 1 ? '' : 's'} by you`)
        : h('span', { class: 'muted small' }, 'No changes by you yet. Click any lesson in the Timetable preview to adjust it.'),
      h('span', { class: 'spacer' }),
      S.fixUndo ? h('button', { class: 'btn ghost small', type: 'button', onclick: undoAutoFix }, 'Undo auto-fix') : null,
      plan.edits ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        if (!(await U.confirm('Throw away your changes and re-run the rule from scratch?', { ok: 'Reset changes', title: 'Reset changes?' }))) return;
        const fe = plan.fromEditor; S.plan = AU.plan(plan.rule); S.plan.fromEditor = fe; S.fixUndo = null; renderPreview();
      } }, 'Reset changes') : null);

    const view = host.closest('.view') || host;
    const keepTop = view.scrollTop, oldGrid = host.querySelector('.tt-wrap'), keepLeft = oldGrid ? oldGrid.scrollLeft : 0;
    clear(host);
    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Preview: ' + plan.rule.name), h('p', { class: 'muted' }, 'Nothing is saved until you press Apply.')),
        h('div', { class: 'btn-row tight' },
          h('button', { class: 'btn ghost', type: 'button', disabled: !plan.unmet.length, title: plan.unmet.length ? 'Fill the short lessons from what is free' : 'No lessons are short', onclick: openAutoFix }, 'Auto-fix short lessons…'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { if (plan.fromEditor) { S.draft = AU.normaliseRule(clone(plan.rule)); S.view = 'edit'; } else S.view = 'home'; render(); } }, plan.fromEditor ? '← Back to rule' : 'Close'),
          h('button', { class: 'btn primary apply-btn', type: 'button', disabled: !plan.placements.length && !nRemoved, onclick: () => applyPlan() },
            `Apply ${plan.placements.length} allocation${plan.placements.length === 1 ? '' : 's'}${nRemoved ? ` + remove ${nRemoved}` : ''}`))),
      h('div', { class: 'stats' }, stat(plan.placements.length, 'to allocate', 'ok'), stat(plan.scopeLessons, 'lessons in scope'),
        nRemoved ? stat(nRemoved, 'existing to remove', 'warn') : null,
        stat(unmetLessons, 'lessons with no resource at all', unmetLessons ? 'bad' : ''), stat(tally.orange, 'orange: short of the rule, or covered from outside the pool', tally.orange ? 'warn' : '')),
      editBar, tabs, body));
    view.scrollTop = keepTop;
    const newGrid = host.querySelector('.tt-wrap');
    if (newGrid) newGrid.scrollLeft = keepLeft;
  }

  function lessonCmpC(a, b) {
    return U.DAYS.indexOf(a.day) - U.DAYS.indexOf(b.day) || U.natCmp(a.pkey, b.pkey) || U.natCmp(a.week, b.week) || U.natCmp(a.name, b.name);
  }

  // ---------- auto-fix: fill every short lesson from what is free ----------
  function openAutoFix() {
    const plan = S.plan;
    const o = { include: 'red', typesMode: 'pool', types: [], preferFaculty: true, facultyOnly: false };
    const nRed = plan.unmet.filter((u) => AU.isRed(plan, u)).length, nAmber = plan.unmet.length - nRed;
    const poolTypeNames = [...new Set(plan.poolKeys.map((k) => (M.resByKey.get(k) || {}).typeName).filter(Boolean))];
    const uid = Math.random().toString(36).slice(2, 7);
    const radio = (group, key, v, text, extra) => h('label', { class: 'check radio' },
      h('input', { type: 'radio', name: group + uid, value: v, checked: o[key] === v, onchange: () => { o[key] = v; } }), text, extra || null);
    const typePick = multiPick({ options: M.types.map((t) => [t.id, t.name]), addLabel: 'Add type', emptyText: 'Choose types', get: () => o.types,
      set: (v) => { o.types = v; const el = document.querySelector(`input[name="typ${uid}"][value="chosen"]`); if (el && !el.checked) el.click(); } });
    const body = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Fills short lessons in one go. Pool resources that are free are used first, then resources outside the pool. You can review and change everything afterwards, or undo the auto-fix.'),
      h('div', null, h('div', { class: 'field-label' }, 'Which lessons'),
        h('div', { class: 'radio-col' }, radio('inc', 'include', 'red', `Red lessons only: no resource at all (${nRed})`),
          radio('inc', 'include', 'all', `Red and orange lessons: also ones that have some resource but are short (${nRed + nAmber})`))),
      h('div', null, h('div', { class: 'field-label' }, 'Which resources may be used'),
        h('div', { class: 'radio-col' },
          radio('typ', 'typesMode', 'pool', `Same types as the pool (${poolTypeNames.join(', ') || 'none'}). A laptop need is never filled with a projector.`),
          radio('typ', 'typesMode', 'chosen', 'Only these types:'), typePick,
          radio('typ', 'typesMode', 'any', 'Any free resource'))),
      h('div', { class: 'radio-col' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.preferFaculty, onchange: (e) => { o.preferFaculty = e.target.checked; } }), 'Prefer the class’s own faculty’s resources, then shared ones, then others'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.facultyOnly, onchange: (e) => { o.facultyOnly = e.target.checked; } }), 'Only the class’s own faculty’s resources or shared ones (no faculty)')));
    U.modal({ title: 'Auto-fix short lessons', body, actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Auto-fix', kind: 'primary', onClick: () => {
        if (o.typesMode === 'chosen' && !o.types.length) { toast('Choose at least one type, or pick another option.', 'error'); return false; }
        const snap = plan.placements.map((p) => ({ ...p })), edits = plan.edits;
        const r = AU.autoFix(plan, o);
        if (!r.targets) { toast('There are no short lessons to fix.', 'info'); return; }
        if (!r.added) { toast('Nothing suitable is free for those lessons. Try “Any free resource”, or free something up.', 'error', 8000); return; }
        S.fixUndo = { placements: snap, edits };
        toast(`Fixed ${r.fixed} of ${r.targets} short lesson${r.targets === 1 ? '' : 's'} by adding ${r.added} resource${r.added === 1 ? '' : 's'}${r.outside ? ` (${r.outside} from outside the pool)` : ''}.`
          + (r.still ? ` ${r.still} still short: nothing suitable is free.` : ''), r.still ? 'info' : 'success', 8000);
        renderPreview();
      } }] });
  }

  function undoAutoFix() {
    const plan = S.plan, u = S.fixUndo;
    if (!u) return;
    plan.placements = u.placements;
    plan.edits = u.edits;
    AU.refreshPlan(plan);
    S.fixUndo = null;
    renderPreview();
  }

  // ---------- adjusting one lesson in the preview ----------
  // Remove a proposed resource, take one from another class, or hand out ANY free resource (inside or outside the pool).
  function openLesson(classKey) {
    const c0 = M.classByKey.get(classKey);
    if (!c0) return;
    S.lessonTab = null; S.lessonQ = '';
    const api = U.modal({ title: 'Adjust lesson', body: h('div'), wide: true, actions: [{ label: 'Done', kind: 'primary' }] });
    // `after` = something changed (refresh the grid behind and this panel); `redraw` = only this panel (e.g. switching tab)
    const draw = () => api.setBody(lessonBody(classKey, () => { S.fixUndo = null; renderPreview(); draw(); }, draw));
    draw();
  }

  function lessonBody(classKey, after, redraw) {
    const plan = S.plan, c = M.classByKey.get(classKey);
    const poolSet = new Set(plan.poolKeys);
    const tag = (r, extra = '') => h('span', { class: 'chip', dataset: { t: String(M.typeColour(r.typeId)) } }, h('span', { class: 'chip-dot' }), h('span', { class: 'chip-name' }, r.name + extra));
    // shows an error toast for a non-empty message; true when the edit succeeded
    const succeeded = (msg) => { if (msg) toast(msg, 'error'); return !msg; };

    // status
    const cl = AU.classify(plan, classKey);
    const pr = cl.u;                       // the lesson's unmet entry, if it is short
    const dem = plan.demand.find((d) => d.classKey === classKey);
    const mine = plan.placements.filter((p) => p.classKey === classKey);
    const hadNames = AU.existingNames(plan, classKey);
    let status;
    if (cl.state === 'red') status = h('p', { class: 'callout bad' }, 'This lesson cannot get a resource: ' + cl.u.reason + '.');
    else if (cl.kind === 'short') status = h('p', { class: 'callout warn' }, cl.u.got === 0
      ? `The rule could not give this lesson one (${cl.u.reason}), but it already has ${hadNames.join(', ') || 'a resource'}, which may not be one of the rule’s scoped resources, so it is not left empty.`
      : 'Only part-served: ' + cl.u.reason + '.');
    else if (cl.kind === 'outside') status = h('p', { class: 'callout warn' }, `This lesson is covered by ${cl.out.map((p) => M.resByKey.get(p.resKey).name).join(', ')}, which ${cl.out.length === 1 ? 'is' : 'are'} outside the rule’s pool and added by you, standing in for what the rule would have given it.`);
    else if (dem || mine.length) status = h('p', { class: 'callout' }, `This lesson will get ${mine.length} resource${mine.length === 1 ? '' : 's'} from this run.`);
    else if ((plan.unassignedKeys || []).includes(classKey)) status = h('p', { class: 'callout' }, 'No step covers this lesson, so the rule leaves it alone. You can still add a resource by hand below.');
    else status = h('p', { class: 'callout' }, 'This lesson already has what its step asks for.');

    // the teacher's usual resource, if this lesson's teacher has one that applies to this rule
    let prefNote = null;
    const pe = (plan.prefLessons || []).find((e) => e.classKey === classKey);
    if (pe) {
      const tl = AU.prefTally(plan), names = pe.items.map((k) => M.resByKey.get(k).name).join(' / ');
      const hit = tl.got.find((e) => e.classKey === classKey), miss = tl.missed.find((e) => e.classKey === classKey);
      prefNote = hit ? h('p', { class: 'callout' }, `${pe.teacher}’s usual resource (${names}): this lesson has ${M.resByKey.get(hit.hit).name}.`)
        : h('p', { class: 'callout warn' }, `${pe.teacher}’s usual resource (${names}) is not on this lesson: ${miss.reason}. You can give it by hand below or take it from the lesson that has it.`);
    }

    // what it has / will have. Existing allocations can be removed here: that is staged, and only happens when you Apply.
    const existing = M.resourcesOfClass(classKey).filter((x) => x.res);
    const haveList = h('div', { class: 'lesson-chips' },
      ...existing.map(({ res }) => {
        const gone = AU.isRemoved(plan, res.key, classKey);
        return h('span', { class: 'lesson-item' + (gone ? ' removed' : '') }, tag(res),
          h('span', { class: 'muted small' }, gone ? 'will be removed when you apply' : poolSet.has(res.key) ? 'already allocated' : 'already allocated (outside pool)'),
          gone
            ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { AU.keepExisting(plan, res.key, classKey); after(); } }, 'Keep it')
            : h('button', { class: 'btn danger-ghost small', type: 'button', title: 'Removed when you press Apply (and put back if you undo the run)', onclick: () => { AU.removeExisting(plan, res.key, classKey); after(); } }, 'Remove'));
      }),
      ...mine.map((p) => { const r = M.resByKey.get(p.resKey); return h('span', { class: 'lesson-item' }, tag(r, p.manual ? ' ✎' : ''),
        h('span', { class: 'muted small' }, p.manual ? (poolSet.has(p.resKey) ? 'added by you' : 'added by you, outside the pool') : p.pref ? 'proposed: the teacher’s usual resource' : 'proposed'),
        h('button', { class: 'btn danger-ghost small', type: 'button', onclick: () => { AU.removePlacement(plan, p.resKey, classKey); after(); } }, 'Remove')); }));
    const none = !existing.length && !mine.length;

    // what is holding the pool in this lesson
    const holders = AU.holders(plan, classKey);
    const holdTable = holders.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Resource', 'In use by', 'Teacher', 'Status', ''].map((x) => h('th', null, x)))),
      h('tbody', null, holders.map((hd) => h('tr', null,
        h('td', null, hd.res.name), h('td', null, hd.holder.name), h('td', null, hd.holder.teacher || ''),
        h('td', null, hd.kind === 'existing' ? 'already allocated' : hd.kind === 'manual' ? 'added by you' : 'proposed in this run'),
        h('td', { class: 'actions' }, hd.kind === 'existing'
          ? h('button', { class: 'btn ghost small', type: 'button', title: `Removes ${hd.res.name} from ${hd.holder.name} when you press Apply, and gives it to this lesson`, onclick: () => {
            AU.removeExisting(plan, hd.res.key, hd.holder.key);
            if (!succeeded(AU.addPlacement(plan, hd.res.key, classKey))) AU.keepExisting(plan, hd.res.key, hd.holder.key);
            after();
          } }, 'Take it')
          : h('button', { class: 'btn ghost small', type: 'button', onclick: () => { if (succeeded(AU.movePlacement(plan, hd.res.key, hd.holder.key, classKey))) after(); } }, 'Give to this lesson'))))))) : null;

    // add a free resource by hand: two tabs, resources in the pool / outside the pool, each a table like the one above
    const free = AU.freeResources(plan, classKey);
    const inPoolFree = free.filter((f) => f.inPool), outsideFree = free.filter((f) => !f.inPool);
    if (S.lessonTab !== 'pool' && S.lessonTab !== 'outside') S.lessonTab = inPoolFree.length || !outsideFree.length ? 'pool' : 'outside';
    const tab = S.lessonTab;
    const shown = tab === 'pool' ? inPoolFree : outsideFree;
    const tabBtn = (k, label, n) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(tab === k),
      onclick: () => { S.lessonTab = k; redraw(); } }, label, h('span', { class: 'tab-count' }, String(n)));
    const q = h('input', { type: 'search', placeholder: tab === 'pool' ? 'Find a pool resource…' : 'Find a resource outside the pool…', 'aria-label': 'Find a resource', value: S.lessonQ || '' });
    const freeBody = h('div');
    const fillFree = () => {
      S.lessonQ = q.value;
      clear(freeBody);
      const t = U.norm(q.value);
      const rows = shown.filter((f) => !t || U.norm(`${f.res.name} ${f.res.typeName} ${f.res.faculty} ${f.res.location}`).includes(t));
      if (!rows.length) {
        freeBody.appendChild(h('p', { class: 'muted small' }, shown.length
          ? 'No resource matches that search.'
          : tab === 'pool' ? 'No pool resource is free for this whole lesson. They are all in use (see the table above), or this class already has them. Try the “Outside the pool” tab, or free one up by removing it from another class.'
            : 'Nothing outside the pool is free for this whole lesson.'));
        return;
      }
      freeBody.appendChild(h('div', { class: 'tbl-wrap tbl-scroll' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Resource', 'Type', 'Faculty', 'Location', ''].map((x) => h('th', null, x)))),
        h('tbody', null, rows.slice(0, 200).map((f) => h('tr', null,
          h('td', null, f.res.name), h('td', null, f.res.typeName), h('td', null, f.res.faculty || ''), h('td', null, f.res.location || ''),
          h('td', { class: 'actions' }, h('button', { class: 'btn ghost small', type: 'button', title: `Add ${f.res.name} to this lesson`,
            onclick: () => { if (succeeded(AU.addPlacement(plan, f.res.key, classKey))) { toast(`Added ${f.res.name}.`, 'success', 1500); after(); } } }, 'Add'))))))));
      if (rows.length > 200) freeBody.appendChild(h('p', { class: 'muted small' }, `Showing the first 200 of ${rows.length}. Search to narrow them down.`));
    };
    q.addEventListener('input', fillFree);
    fillFree();

    return h('div', { class: 'stack' },
      h('div', null, h('h3', null, c.name, c.year ? h('span', { class: 'tt-yr' }, U.yearShort(c.year)) : null),
        h('p', { class: 'muted' }, [lessonLabel(c), c.teacher, c.room ? '⌂ ' + c.room : ''].filter(Boolean).join('  ·  '))),
      status, prefNote,
      h('div', null, h('h3', { class: 'sec' }, 'Resources on this lesson'), none ? h('p', { class: 'muted' }, 'None yet.') : haveList),
      holders.length ? h('details', { class: 'faq', open: !!pr }, h('summary', null, `What is using the pool in this lesson (${holders.length})`),
        h('div', { class: 'faq-a' }, h('p', { class: 'muted small' }, 'Items proposed by this run can be moved to this lesson. For an item that is already allocated, “Take it” removes it from that class when you apply. Either way the class that loses one will then show as short.'), holdTable)) : null,
      h('details', { class: 'faq', open: true }, h('summary', null, 'Add a resource by hand'),
        h('div', { class: 'faq-a' },
          h('p', { class: 'muted small' }, 'Resources that are free for this whole lesson. “In the pool” shows what the rule could still hand out here (for example after you remove one). “Outside the pool” lets you cover a class with something else.'),
          h('div', { class: 'tabs', role: 'tablist' }, tabBtn('pool', 'In the pool', inPoolFree.length), tabBtn('outside', 'Outside the pool', outsideFree.length)),
          q, freeBody)));
  }

  // timetable of the classes in scope: resources already there are solid, proposed ones are dashed "ghosts"
  function gridPreview(plan) {
    const scope = new Set(plan.scopeKeys);
    const poolKeys = new Set(plan.poolKeys);
    const proposed = new Map();
    for (const p of plan.placements) { if (!proposed.has(p.classKey)) proposed.set(p.classKey, []); proposed.get(p.classKey).push(p); }
    const wk = S.week;
    const cells = new Map();
    for (const c of M.classes) {
      if (!scope.has(c.key) || (c.week !== 'AB' && c.week !== wk)) continue;
      const k = c.day + '|' + c.pkey;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(c);
    }
    // classes that cannot get (all of) what the rule asks for are marked: red = nothing free, amber = only part
    const problem = new Map(plan.unmet.map((u) => [u.classKey, u]));
    // short label for inside the cell; the full reason is in the hover text and on the Unmet demand tab
    const shortWhy = (u) => {
      const r = u.reason || '';
      if (/already in use/.test(r)) return u.got ? `${u.got} of ${u.wanted} only: none free` : 'None free';
      if (/weekly limit/.test(r)) return 'Weekly limit';
      if (/spare/.test(r)) return 'Keeping spares';
      if (/faculty resources in the pool|matching-faculty/.test(r)) return 'No faculty match';
      if (/no resources in the pool/.test(r)) return 'Pool empty';
      if (/already has every resource/.test(r)) return u.got ? `${u.got} of ${u.wanted} only: pool too small` : 'Pool too small';
      return u.got ? `${u.got} of ${u.wanted} only` : 'Nothing free';
    };
    const skipped = new Set(plan.unassignedKeys || []);
    const notUsual = new Set(AU.prefTally(plan).missed.map((m) => m.classKey));      // teacher did not get their usual resource
    const chip = (r, ghost, manual, removed, pref) => h('span', { class: 'tt-chip' + (ghost ? ' ghost' : '') + (manual ? ' manual' : '') + (removed ? ' removed' : ''), title: removed ? 'Will be removed when you apply' : null, dataset: { t: String(M.typeColour(r.typeId)) } }, h('span', { class: 'chip-dot' }), (removed ? '✕ ' : manual ? '✎ ' : pref ? '★ ' : ghost ? '+ ' : '✓ ') + r.name);
    const rows = M.periods.map((p) => h('tr', null, h('th', { class: 'tt-p', scope: 'row' }, h('small', null, 'Period'), h('strong', null, p.label)),
      M.days.map((d) => {
        const list = (cells.get(d + '|' + p.pkey) || []).sort((a, b) => U.natCmp(a.name, b.name));
        return h('td', { class: 'tt-cell' + (list.length ? ' has' : '') }, list.map((c) => {
          // everything the class already has is shown, whether or not it is one of the rule's pool resources
          const have = M.resourcesOfClass(c.key).filter((x) => x.res).map((x) => chip(x.res, false, false, AU.isRemoved(plan, x.res.key, c.key)));
          const add = (proposed.get(c.key) || []).map((pl) => chip(M.resByKey.get(pl.resKey), true, pl.manual, false, pl.pref));
          const cl = AU.classify(plan, c.key);
          const pr = cl.u;
          // red = the lesson would have nothing at all; orange = it has a resource but is short of what the step asks,
          // or is covered only by a resource from outside the pool (standing in for the rule's own)
          // green = has / will have its resource, orange = short or covered from outside the pool, red = nothing at all
          const hasChips = have.length > 0 || add.length > 0;
          const state = cl.state === 'red' ? 'unmet' : cl.state === 'orange' ? 'partial' : hasChips ? 'okay' : skipped.has(c.key) ? 'skipped' : '';
          const hadNames = cl.kind === 'short' && pr.got === 0 ? AU.existingNames(plan, c.key) : [];
          const outNames = cl.kind === 'outside' ? cl.out.map((p) => M.resByKey.get(p.resKey).name) : [];
          const why = cl.state === 'red' ? 'Cannot get a resource: ' + pr.reason
            : cl.kind === 'short' ? (pr.got === 0 ? `The rule could not add one (${pr.reason}), but it already has ${hadNames.join(', ')}, which may not be a scoped resource` : 'Only part-served: ' + pr.reason)
              : cl.kind === 'outside' ? `Covered by ${outNames.join(', ')}, from outside the rule's pool (added by you)`
                : skipped.has(c.key) ? 'Not covered by any step, so the rule leaves this lesson alone' : '';
          return h('div', { class: 'tt-entry clickable' + (state ? ' ' + state : ''), title: (why ? why + '. ' : '') + 'Click to adjust this lesson.', tabindex: '0', role: 'button',
            onclick: () => openLesson(c.key), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLesson(c.key); } } },
            h('strong', null, c.name, c.year ? h('span', { class: 'tt-yr' }, U.yearShort(c.year)) : null),
            c.teacher ? h('span', { class: 'tt-l2' }, c.teacher) : null,
            h('div', { class: 'tt-chips' }, [...have, ...add]),
            state === 'unmet' ? h('span', { class: 'tt-why' }, '✕ ' + shortWhy(pr))
              : state === 'partial' ? h('span', { class: 'tt-why' }, '! ' + (cl.kind === 'outside' ? `Outside pool: ${outNames[0]}${outNames.length > 1 ? ` +${outNames.length - 1}` : ''}`
                : hadNames.length ? `Has ${hadNames[0]}${hadNames.length > 1 ? ` +${hadNames.length - 1}` : ''}, rule added none` : shortWhy(pr))) : null,
            notUsual.has(c.key) ? h('span', { class: 'tt-note' }, '↪ Not their usual resource') : null);
        }));
      })));
    const tally = AU.tally(plan), nUnmet = tally.red, nPartial = tally.orange;
    const legend = h('div', { class: 'tt-legend' },
      h('span', { class: 'lg okay' }, '✓ Green: has or will have its resource'),
      h('span', { class: 'lg unmet' }, `Red: would have no resource at all (${nUnmet})`),
      nPartial ? h('span', { class: 'lg partial' }, `Orange: short of the rule, or covered from outside the pool (${nPartial})`) : null,
      plan.unassigned ? h('span', { class: 'lg skipped' }, `Faded: not covered by any step (${plan.unassigned})`) : null,
      h('span', { class: 'muted small' }, 'Dashed tags are proposed (✎ = added by you, ★ = the teacher’s usual resource); solid tags are already allocated (✕ = will be removed). Click any lesson to see what is blocking it and adjust it.'));
    const seg = h('div', { class: 'seg' }, ['A', 'B'].map((w) => h('button', { class: 'seg-btn' + (S.week === w ? ' on' : ''), type: 'button', onclick: () => { S.week = w; renderPreview(); } }, 'Week ' + w)));
    return h('div', { class: 'stack' }, h('div', { class: 'inline' }, seg), legend,
      h('div', { class: 'tt-wrap pv' }, h('table', { class: 'tt' }, h('thead', null, h('tr', null, h('th', { class: 'tt-corner' }, ''), M.days.map((d) => h('th', null, d)))), h('tbody', null, rows))));
  }

  async function applyPlan() {
    const plan = S.plan;
    const rm = plan.removed.length;
    if (!(await U.confirm(`Allocate ${plan.placements.length} resource(s)${rm ? ` and first remove ${rm} existing allocation${rm === 1 ? '' : 's'} you chose to replace` : ''} now? You can undo this run afterwards from the Run history${rm ? ' (the removed ones are put back too)' : ''}.`, { ok: 'Apply', title: 'Apply “' + plan.rule.name + '”?' }))) return;
    const bar = progressModal('Allocating…');
    try {
      const r = await AU.apply(plan, bar.update);
      bar.close();
      toast(`Allocated ${r.placed} resource(s)` + (r.removed ? ` and removed ${r.removed}` : '') + '.' + (r.skipped ? ` ${r.skipped} skipped because things changed since the preview.` : ''), 'success', 6000);
      S.view = 'home';
    } catch (e) { bar.close(); toast(e.message || String(e), 'error'); }
    render();
  }

  // ====================== entry points ======================
  function render() {
    if (!S.host) return;
    if (S.view === 'edit' && S.draft) renderEditor();
    else if (S.view === 'preview' && S.plan) renderPreview();
    else if (S.view === 'clear' && S.clear) renderClear();
    else { S.view = 'home'; renderHome(); }
    const v = S.host.closest('.view') || S.host;
    v.scrollTop = 0;
  }
  UI.render = (container) => { S.host = container; if (!['edit', 'preview', 'clear'].includes(S.view)) S.view = 'home'; render(); };
  // after a background sync: refresh the lists only when nobody is in the middle of editing
  UI.multiPick = multiPick;    // reused by the shared-resources page
  // used by the Allocate screen's "Clear…" shortcut (prefill = scope lists like { years: [...], subjects: [...] })
  UI.openClear = (prefill) => { openClear(prefill); };
  UI.softRefresh = () => { if (S.host && S.view === 'home') renderHome(); };
  UI.reset = () => { S.view = 'home'; S.draft = null; S.plan = null; S.clear = null; };
})();
