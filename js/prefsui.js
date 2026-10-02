// Preferences page: each teacher's usual resource(s). Every auto-allocate run honours these first.
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const UI = (ER.prefsUi = {});
  const { h, clear, toast } = ER.util;
  const U = ER.util, M = ER.model, A = ER.auth;

  const S = { host: null };
  const isAdmin = () => A.canManageData();
  const tag = (r) => h('span', { class: 'chip', dataset: { t: String(M.typeColour(r.typeId)) } }, h('span', { class: 'chip-dot' }), h('span', { class: 'chip-name' }, r.name));

  // how a teacher's lessons stand right now: with a usual resource / only another one / nothing
  function standing(p) {
    const lessons = M.classes.filter((c) => U.norm(c.teacher) === U.norm(p.teacher));
    let usual = 0, other = 0, none = 0;
    for (const c of lessons) {
      const have = M.resourcesOfClass(c.key).filter((x) => x.res).map((x) => x.res.key);
      if (have.some((k) => p.items.includes(k))) usual++; else if (have.length) other++; else none++;
    }
    return { lessons: lessons.length, usual, other, none };
  }

  // lessons where two teachers who want the same resource are timetabled at the same time (the better rank wins)
  function overlaps() {
    const out = [];
    const byRes = new Map();
    for (const p of M.prefs) for (const k of p.items) { if (!byRes.has(k)) byRes.set(k, []); byRes.get(k).push(p); }
    for (const [k, prefs] of byRes) {
      if (prefs.length < 2) continue;
      const slots = new Map();                                   // slot -> Set(teacher)
      for (const p of prefs) for (const c of M.classes) {
        if (U.norm(c.teacher) !== U.norm(p.teacher)) continue;
        for (const s of M.slotsOf(c)) { if (!slots.has(s)) slots.set(s, new Set()); slots.get(s).add(p.teacher); }
      }
      const pairs = new Map();
      for (const set of slots.values()) if (set.size > 1) { const key = [...set].sort(U.natCmp).join(' & '); pairs.set(key, (pairs.get(key) || 0) + 1); }
      for (const [who, n] of pairs) out.push({ res: M.resByKey.get(k), who, n });
    }
    return out;
  }

  function render() {
    const host = S.host;
    if (!host) return;
    const view = host.closest('.view') || host, top = view.scrollTop;
    clear(host);
    const admin = isAdmin();
    const rows = M.prefs.map((p) => {
      const st = standing(p);
      const res = p.items.map((k) => M.resByKey.get(k)).filter(Boolean);
      return h('tr', null,
        h('td', null, h('strong', null, String(p.rank))),
        h('td', null, p.teacher, M.teachers.some((t) => U.norm(t) === U.norm(p.teacher)) ? null : h('span', { class: 'muted small' }, '  (not in the class data)')),
        h('td', null, h('div', { class: 'lesson-chips' }, res.length ? res.map(tag) : h('span', { class: 'muted small' }, 'resource no longer exists'))),
        h('td', null, String(st.lessons)),
        h('td', null, h('span', { class: st.usual ? 'ok-ink' : '' }, String(st.usual))),
        h('td', null, String(st.other)), h('td', null, String(st.none)),
        h('td', { class: 'actions' }, admin ? h('div', { class: 'btn-row tight' },
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => openEditor(p) }, 'Edit'),
          h('button', { class: 'btn danger-ghost small', type: 'button', onclick: () => remove(p) }, 'Remove')) : null));
    });

    const clashes = overlaps();
    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Teacher preferences'),
        h('p', { class: 'muted' }, 'A teacher’s usual resource, such as Mr K Mannion always having Trolley A. Every Auto-allocate run gives it to them first, in every lesson where it is free, then the rule’s own steps fill what is left.')),
      admin ? h('button', { class: 'btn primary', type: 'button', onclick: () => openEditor(null) }, 'Add preference') : null),
      clashes.length ? h('div', { class: 'callout warn' }, h('strong', null, 'Teachers who share a usual resource are timetabled together'),
        ...clashes.map((c) => h('div', null, `${c.who} both want ${c.res ? c.res.name : 'a resource'} in ${c.n} lesson-slot${c.n === 1 ? '' : 's'}. The better rank gets it; the other gets another resource and is flagged in the preview.`))) : null,
      rows.length ? h('section', { class: 'panel' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Rank', 'Teacher', 'Usual resource', 'Lessons', 'Has usual', 'Has another', 'Has none', ''].map((c) => h('th', null, c)))),
        h('tbody', null, rows))),
      h('p', { class: 'muted small' }, 'Rank 1 wins when two teachers want the same resource in the same lesson. It is a soft preference: if the usual resource is taken, or is not part of the rule’s pool, the teacher simply gets whatever the rule gives them, and the preview lists who missed out and why. Lessons that already have a resource keep it.'))
        : h('section', { class: 'panel' }, h('h2', null, 'No preferences yet'),
          h('p', { class: 'muted' }, admin ? 'Add a teacher and the resource (or resources, in order) they always want.' : 'Nothing has been set up. An administrator can add them.'))));
    view.scrollTop = top;
  }

  async function remove(p) {
    if (!(await U.confirm(`Remove ${p.teacher}’s usual resource? Existing allocations are not changed.`, { ok: 'Remove', danger: true, title: 'Remove preference?' }))) return;
    try { await M.deletePref(p.id); toast('Removed.', 'success', 1600); } catch (e) { toast(e.message, 'error'); }
    render();
  }

  function openEditor(existing) {
    const d = existing ? { ...existing, items: existing.items.slice() } : { id: '', teacher: '', items: [], rank: Math.max(0, ...M.prefs.map((p) => Number(p.rank) || 0)) + 1 };
    const taken = new Set(M.prefs.filter((p) => p.id !== d.id).map((p) => U.norm(p.teacher)));
    const teachers = M.teachers.filter((t) => !taken.has(U.norm(t)));
    const teacherSel = h('select', { 'aria-label': 'Teacher', disabled: !!existing, onchange: (e) => { d.teacher = e.target.value; } },
      [h('option', { value: '' }, 'Choose a teacher…'), ...teachers.map((t) => h('option', { value: t, selected: U.norm(t) === U.norm(d.teacher) }, t)),
        existing && !teachers.some((t) => U.norm(t) === U.norm(d.teacher)) ? h('option', { value: d.teacher, selected: true }, d.teacher) : null].filter(Boolean));

    const listHost = h('div', { class: 'stack' });
    const addSel = h('select', { 'aria-label': 'Add a resource', onchange: (e) => { if (e.target.value) { d.items.push(e.target.value); draw(); } } });
    const draw = () => {
      clear(listHost);
      d.items.forEach((k, i) => {
        const r = M.resByKey.get(k);
        listHost.appendChild(h('div', { class: 'lesson-item' },
          h('span', { class: 'step-no' }, String(i + 1)), r ? tag(r) : h('span', { class: 'muted' }, 'missing resource'),
          h('span', { class: 'muted small' }, i === 0 ? 'first choice' : 'if the one above is taken'),
          h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': 'Move up', onclick: () => { [d.items[i - 1], d.items[i]] = [d.items[i], d.items[i - 1]]; draw(); } }, '↑'),
          h('button', { class: 'btn ghost small', type: 'button', disabled: i === d.items.length - 1, 'aria-label': 'Move down', onclick: () => { [d.items[i + 1], d.items[i]] = [d.items[i], d.items[i + 1]]; draw(); } }, '↓'),
          h('button', { class: 'btn danger-ghost small', type: 'button', onclick: () => { d.items.splice(i, 1); draw(); } }, 'Remove')));
      });
      clear(addSel);
      addSel.appendChild(h('option', { value: '' }, d.items.length ? 'Add another resource as a fallback…' : 'Choose their usual resource…'));
      const byType = new Map();
      for (const r of [...M.resByKey.values()].sort((a, b) => U.natCmp(a.name, b.name))) {
        if (d.items.includes(r.key)) continue;
        if (!byType.has(r.typeName)) byType.set(r.typeName, []);
        byType.get(r.typeName).push(r);
      }
      for (const t of [...byType.keys()].sort(U.natCmp)) addSel.appendChild(h('optgroup', { label: t }, byType.get(t).map((r) => h('option', { value: r.key }, r.name + (r.faculty ? ` (${r.faculty})` : '')))));
      addSel.value = '';
    };
    draw();

    const rank = h('input', { type: 'number', min: '1', step: '1', class: 'num', value: String(d.rank), 'aria-label': 'Rank', oninput: (e) => { d.rank = Math.max(1, Number(e.target.value) || 1); } });
    U.modal({ title: existing ? 'Edit preference' : 'Add preference', wide: true,
      body: h('div', { class: 'stack' },
        U.field('Teacher', teacherSel, 'Only teachers from the class data are listed.'),
        h('div', null, h('div', { class: 'field-label' }, 'Usual resource'), listHost, addSel),
        U.field('Rank', rank, 'Rank 1 wins if two teachers want the same resource in the same lesson. Lower numbers win.')),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: async () => {
        if (!d.teacher) { toast('Choose a teacher.', 'error'); return false; }
        if (!d.items.length) { toast('Choose at least one resource.', 'error'); return false; }
        await M.savePref({ id: d.id, teacher: d.teacher, items: d.items, rank: d.rank, ...(existing ? { createdAt: existing.createdAt } : {}) });
        toast('Saved.', 'success', 1600);
        render();
      } }] });
  }

  UI.render = (container) => { S.host = container; render(); };
  UI.softRefresh = () => { if (S.host && !document.querySelector('.overlay')) render(); };
  UI.reset = () => { S.host = null; };
})();
