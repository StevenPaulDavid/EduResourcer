// Shared resources page: list, per-lesson timetable of a resource, and the set-up editor (admins).
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const UI = (ER.sharedUi = {});
  const { h, clear, toast } = ER.util;
  const U = ER.util, M = ER.model, A = ER.auth, SH = ER.shared, AU = ER.auto;

  const S = { view: 'home', draft: null, resKey: null, week: 'A', host: null };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isAdmin = () => A.canManageData();

  // "Level 1: IT   Level 2: English   Level 3: Music = Art"
  function levelSummary(cfg) {
    const byLevel = new Map();
    for (const g of cfg.groups.slice().sort((a, b) => Number(a.level) - Number(b.level) || U.natCmp(a.name, b.name))) {
      if (!byLevel.has(Number(g.level))) byLevel.set(Number(g.level), []);
      byLevel.get(Number(g.level)).push(g.name);
    }
    return [...byLevel.entries()].map(([lv, names]) => `${lv}: ${names.join(' = ')}`).join('   ›   ');
  }

  // ====================== HOME ======================
  function renderHome() {
    const host = S.host;
    clear(host);
    const all = SH.all();
    const cards = M.shared.slice().sort((a, b) => {
      const ra = M.resByKey.get(a.resKey), rb = M.resByKey.get(b.resKey);
      return U.natCmp(ra ? ra.name : '~', rb ? rb.name : '~');
    }).map((cfg) => {
      const rz = all.get(cfg.resKey);
      const res = M.resByKey.get(cfg.resKey);
      let counts = null;
      if (rz) {
        let holder = 0, shared = 0, missing = 0, contended = 0;
        for (const s of rz.slots.values()) {
          const rs = s.entries.map((x) => x.e.results[x.w]).filter(Boolean);
          if (rs.length > 1) contended++;
          rs.forEach((r) => { if (r.status === 'holder') holder++; else if (r.status === 'shared') shared++; else missing++; });
        }
        counts = h('div', { class: 'stats' },
          h('div', { class: 'stat ok' }, h('strong', null, String(holder)), h('span', null, 'lessons it holds')),
          h('div', { class: 'stat' }, h('strong', null, String(contended)), h('span', null, 'lessons wanted by several classes')),
          h('div', { class: 'stat' + (shared ? ' shared' : '') }, h('strong', null, String(shared)), h('span', null, 'shared: staff to agree')),
          h('div', { class: 'stat' + (missing ? ' warn' : '') }, h('strong', null, String(missing)), h('span', null, 'lessons where a class misses out')));
      }
      return h('section', { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('div', null, h('h2', null, res ? res.name : '(resource no longer exists)'),
            h('p', { class: 'muted' }, (res ? `${res.typeName}${res.location ? ' · ' + res.location : ''}  ·  ` : '') + 'Priority ' + levelSummary(cfg))),
          h('div', { class: 'btn-row tight' },
            rz ? h('button', { class: 'btn primary', type: 'button', onclick: () => { S.resKey = cfg.resKey; S.view = 'grid'; render(); } }, 'View timetable') : null,
            isAdmin() ? h('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor(cfg) }, 'Edit') : null,
            isAdmin() ? h('button', { class: 'btn danger-ghost', type: 'button', onclick: () => remove(cfg, res) }, 'Delete') : null)),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Priority', 'Group', 'Which classes', 'Classes', 'Has it', 'Shared', 'Misses out'].map((c) => h('th', null, c)))),
          h('tbody', null, (rz ? rz.groupStats : []).map((g) => h('tr', null, h('td', null, String(g.group.level)), h('td', null, h('strong', null, g.group.name)),
            h('td', null, AU.describeFilter(g.group.filter)), h('td', null, String(g.classes)), h('td', null, String(g.holder)), h('td', null, String(g.shared)), h('td', null, String(g.missing))))))),
        counts);
    });

    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Shared resources'),
        h('p', { class: 'muted' }, 'Resources that several groups share, with a priority order. Who has it in each lesson is worked out live from the timetable.')),
      isAdmin() ? h('button', { class: 'btn primary', type: 'button', onclick: () => openEditor(SH.newConfig()) }, 'Add shared resource') : null),
      cards.length ? cards : h('section', { class: 'panel' }, h('h2', null, 'No shared resources yet'),
        h('p', { class: 'muted' }, isAdmin()
          ? 'Choose a resource such as the Library Laptop Trolley, add the groups that use it (IT, English, Music, Art…) and give each a priority level. Where two groups are timetabled at the same time the higher priority gets it, and groups on the same level share it and agree between themselves.'
          : 'Nothing is shared yet. An administrator can set this up.'))));
  }

  async function remove(cfg, res) {
    if (!(await U.confirm(`Stop sharing ${res ? res.name : 'this resource'}? Its groups and priorities are deleted. Normal bookings are not affected.`, { ok: 'Delete', danger: true, title: 'Delete shared resource?' }))) return;
    try { await M.deleteShared(cfg.id); toast('Deleted.', 'success', 1800); } catch (e) { toast(e.message, 'error'); }
    renderHome();
  }

  // ====================== TIMETABLE OF ONE RESOURCE ======================
  function renderGrid() {
    const host = S.host;
    clear(host);
    const rz = SH.all().get(S.resKey);
    if (!rz) { S.view = 'home'; renderHome(); return; }
    const wk = S.week;
    const cells = new Map();
    for (const s of rz.slots.values()) if (s.week === wk) cells.set(s.day + '|' + s.pkey, s);
    const tally = { holder: 0, shared: 0, missing: 0 };
    for (const s of rz.slots.values()) if (s.week === wk) for (const x of s.entries) { const r = x.e.results[x.w]; if (r) tally[r.status]++; }

    const rows = M.periods.map((p) => h('tr', null, h('th', { class: 'tt-p', scope: 'row' }, h('small', null, 'Period'), h('strong', null, p.label)),
      M.days.map((d) => {
        const s = cells.get(d + '|' + p.pkey);
        const list = s ? s.entries.slice().sort((a, b) => a.e.level - b.e.level || U.natCmp(a.e.c.name, b.e.c.name)) : [];
        return h('td', { class: 'tt-cell' + (list.length ? ' has' : '') }, list.map((x) => {
          const r = x.e.results[x.w], c = x.e.c;
          return h('div', { class: 'tt-entry sh-' + r.status, title: `${SH.statusText[r.status]}${r.reason ? ': ' + r.reason : ''}` },
            h('strong', null, c.name, c.year ? h('span', { class: 'tt-yr' }, U.yearShort(c.year)) : null),
            h('span', { class: 'tt-l2' }, [x.e.group ? `${x.e.group.name} · priority ${x.e.level}` : 'booked by hand', c.teacher].filter(Boolean).join(' · ')),
            h('span', { class: 'tt-why sh-line' }, r.status === 'holder' ? (r.via === 'booking' ? '✓ Has it (booked)' : '✓ Has it')
              : r.status === 'shared' ? `⇄ Shared with ${r.with.join(', ')}: staff to agree`
                : `✕ ${r.reason}`));
        }));
      })));

    const seg = h('div', { class: 'seg' }, ['A', 'B'].map((w) => h('button', { class: 'seg-btn' + (wk === w ? ' on' : ''), type: 'button', onclick: () => { S.week = w; renderGrid(); } }, 'Week ' + w)));
    const res = rz.res;
    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, (res ? res.name : 'Shared resource') + ': who has it, lesson by lesson'),
        h('p', { class: 'muted' }, 'Priority ' + levelSummary(rz.cfg))),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.view = 'home'; render(); } }, '← Back')),
      h('div', { class: 'inline' }, seg,
        h('div', { class: 'tt-legend' },
          h('span', { class: 'lg sh-holder' }, `Has it (${tally.holder})`), h('span', { class: 'lg sh-shared' }, `Shared, staff to agree (${tally.shared})`),
          h('span', { class: 'lg sh-missing' }, `Misses out (${tally.missing})`))),
      h('p', { class: 'muted small' }, 'Lessons where nobody in a group is timetabled are free. A resource booked by hand for a class wins that lesson. A class running every week appears in both weeks.'),
      h('div', { class: 'tt-wrap' }, h('table', { class: 'tt' }, h('thead', null, h('tr', null, h('th', { class: 'tt-corner' }, ''), M.days.map((d) => h('th', null, d)))), h('tbody', null, rows)))));
  }

  // ====================== EDITOR (admins) ======================
  function openEditor(cfg) {
    S.draft = clone(cfg);
    S.view = 'edit';
    render();
  }

  function renderEditor() {
    const host = S.host, d = S.draft;
    clear(host);
    const taken = new Set(M.shared.filter((c) => c.id !== d.id).map((c) => c.resKey));
    const options = [...M.resByKey.values()].filter((r) => !taken.has(r.key)).sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name));
    const resSel = h('select', { 'aria-label': 'Shared resource', onchange: (e) => { d.resKey = e.target.value; } },
      [h('option', { value: '' }, 'Choose the resource…'), ...options.map((r) => h('option', { value: r.key, selected: r.key === d.resKey }, `${r.name} (${r.typeName})`))]);

    const opt = (l) => l.map((x) => [x, x]);
    const groupsHost = h('div', { class: 'steps' });
    const drawGroups = () => {
      clear(groupsHost);
      d.groups.forEach((g, i) => {
        const count = h('span', { class: 'muted small' });
        const upd = () => {
          const n = M.classes.filter((c) => ER.auto.classInScope(g.filter, c)).length;
          count.textContent = SH.hasFilter(g) ? `${n} lesson${n === 1 ? '' : 's'} match this group` : 'Choose at least one filter';
        };
        const mp = (key, options, addLabel) => ER.autoUi.multiPick({ options, addLabel, emptyText: 'Any', onChange: upd, get: () => g.filter[key], set: (v) => { g.filter[key] = v; } });
        groupsHost.appendChild(h('div', { class: 'step-card' },
          h('div', { class: 'step-head' },
            h('input', { type: 'text', class: 'step-label', placeholder: 'Group name, e.g. IT', value: g.name, maxlength: '40', 'aria-label': 'Group name', oninput: (e) => { g.name = e.target.value; } }),
            h('label', { class: 'inline' }, h('span', { class: 'field-label' }, 'Priority'),
              h('input', { type: 'number', min: '1', step: '1', class: 'num', value: String(g.level), 'aria-label': 'Priority level', oninput: (e) => { g.level = Number(e.target.value) || 1; } })),
            h('button', { class: 'btn danger-ghost small', type: 'button', disabled: d.groups.length === 1, onclick: () => { d.groups.splice(i, 1); drawGroups(); } }, 'Remove')),
          h('div', { class: 'form-grid' },
            U.field('Subjects', mp('subjects', opt(M.subjects), 'Add subject')), U.field('Faculties', mp('faculties', opt(M.faculties), 'Add faculty')),
            U.field('Year groups', mp('years', opt(M.years), 'Add year group')), U.field('Teachers', mp('teachers', opt(M.teachers), 'Add teacher')),
            U.field('Rooms', mp('rooms', opt(M.rooms), 'Add room')), U.field('Named classes', mp('classes', opt([...new Set(M.classes.map((c) => c.name))].sort(U.natCmp)), 'Add class'))),
          count));
        upd();
      });
    };
    drawGroups();

    const problems = h('div', { class: 'callout warn', hidden: true });
    const save = async (thenView) => {
      const p = SH.validate(d);
      problems.hidden = !p.length;
      clear(problems);
      p.forEach((t) => problems.appendChild(h('div', null, t)));
      if (p.length) return;
      try {
        const saved = await M.saveShared(d);
        toast('Saved.', 'success', 1600);
        if (thenView) { S.resKey = saved.resKey; S.view = 'grid'; } else S.view = 'home';
        render();
      } catch (e) { toast(e.message, 'error'); }
    };

    host.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, d.id ? 'Edit shared resource' : 'Add shared resource'),
        h('div', { class: 'btn-row tight' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.view = 'home'; render(); } }, 'Cancel'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => save(false) }, 'Save'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => save(true) }, 'Save & view timetable'))),
      h('section', { class: 'panel' }, h('div', null, h('h2', null, '1 · The shared resource'), h('p', { class: 'muted' }, 'One item that several groups use, such as the Library Laptop Trolley.')), U.field('Resource', resSel)),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('div', null, h('h2', null, '2 · Groups and priority'),
          h('p', { class: 'muted' }, 'Each group is a filter on the classes. Priority 1 is the highest. When classes from different groups are timetabled at the same time the highest priority gets the resource and the others are flagged. Give two groups the same number (for example Music and Art both 3) and the system shows them as sharing, for staff to agree between themselves. A class that matches several groups uses the best priority.')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { const g = SH.newGroup(); g.level = Math.max(0, ...d.groups.map((x) => Number(x.level) || 0)) + 1; d.groups.push(g); drawGroups(); } }, 'Add group')),
        groupsHost),
      problems));
  }

  // ====================== entry points ======================
  function render() {
    if (!S.host) return;
    if (S.view === 'edit' && S.draft && isAdmin()) renderEditor();
    else if (S.view === 'grid') renderGrid();
    else { S.view = 'home'; renderHome(); }
    const v = S.host.closest('.view') || S.host;
    v.scrollTop = 0;
  }
  UI.render = (container) => { S.host = container; if (!['edit', 'grid'].includes(S.view)) S.view = 'home'; render(); };
  UI.softRefresh = () => { if (S.host && S.view === 'home') renderHome(); else if (S.host && S.view === 'grid') renderGrid(); };
  UI.reset = () => { S.view = 'home'; S.draft = null; S.resKey = null; };
  UI.openGrid = (resKey) => { S.resKey = resKey; S.view = 'grid'; };
})();
