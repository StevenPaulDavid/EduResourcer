// Shared resources with priorities.
//
// One resource (e.g. the Library Laptop Trolley) is shared by several GROUPS of classes. Each group is a filter
// (subject, faculty, teacher, year, room or named classes) with a priority LEVEL (1 = highest; two groups can share a
// level). Nothing is booked lesson by lesson: the result is worked out live from the timetable.
//
// For every lesson slot (day + period + week):
//   - a hand booking (a normal allocation of the resource) wins the lesson;
//   - otherwise the best level wins; if exactly one class is at that level it HOLDS the resource;
//   - if several classes are at the best level they SHARE it and staff agree between themselves;
//   - every other class MISSES OUT, flagged with the reason (no standing booking is kept).
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const SH = (ER.shared = {});
  const U = ER.util, M = ER.model;

  const WEEK_RANK = { holder: 0, shared: 1, missing: 2 };

  SH.newGroup = () => ({ id: U.hex(crypto.getRandomValues(new Uint8Array(4))), name: '', level: 1,
    filter: { years: [], faculties: [], subjects: [], teachers: [], rooms: [], classes: [] } });
  SH.newConfig = () => ({ id: '', resKey: '', groups: [SH.newGroup()] });

  const FILTER_KEYS = ['years', 'faculties', 'subjects', 'teachers', 'rooms', 'classes'];
  SH.hasFilter = (g) => FILTER_KEYS.some((k) => g.filter[k] && g.filter[k].length);

  SH.validate = (cfg) => {
    const p = [];
    if (!cfg.resKey) p.push('Choose the shared resource.');
    if (!cfg.groups.length) p.push('Add at least one group.');
    cfg.groups.forEach((g, i) => {
      const n = g.name.trim() || `Group ${i + 1}`;
      if (!g.name.trim()) p.push(`Group ${i + 1}: give it a name.`);
      if (!(Number(g.level) >= 1)) p.push(`${n}: the priority level must be 1 or more.`);
      if (!SH.hasFilter(g)) p.push(`${n}: choose at least one class filter (an empty group would match every class).`);
    });
    return p;
  };

  const groupsByLevel = (cfg) => cfg.groups.slice().sort((a, b) => Number(a.level) - Number(b.level) || U.natCmp(a.name, b.name));
  const weeksOf = (c) => (c.week === 'AB' ? ['A', 'B'] : [c.week]);
  const slotKey = (c, w) => `${c.day}|${c.pkey}|${w}`;
  SH.slotKey = slotKey;

  // ---------- resolve one shared resource ----------
  // returns { cfg, res, entries: Map(classKey -> { c, group, level, booked, results:{A,B}, overall, mixed }), slots: Map, groupStats }
  SH.resolve = (cfg) => {
    const res = M.resByKey.get(cfg.resKey) || null;
    const groups = groupsByLevel(cfg).filter((g) => SH.hasFilter(g));

    // which group does each class belong to? (the best priority among the groups it matches)
    const entries = new Map();
    for (const c of M.classes) {
      for (const g of groups) {
        if (ER.auto.classInScope(g.filter, c)) { entries.set(c.key, { c, group: g, level: Number(g.level), booked: false, results: {} }); break; }
      }
    }
    // hand bookings of this resource: a class that has it booked normally holds it
    for (const a of M.allocsByRes.get(cfg.resKey) || []) {
      if (a.orphan) continue;
      const c = M.classByKey.get(a.classKey);
      if (!c) continue;
      const e = entries.get(c.key);
      if (e) e.booked = true;
      else entries.set(c.key, { c, group: null, level: 0, booked: true, results: {} });
    }

    // lesson slots -> who is in each
    const slots = new Map();
    for (const e of entries.values()) {
      for (const w of weeksOf(e.c)) {
        const k = slotKey(e.c, w);
        if (!slots.has(k)) slots.set(k, { key: k, day: e.c.day, pkey: e.c.pkey, period: e.c.period, week: w, entries: [] });
        slots.get(k).entries.push({ e, w });
      }
    }

    // decide each slot
    for (const s of slots.values()) {
      const booked = s.entries.filter((x) => x.e.booked);
      const names = (list) => list.map((x) => x.e.c.name).join(' / ');
      if (booked.length) {
        for (const x of s.entries) {
          x.e.results[x.w] = x.e.booked
            ? { status: 'holder', via: 'booking', with: booked.filter((y) => y !== x).map((y) => y.e.c.name), reason: '' }
            : { status: 'missing', reason: `booked for ${names(booked)}`, with: [] };
        }
      } else {
        const min = Math.min(...s.entries.map((x) => x.e.level));
        const top = s.entries.filter((x) => x.e.level === min);
        const topGroups = [...new Set(top.map((x) => x.e.group.name))].join(' / ');
        for (const x of s.entries) {
          if (x.e.level === min) {
            x.e.results[x.w] = top.length === 1
              ? { status: 'holder', via: 'priority', with: [], reason: '' }
              : { status: 'shared', via: 'priority', with: top.filter((y) => y !== x).map((y) => y.e.c.name), reason: 'staff to agree' };
          } else {
            x.e.results[x.w] = { status: 'missing', reason: `${topGroups} has priority`, with: top.map((y) => y.e.c.name) };
          }
        }
      }
    }

    // one overall answer per class (worst of its weeks)
    for (const e of entries.values()) {
      const rs = weeksOf(e.c).map((w) => e.results[w]).filter(Boolean);
      e.overall = rs.reduce((worst, r) => (WEEK_RANK[r.status] > WEEK_RANK[worst] ? r.status : worst), 'holder');
      e.mixed = new Set(rs.map((r) => r.status)).size > 1;
    }

    // per-group numbers, counted in lesson slots (Week A and Week B counted separately)
    const groupStats = groups.map((g) => ({ group: g, classes: 0, wants: 0, holder: 0, shared: 0, missing: 0 }));
    for (const e of entries.values()) {
      if (!e.group) continue;
      const st = groupStats.find((x) => x.group === e.group);
      st.classes++;
      for (const w of weeksOf(e.c)) { const r = e.results[w]; if (r) { st.wants++; st[r.status]++; } }
    }
    return { cfg, res, entries, slots, groupStats };
  };

  // all shared resources, cached until the data changes
  let cache = { v: -1, map: new Map() };
  SH.all = () => {
    if (cache.v !== M.version) {
      const map = new Map();
      for (const cfg of M.shared) { try { map.set(cfg.resKey, SH.resolve(cfg)); } catch (e) { console.warn('Shared resource could not be resolved', e); } }
      cache = { v: M.version, map };
    }
    return cache.map;
  };

  // ---------- helpers for other screens ----------
  const RES_LABEL = (r) => (r ? r.name : 'a resource');

  // Markers for one class card on the Allocate grid (for the week being shown)
  SH.markersFor = (classKey, week) => {
    const out = [];
    for (const rz of SH.all().values()) {
      const e = rz.entries.get(classKey);
      if (!e) continue;
      const w = e.c.week === 'AB' ? week : e.c.week;
      const r = e.results[w];
      if (!r) continue;
      const name = RES_LABEL(rz.res);
      if (r.status === 'holder' && r.via === 'booking') continue;       // an ordinary booking already shows as a normal chip
      out.push({
        resName: name, status: r.status, group: e.group ? e.group.name : '', level: e.level,
        text: r.status === 'holder' ? `${name}: has it`
          : r.status === 'shared' ? `${name}: shared with ${r.with.map((n) => n).join(', ')}`
            : `${name}: not this lesson (${r.reason})`,
        title: `${name} is shared. ${e.group ? e.group.name + ' (priority ' + e.level + '): ' : ''}${
          r.status === 'holder' ? 'this class has it in this lesson.' : r.status === 'shared' ? 'shared with ' + r.with.join(', ') + ': staff to agree.' : 'this class does not get it this lesson, ' + r.reason + '.'}`,
      });
    }
    return out;
  };

  // slot keys ("Mon|1|A") where a shared resource is held or shared by someone (for auto-allocate to respect)
  SH.heldSlots = (resKey) => {
    const rz = SH.all().get(resKey);
    if (!rz) return [];
    const out = [];
    for (const s of rz.slots.values()) if (s.entries.some((x) => x.e.results[x.w] && x.e.results[x.w].status !== 'missing')) out.push(s.key);
    return out;
  };

  // If the resource is shared: which classes would lose their place in this class's lessons if it were booked by hand?
  SH.affectedByBooking = (resKey, classKey) => {
    const rz = SH.all().get(resKey);
    const c = M.classByKey.get(classKey);
    if (!rz || !c) return [];
    const affected = [];
    for (const w of weeksOf(c)) {
      const s = rz.slots.get(slotKey(c, w));
      if (!s) continue;
      for (const x of s.entries) {
        if (x.e.c.key === classKey || x.e.booked) continue;
        const r = x.e.results[x.w];
        if (r && r.status !== 'missing') affected.push(`${x.e.c.name}${x.e.group ? ' (' + x.e.group.name + ')' : ''}`);
      }
    }
    return [...new Set(affected)];
  };

  SH.statusText = { holder: 'Has it', shared: 'Shared: staff to agree', missing: 'Misses out' };
})();
