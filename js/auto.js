// Auto-allocate engine: turns a saved rule into a plan (no changes made), and can apply a plan.
//
// A rule is:  scope (which classes) + pool (which resources) + faculty limit + ordered steps.
// Each class belongs to the FIRST step whose filter it matches. Steps are filled one after another across the whole
// week (step 1 gets first pick of every lesson, step 2 gets what is left, ...). Within a step, lessons are filled
// earliest-in-the-week first. Existing allocations are kept and count as taken.
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const AU = (ER.auto = {});
  const U = ER.util, M = ER.model, C = ER.crypto, A = ER.auth;

  // ---------- rule shape ----------
  const FILTER_KEYS = ['years', 'faculties', 'subjects', 'teachers', 'rooms', 'classes'];
  AU.FILTER_LABELS = { years: 'Year group', faculties: 'Faculty', subjects: 'Subject', teachers: 'Teacher', rooms: 'Room', classes: 'Class' };

  AU.newStep = () => ({ id: U.hex(C.rand(4)), label: '', filter: { years: [], faculties: [], subjects: [], teachers: [], rooms: [], classes: [] }, qty: 1, all: false, maxPerWeek: 0, everyoneElse: false });
  AU.newRule = () => ({
    id: '', name: '',
    scope: { years: [], faculties: [], subjects: [], teachers: [], rooms: [], classes: [], days: [], periods: [], weekTypes: ['A', 'B', 'AB'] },
    pool: { types: [], faculties: [], items: [] },
    poolMode: 'all',            // all: a resource must match EVERY pool box that has a choice (Laptops AND Maths faculty); any: match any box
    facultyMode: 'none',        // none | own | named | prefer
    facultyNamed: '',
    strictFaculty: false,       // true: shared (no-faculty) items are NOT used as a fallback
    spare: 0,                   // items to keep free in every lesson
    sameItem: true,             // prefer giving a class the same item each lesson
    usePrefs: true,             // give teachers their usual resource (Preferences page) before the steps run
    steps: [AU.newStep()],
  });

  // fill in anything missing (rules saved by an older version, hand edits...)
  AU.normaliseRule = (r) => {
    const base = AU.newRule();
    const out = { ...base, ...r };
    out.scope = { ...base.scope, ...(r.scope || {}) };
    out.pool = { ...base.pool, ...(r.pool || {}) };
    out.steps = (r.steps && r.steps.length ? r.steps : base.steps).map((s) => ({ ...AU.newStep(), ...s, filter: { ...AU.newStep().filter, ...(s.filter || {}) } }));
    return out;
  };

  // ---------- plain-English descriptions ----------
  const list = (a, max = 3) => (a.length > max ? a.slice(0, max).join(', ') + ` +${a.length - max} more` : a.join(', '));
  AU.describeFilter = (f, everyoneElse) => {
    if (everyoneElse) return 'Everyone else in scope';
    const parts = FILTER_KEYS.filter((k) => f[k] && f[k].length).map((k) => `${AU.FILTER_LABELS[k]}: ${list(f[k])}`);
    return parts.length ? parts.join(' · ') : 'All classes in scope';
  };
  AU.stepName = (s, i) => s.label.trim() || `Step ${i + 1}: ${AU.describeFilter(s.filter, s.everyoneElse)}`;

  // Does a resource belong to a pool? Each box (types / faculties / items) with a choice is a test; with
  // mode 'all' (default) the resource must pass every test, with 'any' it only needs to pass one.
  AU.inPool = (pool, mode, r) => {
    const tests = [];
    if (pool.types.length) tests.push(pool.types.includes(r.typeId));
    if (pool.faculties.length) tests.push(!!r.faculty && pool.faculties.includes(r.faculty));
    if (pool.items.length) tests.push(pool.items.includes(r.key));
    if (!tests.length) return false;
    return mode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
  };

  AU.describePool = (rule) => {
    const typeNames = rule.pool.types.map((id) => (M.types.find((t) => t.id === id) || {}).name).filter(Boolean);
    const items = rule.pool.items.map((k) => (M.resByKey.get(k) || {}).name).filter(Boolean);
    const bits = [];
    if (typeNames.length) bits.push(`type ${list(typeNames)}`);
    if (rule.pool.faculties.length) bits.push(`${list(rule.pool.faculties)} faculty`);
    if (items.length) bits.push(`items ${list(items)}`);
    return bits.length ? bits.join(rule.poolMode === 'any' ? ' OR ' : ' AND ') : 'nothing chosen';
  };

  AU.validate = (rule) => {
    const problems = [];
    if (!rule.name.trim()) problems.push('Give the rule a name.');
    if (!rule.pool.types.length && !rule.pool.faculties.length && !rule.pool.items.length) problems.push('Choose at least one resource type, faculty or item for the pool.');
    if (rule.facultyMode === 'named' && !rule.facultyNamed) problems.push('Choose which faculty the resources must come from.');
    if (!rule.steps.length) problems.push('Add at least one priority step.');
    rule.steps.forEach((s, i) => {
      if (!s.all && !(Number(s.qty) >= 1)) problems.push(`Step ${i + 1}: set how many resources each class gets.`);
    });
    return problems;
  };

  // ---------- the planner ----------
  const inList = (arr, v) => !arr || !arr.length || arr.includes(v);
  const weekRank = { A: 0, B: 1, AB: 2 };
  const lessonCmp = (a, b) =>
    U.DAYS.indexOf(a.day) - U.DAYS.indexOf(b.day) || U.natCmp(a.pkey, b.pkey) || (weekRank[a.week] - weekRank[b.week]) || U.natCmp(a.name, b.name);

  // does a class pass a scope (years, faculties, subjects, teachers, rooms, classes, days, periods, weekTypes)?
  const classInScope = (sc, c) =>
    inList(sc.years, c.year) && inList(sc.faculties, c.faculty) && inList(sc.subjects, c.subject) && inList(sc.teachers, c.teacher)
    && inList(sc.rooms, c.room) && inList(sc.classes, c.name) && inList(sc.days, c.day) && inList(sc.periods, c.pkey)
    && (sc.weekTypes || ['A', 'B', 'AB']).includes(c.week);
  AU.classInScope = classInScope;

  AU.plan = (ruleIn) => {
    const rule = AU.normaliseRule(ruleIn);
    const sc = rule.scope;
    const scopeClasses = M.classes.filter((c) => classInScope(sc, c));

    const poolItems = [...M.resByKey.values()]
      .filter((r) => AU.inPool(rule.pool, rule.poolMode, r))
      .sort((a, b) => U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name));
    const poolKeys = new Set(poolItems.map((r) => r.key));

    // what is already taken, per pool item
    const occ = new Map(poolItems.map((r) => [r.key, new Set()]));
    const slotUse = new Map();                       // slot -> number of pool items in use
    const addOcc = (resKey, slots) => {
      const set = occ.get(resKey);
      for (const s of slots) if (!set.has(s)) { set.add(s); slotUse.set(s, (slotUse.get(s) || 0) + 1); }
    };
    const hasKeys = new Map();                       // classKey -> Set(resKey) of pool items it already has
    const freq = new Map();                          // class name -> Map(resKey -> times used)  (for "same item")
    const counters = new Map();                      // `${name}|${week}` -> lessons that have a pool item
    const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
    const weeksOf = (c) => (c.week === 'AB' ? ['A', 'B'] : [c.week]);
    let usedBefore = 0;
    for (const r of poolItems) {
      for (const a of M.allocsByRes.get(r.key) || []) {
        const c = M.classByKey.get(a.classKey);
        if (!c) continue;
        addOcc(r.key, M.slotsOf(c));
        if (!hasKeys.has(c.key)) hasKeys.set(c.key, new Set());
        hasKeys.get(c.key).add(r.key);
        if (!freq.has(c.name)) freq.set(c.name, new Map());
        bump(freq.get(c.name), r.key);
      }
    }
    for (const [ck] of hasKeys) { const c = M.classByKey.get(ck); weeksOf(c).forEach((w) => bump(counters, `${c.name}|${w}`)); }
    // a shared resource's groups already hold it in their own lessons (worked out live), so it is not free then
    if (ER.shared) for (const r of poolItems) { const held = ER.shared.heldSlots(r.key); if (held.length) addOcc(r.key, held); }
    for (const set of occ.values()) usedBefore += set.size;

    const totalSlots = Math.max(1, M.days.length * M.periods.length * 2);
    const faculty = (c) => (rule.facultyMode === 'named' ? rule.facultyNamed : c.faculty || '');

    const eligible = (r, c) => {
      if (rule.facultyMode === 'none' || rule.facultyMode === 'prefer') return true;
      const f = faculty(c);
      return (f && r.faculty === f) || (!r.faculty && !rule.strictFaculty);
    };
    // best-first ordering: the class's (or the chosen) faculty's own items, then shared items, then everyone else's.
    // Even with no faculty limit this is only a tie-break, so a Maths class reaches for Maths resources first.
    const rank = (r, c) => {
      const f = faculty(c);
      return f && r.faculty === f ? 0 : !r.faculty ? 1 : 2;
    };
    const isFree = (r, slots) => { const set = occ.get(r.key); return !slots.some((s) => set.has(s)); };

    // choose a free item for this lesson (or explain why not)
    const pick = (c) => {
      const slots = M.slotsOf(c);
      if (rule.spare > 0 && !slots.every((s) => poolItems.length - ((slotUse.get(s) || 0) + 1) >= rule.spare)) return { reason: `keeping ${rule.spare} spare free` };
      const mine = hasKeys.get(c.key) || new Set();
      const allowed = poolItems.filter((r) => eligible(r, c));
      const elig = allowed.filter((r) => !mine.has(r.key));
      if (!allowed.length) return { reason: rule.facultyMode === 'own' || rule.facultyMode === 'named' ? `no ${faculty(c) || 'matching'}-faculty resources in the pool` : 'no resources in the pool' };
      if (!elig.length) return { reason: 'the class already has every resource the pool can give it' };
      const cand = elig.filter((r) => isFree(r, slots));
      if (!cand.length) return { reason: 'every matching resource is already in use in that lesson' };
      const f = freq.get(c.name);
      cand.sort((a, b) => (rule.sameItem ? ((f && f.get(b.key)) || 0) - ((f && f.get(a.key)) || 0) : 0) || rank(a, c) - rank(b, c)
        || U.natCmp(a.typeName, b.typeName) || U.natCmp(a.name, b.name));
      return { res: cand[0] };
    };

    const matchStep = (st, c) => st.everyoneElse || FILTER_KEYS.every((k) => {
      const want = st.filter[k];
      if (!want || !want.length) return true;
      const v = k === 'years' ? c.year : k === 'faculties' ? c.faculty : k === 'subjects' ? c.subject : k === 'teachers' ? c.teacher : k === 'rooms' ? c.room : c.name;
      return want.includes(v);
    });

    const placements = [];
    const unmet = [];
    const stepStats = [];
    const assigned = new Set();
    const demand = [];          // every lesson that still needed resources: { classKey, step, wanted: n | 'all' }
    const why = {};             // classKey -> the reason it could not be fully served
    const stepOf = {};          // classKey -> index of the step that handles it

    // which step handles each lesson (the first one it matches)
    const stepMembers = rule.steps.map(() => []), stepIdx = new Map(), claimed = new Set();
    rule.steps.forEach((st, si) => scopeClasses.filter((c) => !claimed.has(c.key) && matchStep(st, c)).forEach((c) => { claimed.add(c.key); stepMembers[si].push(c); stepIdx.set(c.key, si); }));

    // ---- teachers' usual resources: honoured first, best-ranked teacher first, only from this rule's pool.
    // A usual resource is not subject to the faculty limit; a teacher who cannot have it falls through to the steps.
    const prefLessons = [];     // [{ classKey, teacher, items:[resKey], reason }]  (reason = why the usual one was not given)
    if (rule.usePrefs !== false) {
      const whoHas = (resKey, slots) => {
        const want = new Set(slots);
        for (const a of M.allocsByRes.get(resKey) || []) { const oc = M.classByKey.get(a.classKey); if (oc && M.slotsOf(oc).some((s) => want.has(s))) return oc.name + (oc.teacher ? ' (' + oc.teacher + ')' : ''); }
        for (const p of placements) { if (p.resKey !== resKey) continue; const oc = M.classByKey.get(p.classKey); if (oc && M.slotsOf(oc).some((s) => want.has(s))) return oc.name + (oc.teacher ? ' (' + oc.teacher + ')' : ''); }
        return ER.shared && ER.shared.heldSlots(resKey).some((s) => want.has(s)) ? 'a shared-resource group' : '';
      };
      for (const pref of M.prefs) {
        const items = (pref.items || []).filter((k) => poolKeys.has(k));       // preferences outside this rule's pool are not this rule's business
        if (!items.length) continue;
        const lessons = scopeClasses.filter((c) => stepIdx.has(c.key) && U.norm(c.teacher) === U.norm(pref.teacher)).sort(lessonCmp);
        for (const c of lessons) {
          const entry = { classKey: c.key, teacher: pref.teacher, items, reason: '' };
          prefLessons.push(entry);
          const mine = hasKeys.get(c.key) || new Set();
          if (items.some((k) => mine.has(k))) continue;                         // already has its usual resource
          if (mine.size) { entry.reason = 'the lesson already has another resource, which is kept'; continue; }
          const slots = M.slotsOf(c);
          if (rule.spare > 0 && !slots.every((s) => poolItems.length - ((slotUse.get(s) || 0) + 1) >= rule.spare)) { entry.reason = `keeping ${rule.spare} spare free`; continue; }
          const res = items.find((k) => isFree(M.resByKey.get(k), slots));
          if (!res) {
            const by = items.map((k) => { const w = whoHas(k, slots); return w ? `${M.resByKey.get(k).name} is with ${w}` : ''; }).filter(Boolean);
            entry.reason = by.join('; ') || 'it is in use in that lesson';
            continue;
          }
          addOcc(res, slots);
          if (!hasKeys.has(c.key)) hasKeys.set(c.key, new Set());
          hasKeys.get(c.key).add(res);
          if (!freq.has(c.name)) freq.set(c.name, new Map());
          bump(freq.get(c.name), res);
          weeksOf(c).forEach((w) => bump(counters, `${c.name}|${w}`));
          placements.push({ resKey: res, classKey: c.key, step: stepIdx.get(c.key), pref: true });
        }
      }
    }

    rule.steps.forEach((st, si) => {
      const members = stepMembers[si].slice().sort(lessonCmp);
      members.forEach((c) => { assigned.add(c.key); stepOf[c.key] = si; });
      const stat = { name: AU.stepName(st, si), lessons: members.length, alreadyOk: 0, served: 0, partial: 0, unmet: 0, placed: 0 };
      const wanted = st.all ? Infinity : Math.max(1, Number(st.qty) || 1);
      const max = Number(st.maxPerWeek) || 0;

      for (const c of members) {
        const mine = hasKeys.get(c.key) || new Set();
        const have = mine.size;
        const need = wanted - have;
        if (need <= 0) { stat.alreadyOk++; continue; }
        demand.push({ classKey: c.key, step: si, wanted: st.all ? 'all' : need });

        if (max > 0 && have === 0 && weeksOf(c).some((w) => (counters.get(`${c.name}|${w}`) || 0) >= max)) {
          why[c.key] = `weekly limit of ${max} lesson${max > 1 ? 's' : ''} per class reached`;
          continue;
        }

        let got = 0, reason = '';
        while (got < need) {
          const p = pick(c);
          if (!p.res) { reason = p.reason; break; }
          addOcc(p.res.key, M.slotsOf(c));
          if (!hasKeys.has(c.key)) hasKeys.set(c.key, new Set());
          hasKeys.get(c.key).add(p.res.key);
          if (!freq.has(c.name)) freq.set(c.name, new Map());
          bump(freq.get(c.name), p.res.key);
          placements.push({ resKey: p.res.key, classKey: c.key, step: si });
          got++;
        }
        if (got > 0 && have === 0 && max > 0) weeksOf(c).forEach((w) => bump(counters, `${c.name}|${w}`));
        if (reason && (got === 0 || (!st.all && got < need))) why[c.key] = reason;
      }
      stepStats.push(stat);
    });

    const capacity = poolItems.length * totalSlots;
    const plan = {
      rule, placements, unmet, steps: stepStats, demand, why, stepOf, edits: 0, removed: [], prefLessons,
      scopeLessons: scopeClasses.length,
      scopeKeys: scopeClasses.map((c) => c.key),
      // what values actually occur in the lessons in scope (used to explain a step that matches nothing)
      scopeFacts: {
        years: [...new Set(scopeClasses.map((c) => c.year).filter(Boolean))].sort(U.yearCmp),
        faculties: [...new Set(scopeClasses.map((c) => c.faculty).filter(Boolean))].sort(U.natCmp),
        subjects: [...new Set(scopeClasses.map((c) => c.subject).filter(Boolean))].sort(U.natCmp),
        teachers: [...new Set(scopeClasses.map((c) => c.teacher).filter(Boolean))].sort(U.natCmp),
      },
      poolKeys: [...poolKeys],
      unassigned: scopeClasses.filter((c) => !assigned.has(c.key)).length,
      unassignedKeys: scopeClasses.filter((c) => !assigned.has(c.key)).map((c) => c.key),
      poolSize: poolItems.length, capacity, usedBefore, usedAfter: usedBefore,
      at: new Date().toISOString(),
    };
    AU.refreshPlan(plan);
    return plan;
  };

  // ---------- editing a plan in the preview ----------
  // Recalculate the unmet list, per-step numbers and pool use from the plan's current placements,
  // so the screen is right after you remove or add resources by hand.
  // Existing allocations you have chosen to remove are staged in plan.removed and only really removed on Apply.
  const isRemoved = (plan, resKey, classKey) => (plan.removed || []).some((r) => r.resKey === resKey && r.classKey === classKey);
  AU.isRemoved = isRemoved;
  // how many pool resources a class keeps from what it already has (not counting any staged for removal)
  const keptPoolCount = (plan, classKey) =>
    M.resourcesOfClass(classKey).filter((x) => x.res && plan.poolSet.has(x.res.key) && !isRemoved(plan, x.res.key, classKey)).length;
  // a lesson whose existing pool resource you removed now needs a replacement, even if it needed nothing before
  function ensureDemand(plan, classKey) {
    const si = plan.stepOf[classKey];
    if (si === undefined || plan.demand.some((d) => d.classKey === classKey)) return;
    const st = plan.rule.steps[si];
    if (st.all) return;                 // "as many as are free" steps already have a demand for every lesson
    const need = Math.max(1, Number(st.qty) || 1) - keptPoolCount(plan, classKey);
    if (need > 0) plan.demand.push({ classKey, step: si, wanted: need });
  }

  AU.refreshPlan = (plan) => {
    plan.poolSet = new Set(plan.poolKeys);
    plan.removed = plan.removed || [];
    for (const r of plan.removed) ensureDemand(plan, r.classKey);
    for (const d of plan.demand) {      // a finite demand follows how many pool resources the class still keeps
      if (d.wanted === 'all') continue;
      d.wanted = Math.max(0, Math.max(1, Number(plan.rule.steps[d.step].qty) || 1) - keptPoolCount(plan, d.classKey));
    }
    const cnt = new Map();
    for (const p of plan.placements) cnt.set(p.classKey, (cnt.get(p.classKey) || 0) + 1);
    const steps = plan.steps.map((s) => ({ name: s.name, lessons: s.lessons, alreadyOk: 0, served: 0, partial: 0, unmet: 0, placed: 0 }));
    const unmet = [];
    for (const d of plan.demand) {
      const got = cnt.get(d.classKey) || 0;
      const ok = d.wanted === 'all' ? got > 0 : got >= d.wanted;
      const st = steps[d.step];
      const reason = plan.why[d.classKey] || 'you removed it in this preview';
      if (ok) st.served++;
      else if (got === 0) { st.unmet++; unmet.push({ step: d.step, classKey: d.classKey, wanted: d.wanted === 'all' ? 'all free' : d.wanted, got: 0, reason }); }
      else { st.partial++; unmet.push({ step: d.step, classKey: d.classKey, wanted: d.wanted, got, reason: `only ${got} of ${d.wanted}: ${reason}` }); }
    }
    for (const p of plan.placements) if (p.step >= 0 && steps[p.step]) steps[p.step].placed++;
    steps.forEach((s, i) => { s.alreadyOk = Math.max(0, s.lessons - plan.demand.filter((d) => d.step === i).length); });
    // pool use: lesson-slots of pool items in use, existing + proposed, minus any existing ones staged for removal
    const poolSet = plan.poolSet;
    let used = plan.usedBefore;
    for (const p of plan.placements) {
      if (!poolSet.has(p.resKey)) continue;
      const c = M.classByKey.get(p.classKey);
      if (c) used += M.slotsOf(c).length;
    }
    for (const r of plan.removed) {
      if (!poolSet.has(r.resKey)) continue;
      const c = M.classByKey.get(r.classKey);
      if (c) used -= M.slotsOf(c).length;
    }
    plan.unmet = unmet;
    plan.steps = steps;
    plan.usedAfter = used;
    return plan;
  };

  // resource -> Set of slots in use: existing allocations plus the plan's placements (optionally ignoring one placement)
  const occupancyOf = (plan, ignore) => {
    const occ = new Map();
    const add = (resKey, classKey) => {
      const c = M.classByKey.get(classKey);
      if (!c) return;
      if (!occ.has(resKey)) occ.set(resKey, new Set());
      M.slotsOf(c).forEach((s) => occ.get(resKey).add(s));
    };
    for (const a of M.allocs) if (!a.orphan && !isRemoved(plan, a.resKey, a.classKey)) add(a.resKey, a.classKey);
    for (const p of plan.placements) if (!ignore || ignore.resKey !== p.resKey || ignore.classKey !== p.classKey) add(p.resKey, p.classKey);
    // lessons where a shared resource's groups hold it are not free for anyone else
    if (ER.shared) for (const cfg of M.shared) for (const s of ER.shared.heldSlots(cfg.resKey)) {
      if (!occ.has(cfg.resKey)) occ.set(cfg.resKey, new Set());
      occ.get(cfg.resKey).add(s);
    }
    return occ;
  };

  const hasPlaced = (plan, resKey, classKey) => plan.placements.some((p) => p.resKey === resKey && p.classKey === classKey);
  const hasExisting = (plan, resKey, classKey) => M.allocById.has(resKey + '||' + classKey) && !isRemoved(plan, resKey, classKey);

  // Existing resources of a lesson that are staying (not staged for removal)
  const keptExisting = (plan, classKey) => M.resourcesOfClass(classKey).filter((x) => x.res && !isRemoved(plan, x.res.key, classKey));

  // Does this lesson have ANY resource: already allocated (from the pool or not) or proposed in this run?
  // A short lesson that has one is shown orange; only a lesson that would have nothing at all is red.
  AU.hasAny = (plan, classKey) => plan.placements.some((p) => p.classKey === classKey) || keptExisting(plan, classKey).length > 0;
  AU.isRed = (plan, u) => u.got === 0 && !AU.hasAny(plan, u.classKey);
  AU.existingNames = (plan, classKey) => keptExisting(plan, classKey).map((x) => x.res.name);

  // A lesson whose demand is met ONLY with the help of resources added by hand from outside the pool: those are
  // standing in for what the rule would have given, so the lesson is orange, not fine. Returns those placements.
  AU.standIn = (plan, classKey) => {
    const mine = plan.placements.filter((p) => p.classKey === classKey);
    const out = mine.filter((p) => !plan.poolSet.has(p.resKey));
    if (!out.length) return [];
    const inPool = mine.length - out.length;
    const d = plan.demand.find((x) => x.classKey === classKey);
    const poolOk = !d ? inPool > 0 : d.wanted === 'all' ? inPool > 0 : inPool >= d.wanted;
    return poolOk ? [] : out;
  };

  // state of one lesson in the preview: 'red' (would have nothing), 'orange' (has a resource but short of the rule,
  // or covered only by an outside-pool resource), or 'ok'
  AU.classify = (plan, classKey) => {
    const u = plan.unmet.find((x) => x.classKey === classKey);
    if (u) return AU.isRed(plan, u) ? { state: 'red', u } : { state: 'orange', kind: 'short', u };
    const out = AU.standIn(plan, classKey);
    if (out.length) return { state: 'orange', kind: 'outside', out };
    return { state: 'ok' };
  };

  // counts for the legend and summary numbers
  AU.tally = (plan) => {
    const red = plan.unmet.filter((u) => AU.isRed(plan, u)).length;
    const orangeShort = plan.unmet.length - red;
    const inUnmet = new Set(plan.unmet.map((u) => u.classKey));
    const standing = new Set(plan.placements.filter((p) => !plan.poolSet.has(p.resKey)).map((p) => p.classKey));
    let outside = 0;
    for (const k of standing) if (!inUnmet.has(k) && AU.standIn(plan, k).length) outside++;
    return { red, orange: orangeShort + outside, orangeShort, outside };
  };

  // Teachers' usual resources, live: which lessons have one of their teacher's usual resources (existing, kept or proposed)
  // and which do not, with the reason recorded when the plan was made.
  AU.prefTally = (plan) => {
    const got = [], missed = [];
    for (const e of plan.prefLessons || []) {
      const have = new Set([...plan.placements.filter((p) => p.classKey === e.classKey).map((p) => p.resKey), ...keptExisting(plan, e.classKey).map((x) => x.res.key)]);
      const hit = e.items.find((k) => have.has(k));
      if (hit) got.push({ ...e, hit }); else missed.push({ ...e, reason: e.reason || 'it was taken off in this preview' });
    }
    return { got, missed };
  };

  // stage the removal of an allocation that already exists (applied when you press Apply)
  AU.removeExisting = (plan, resKey, classKey) => {
    const a = M.allocById.get(resKey + '||' + classKey);
    if (!a || isRemoved(plan, resKey, classKey)) return;
    plan.removed.push({ resKey, classKey, by: a.by, at: a.at });
    plan.edits++;
    AU.refreshPlan(plan);
  };
  AU.keepExisting = (plan, resKey, classKey) => {
    const i = plan.removed.findIndex((r) => r.resKey === resKey && r.classKey === classKey);
    if (i < 0) return;
    plan.removed.splice(i, 1);
    plan.edits = Math.max(0, plan.edits - 1);
    AU.refreshPlan(plan);
  };

  // Everything holding a pool resource during this class's lesson: { res, holder (class), kind, placement? }
  AU.holders = (plan, classKey) => {
    const c = M.classByKey.get(classKey);
    if (!c) return [];
    const mine = new Set(M.slotsOf(c));
    const out = [];
    const poolSet = new Set(plan.poolKeys);
    for (const a of M.allocs) {
      if (a.orphan || a.classKey === classKey || !poolSet.has(a.resKey) || isRemoved(plan, a.resKey, a.classKey)) continue;
      const oc = M.classByKey.get(a.classKey);
      if (oc && M.slotsOf(oc).some((s) => mine.has(s))) out.push({ res: M.resByKey.get(a.resKey), holder: oc, kind: 'existing' });
    }
    for (const p of plan.placements) {
      if (p.classKey === classKey || !poolSet.has(p.resKey)) continue;
      const oc = M.classByKey.get(p.classKey);
      if (oc && M.slotsOf(oc).some((s) => mine.has(s))) out.push({ res: M.resByKey.get(p.resKey), holder: oc, kind: p.manual ? 'manual' : 'proposed', placement: p });
    }
    return out.sort((a, b) => U.natCmp(a.res.name, b.res.name));
  };

  // Every resource in the system (not just the pool) that is free for this class's whole lesson and not already on it.
  AU.freeResources = (plan, classKey) => {
    const c = M.classByKey.get(classKey);
    if (!c) return [];
    const slots = M.slotsOf(c), occ = occupancyOf(plan), poolSet = new Set(plan.poolKeys);
    return [...M.resByKey.values()]
      .filter((r) => !hasPlaced(plan, r.key, classKey) && !hasExisting(plan, r.key, classKey) && !slots.some((s) => (occ.get(r.key) || new Set()).has(s)))
      .map((r) => ({ res: r, inPool: poolSet.has(r.key) }))
      .sort((a, b) => U.natCmp(a.res.typeName, b.res.typeName) || U.natCmp(a.res.name, b.res.name));
  };

  // returns an error message, or '' on success. `manual` additions may come from outside the pool.
  AU.addPlacement = (plan, resKey, classKey) => {
    const c = M.classByKey.get(classKey), r = M.resByKey.get(resKey);
    if (!c || !r) return 'That class or resource no longer exists.';
    if (hasPlaced(plan, resKey, classKey) || hasExisting(plan, resKey, classKey)) return `${r.name} is already on this class.`;
    const occ = occupancyOf(plan);
    if (M.slotsOf(c).some((s) => (occ.get(resKey) || new Set()).has(s))) return `${r.name} is already in use in that lesson.`;
    plan.placements.push({ resKey, classKey, step: plan.stepOf[classKey] ?? -1, manual: true });
    plan.edits++;
    AU.refreshPlan(plan);
    return '';
  };

  AU.removePlacement = (plan, resKey, classKey) => {
    const i = plan.placements.findIndex((p) => p.resKey === resKey && p.classKey === classKey);
    if (i < 0) return;
    plan.placements.splice(i, 1);
    plan.edits++;
    AU.refreshPlan(plan);
  };

  // Fill short lessons from whatever is free: pool items first (anything freed by your removals), then resources
  // outside the pool. Defaults to the same TYPES as the pool, so a laptop need is never filled with a projector.
  // opts: { include: 'red' | 'all', typesMode: 'pool' | 'chosen' | 'any', types: [typeIds], preferFaculty, facultyOnly }
  AU.autoFix = (plan, optsIn = {}) => {
    const o = { include: 'red', typesMode: 'pool', types: [], preferFaculty: true, facultyOnly: false, ...optsIn };
    const poolTypes = new Set(plan.poolKeys.map((k) => (M.resByKey.get(k) || {}).typeId));
    const typeOk = (r) => o.typesMode === 'any' || (o.typesMode === 'pool' ? poolTypes.has(r.typeId) : o.types.includes(r.typeId));
    const targets = plan.unmet.filter((u) => o.include === 'all' || AU.isRed(plan, u)).map((u) => u.classKey)
      .sort((a, b) => lessonCmp(M.classByKey.get(a), M.classByKey.get(b)));

    // how often each class name has used each resource (existing + proposed): keeps a class on the same item
    const freq = new Map();
    const bump = (name, key) => { if (!freq.has(name)) freq.set(name, new Map()); freq.get(name).set(key, (freq.get(name).get(key) || 0) + 1); };
    for (const a of M.allocs) { const c = M.classByKey.get(a.classKey); if (c && !a.orphan) bump(c.name, a.resKey); }
    for (const p of plan.placements) { const c = M.classByKey.get(p.classKey); if (c) bump(c.name, p.resKey); }

    const result = { targets: targets.length, added: 0, outside: 0, fixed: 0, still: 0 };
    for (const classKey of targets) {
      const c = M.classByKey.get(classKey);
      const dem = plan.demand.find((d) => d.classKey === classKey);
      const gotNow = plan.placements.filter((p) => p.classKey === classKey).length;
      const need = (dem && dem.wanted !== 'all' ? dem.wanted : 1) - gotNow;
      for (let i = 0; i < need; i++) {
        const f = freq.get(c.name);
        const pref = M.prefOf(c.teacher);
        const prefIdx = (r) => { const i = pref ? pref.items.indexOf(r.key) : -1; return i < 0 ? 99 : i; };
        const rank = (r) => (!o.preferFaculty ? 0 : c.faculty && r.faculty === c.faculty ? 0 : !r.faculty ? 1 : 2);
        const cands = AU.freeResources(plan, classKey)
          .filter((x) => typeOk(x.res) && (!o.facultyOnly || !x.res.faculty || x.res.faculty === c.faculty))
          .sort((a, b) => (b.inPool - a.inPool) || (prefIdx(a.res) - prefIdx(b.res)) || (((f && f.get(b.res.key)) || 0) - ((f && f.get(a.res.key)) || 0)) || rank(a.res) - rank(b.res)
            || U.natCmp(a.res.typeName, b.res.typeName) || U.natCmp(a.res.name, b.res.name));
        if (!cands.length) break;
        const best = cands[0];
        if (AU.addPlacement(plan, best.res.key, classKey)) break;
        bump(c.name, best.res.key);
        result.added++;
        if (!best.inPool) result.outside++;
      }
    }
    const stillKeys = new Set(plan.unmet.map((u) => u.classKey));
    result.still = targets.filter((k) => stillKeys.has(k)).length;
    result.fixed = targets.length - result.still;
    return result;
  };

  // take a proposed resource from the class that currently holds it and give it to another class
  AU.movePlacement = (plan, resKey, fromClassKey, toClassKey) => {
    const i = plan.placements.findIndex((p) => p.resKey === resKey && p.classKey === fromClassKey);
    if (i < 0) return 'That proposal no longer exists.';
    const old = plan.placements.splice(i, 1)[0];
    const err = AU.addPlacement(plan, resKey, toClassKey);
    if (err) { plan.placements.splice(i, 0, old); return err; }
    return '';
  };

  // ---------- clearing allocations ----------
  // spec: { scope: {same fields as a rule's scope}, pool: { types, faculties, items }, madeBy: 'all' | 'auto' | 'manual' }
  AU.newClearSpec = () => ({
    scope: { years: [], faculties: [], subjects: [], teachers: [], rooms: [], classes: [], days: [], periods: [], weekTypes: ['A', 'B', 'AB'] },
    pool: { types: [], faculties: [], items: [] },
    poolMode: 'all',      // resources must match every resource box that has a choice
    madeBy: 'all',
  });
  const SCOPE_LISTS = ['years', 'faculties', 'subjects', 'teachers', 'rooms', 'classes', 'days', 'periods'];
  // true when nothing narrows the selection (everything, including allocations whose class/resource has gone, is cleared)
  AU.clearsEverything = (spec) =>
    SCOPE_LISTS.every((k) => !spec.scope[k].length) && spec.scope.weekTypes.length === 3
    && !spec.pool.types.length && !spec.pool.faculties.length && !spec.pool.items.length && spec.madeBy === 'all';

  const isAuto = (a) => /\(auto:/.test(a.by || '');
  AU.clearTargets = (spec) => {
    const everything = AU.clearsEverything(spec);
    const poolOn = spec.pool.types.length || spec.pool.faculties.length || spec.pool.items.length;
    return M.allocs.filter((a) => {
      if (spec.madeBy === 'auto' && !isAuto(a)) return false;
      if (spec.madeBy === 'manual' && isAuto(a)) return false;
      if (everything) return true;
      const c = M.classByKey.get(a.classKey), r = M.resByKey.get(a.resKey);
      if (!c || !r) return false;                 // orphaned allocations are only cleared by "everything" (or on the Data page)
      if (!classInScope(spec.scope, c)) return false;
      if (poolOn && !AU.inPool(spec.pool, spec.poolMode, r)) return false;
      return true;
    });
  };

  // plain-English summary of a clear spec, e.g. "Subject: Maths · Day: Mon · only auto-allocated"
  AU.describeClear = (spec) => {
    const bits = [];
    const sc = spec.scope;
    ['years', 'faculties', 'subjects', 'teachers', 'rooms', 'classes'].forEach((k) => { if (sc[k].length) bits.push(`${AU.FILTER_LABELS[k]}: ${list(sc[k])}`); });
    if (sc.days.length) bits.push('Day: ' + sc.days.join(', '));
    if (sc.periods.length) bits.push('Period: ' + sc.periods.map((p) => (M.periods.find((x) => x.pkey === p) || { label: p }).label).join(', '));
    if (sc.weekTypes.length < 3) bits.push('Lessons: ' + sc.weekTypes.map((w) => (w === 'AB' ? 'every week' : `Week ${w} only`)).join(', '));
    const typeNames = spec.pool.types.map((id) => (M.types.find((t) => t.id === id) || {}).name).filter(Boolean);
    const rbits = [];
    if (typeNames.length) rbits.push('Types: ' + list(typeNames));
    if (spec.pool.faculties.length) rbits.push('Resource faculty: ' + list(spec.pool.faculties));
    if (spec.pool.items.length) rbits.push('Items: ' + list(spec.pool.items.map((k) => (M.resByKey.get(k) || {}).name).filter(Boolean)));
    if (rbits.length) bits.push(rbits.join(spec.poolMode === 'any' ? ' OR ' : ' AND '));
    if (spec.madeBy === 'auto') bits.push('only auto-allocated');
    if (spec.madeBy === 'manual') bits.push('only hand-made');
    return bits.length ? bits.join(' · ') : 'Everything';
  };

  // Removes the given allocations and records the clear so it can be undone ("Restore") from the run history.
  AU.clear = async (spec, onProgress) => {
    if (!A.canManageData()) throw new Error('You do not have permission to do that.');
    const targets = AU.clearTargets(spec);
    if (!targets.length) return { removed: 0 };
    const placements = targets.map((a) => ({ r: a.resKey, c: a.classKey, by: a.by, at: a.at }));
    const removed = await M.bulkDeallocate(targets.map((a) => a.id), onProgress);
    await M.recordRun({
      id: U.hex(C.rand(8)), kind: 'clear', ruleId: '', ruleName: 'Cleared: ' + AU.describeClear(spec),
      by: A.session.user.displayName, at: new Date().toISOString(), placements, skipped: 0, steps: [],
    });
    return { removed };
  };

  // ---------- applying and undoing ----------
  // Re-checks every placement against the data as it is now (someone may have changed things since the preview).
  AU.apply = async (plan, onProgress) => {
    if (!A.canManageData()) throw new Error('You do not have permission to do that.');
    // first remove the existing allocations you chose to remove, so their resources are free for the placements below
    const gone = (plan.removed || []).filter((r) => M.allocById.has(r.resKey + '||' + r.classKey));
    if (gone.length) await M.bulkDeallocate(gone.map((r) => r.resKey + '||' + r.classKey));
    const occ = new Map();
    const slotsFor = (resKey) => {
      if (!occ.has(resKey)) {
        const set = new Set();
        for (const a of M.allocsByRes.get(resKey) || []) { const c = M.classByKey.get(a.classKey); if (c) M.slotsOf(c).forEach((s) => set.add(s)); }
        occ.set(resKey, set);
      }
      return occ.get(resKey);
    };
    const accepted = [];
    let skipped = 0;
    for (const p of plan.placements) {
      const c = M.classByKey.get(p.classKey);
      if (!c || !M.resByKey.has(p.resKey) || M.allocById.has(p.resKey + '||' + p.classKey)) { skipped++; continue; }
      const set = slotsFor(p.resKey);
      const slots = M.slotsOf(c);
      if (slots.some((s) => set.has(s))) { skipped++; continue; }
      slots.forEach((s) => set.add(s));
      accepted.push(p);
    }
    const by = `${A.session.user.displayName} (auto: ${plan.rule.name})`;
    const byManual = `${A.session.user.displayName} (auto: ${plan.rule.name}, added by hand)`;
    const byPref = `${A.session.user.displayName} (auto: ${plan.rule.name}, usual resource)`;
    await M.bulkAllocate(accepted.map((p) => ({ resKey: p.resKey, classKey: p.classKey, by: p.manual ? byManual : p.pref ? byPref : by })), by, onProgress);
    const run = {
      id: U.hex(C.rand(8)), ruleId: plan.rule.id, ruleName: plan.rule.name, by: A.session.user.displayName, at: new Date().toISOString(),
      placements: accepted.map((p) => ({ r: p.resKey, c: p.classKey, s: p.step, m: p.manual ? 1 : 0 })), skipped, manual: accepted.filter((p) => p.manual).length,
      steps: plan.steps.map((s) => ({ name: s.name, placed: s.placed })),
      removed: gone.map((r) => ({ r: r.resKey, c: r.classKey, by: r.by, at: r.at })),   // so Undo can put them back
    };
    await M.recordRun(run);
    return { run, placed: accepted.length, skipped, removed: gone.length };
  };
})();
