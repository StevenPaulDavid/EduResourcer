(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const M = (ER.model = {});
  const C = ER.crypto, S = ER.store, U = ER.util, A = ER.auth;

  const CLASS_DIR = 'Class_Data', RES_DIR = 'Resource_Data', ALLOC_DIR = 'Allocation_Data';
  const RULE_DIR = 'Rule_Data', RUN_DIR = 'Run_Data', SHARED_DIR = 'Shared_Data', PREF_DIR = 'Preference_Data';
  const CLASS_FILE = 'classes.edr';

  // ---------- raw state (what is on disk) ----------
  let classStamp = null;
  const typeFiles = new Map();   // file name -> { stamp, data }
  const allocFiles = new Map();  // file name -> { stamp, rec }
  const ruleFiles = new Map();   // auto-allocate rules: file name -> { stamp, data }
  const runFiles = new Map();    // auto-allocate run history: file name -> { stamp, data }
  const sharedFiles = new Map(); // shared-resource set-ups (groups + priorities): file name -> { stamp, data }
  const prefFiles = new Map();   // teachers' usual resources: file name -> { stamp, data }

  M.classes = [];
  M.classMeta = null;
  M.lastSync = null;

  // ---------- derived state ----------
  M.classByKey = new Map();
  M.types = [];                  // [{ id, name, importedAt, importedBy, items:[...] }]
  M.resByKey = new Map();        // 'typeId|rid' -> { key, typeId, typeName, rid, name, location, notes }
  M.allocs = [];                 // logical allocations
  M.allocById = new Map();
  M.allocsByClass = new Map();
  M.allocsByRes = new Map();
  M.rules = [];                  // saved auto-allocate rules
  M.runs = [];                   // auto-allocate run history (newest first)
  M.shared = [];                 // shared-resource set-ups
  M.prefs = [];                  // teachers' usual resources, best rank first: { id, teacher, items:[resKey...], rank }
  M.version = 0;                 // bumped whenever the derived data changes (lets other modules cache results)
  M.teachers = []; M.rooms = []; M.years = []; M.faculties = []; M.subjects = []; M.resFaculties = []; M.days = []; M.periods = [];

  M.reset = () => {
    classStamp = null; typeFiles.clear(); allocFiles.clear(); ruleFiles.clear(); runFiles.clear(); sharedFiles.clear(); prefFiles.clear();
    M.classes = []; M.classMeta = null; M.lastSync = null;
    derive();
  };

  // ---------- helpers ----------
  M.slotsOf = (c) => (c.week === 'AB' ? ['A', 'B'] : [c.week]).map((w) => `${c.day}|${c.pkey}|${w}`);
  M.classKey = (c) => `${U.norm(c.name)}|${c.day}|${U.norm(c.period)}|${c.week}`;
  M.typeColour = (typeId) => Math.max(0, M.types.findIndex((t) => t.id === typeId)) % 8;

  function derive() {
    M.classByKey = new Map(M.classes.map((c) => [c.key, c]));

    M.types = [...typeFiles.values()].map((f) => f.data).sort((a, b) => U.natCmp(a.name, b.name));
    M.resByKey = new Map();
    for (const t of M.types) {
      for (const it of t.items) {
        const key = t.id + '|' + it.id;
        M.resByKey.set(key, { key, typeId: t.id, typeName: t.name, rid: it.id, name: it.name, location: it.location || '', notes: it.notes || '', faculty: it.faculty || '' });
      }
    }

    // group allocation files into logical allocations (also folds in sync-conflict copies)
    const logical = new Map();
    for (const [file, { rec }] of allocFiles) {
      const id = rec.r + '||' + rec.c;
      let a = logical.get(id);
      if (!a) { a = { id, resKey: rec.r, classKey: rec.c, by: rec.by, at: rec.at, files: [], conflict: false, orphan: false }; logical.set(id, a); }
      a.files.push(file);
      if (rec.at < a.at) { a.at = rec.at; a.by = rec.by; }
    }
    M.version++;
    M.shared = [...sharedFiles.values()].map((f) => f.data);
    M.prefs = [...prefFiles.values()].map((f) => f.data).sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0) || U.natCmp(a.teacher, b.teacher));
    M.rules = [...ruleFiles.values()].map((f) => f.data).sort((a, b) => U.natCmp(a.name, b.name));
    M.runs = [...runFiles.values()].map((f) => f.data).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    M.allocs = [...logical.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
    M.allocById = new Map(M.allocs.map((a) => [a.id, a]));
    M.allocsByClass = new Map();
    M.allocsByRes = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

    const accepted = new Map(); // resKey -> Set of occupied slots
    for (const a of M.allocs) {
      const cls = M.classByKey.get(a.classKey);
      a.orphan = !cls || !M.resByKey.has(a.resKey);
      if (a.orphan) continue;
      push(M.allocsByClass, a.classKey, a);
      push(M.allocsByRes, a.resKey, a);
      // two people may have booked the same resource at the same moment on different machines
      const taken = accepted.get(a.resKey) || new Set();
      const slots = M.slotsOf(cls);
      if (slots.some((s) => taken.has(s))) a.conflict = true;
      else { slots.forEach((s) => taken.add(s)); accepted.set(a.resKey, taken); }
    }

    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort(U.natCmp);
    M.teachers = uniq(M.classes.map((c) => c.teacher));
    M.rooms = uniq(M.classes.map((c) => c.room));
    M.years = [...new Set(M.classes.map((c) => c.year).filter(Boolean))].sort(U.yearCmp);
    M.faculties = uniq(M.classes.map((c) => c.faculty));
    M.subjects = uniq(M.classes.map((c) => c.subject));
    M.resFaculties = uniq([...M.resByKey.values()].map((r) => r.faculty));
    const dayIdx = (d) => U.DAYS.indexOf(d);
    M.days = [...new Set(M.classes.map((c) => c.day))].sort((a, b) => dayIdx(a) - dayIdx(b));
    const per = new Map();
    for (const c of M.classes) if (!per.has(c.pkey)) per.set(c.pkey, c.period);
    M.periods = [...per.entries()].sort((a, b) => U.natCmp(a[0], b[0])).map(([pkey, label]) => ({ pkey, label }));
  }
  M.derive = derive;

  M.orphans = () => M.allocs.filter((a) => a.orphan);
  M.conflicts = () => M.allocs.filter((a) => a.conflict);

  // ---------- reading from disk (also used for background refresh) ----------
  async function syncClasses() {
    const f = (await S.list(CLASS_DIR)).find((x) => x.name === CLASS_FILE);
    const stamp = f ? f.stamp : '';
    if (stamp === classStamp) return false;
    if (!f) { M.classes = []; M.classMeta = null; classStamp = stamp; return true; }
    const data = await C.openJSON(A.session.dk, await S.read(CLASS_DIR, CLASS_FILE));
    M.classes = data.classes || [];
    M.classMeta = { at: data.importedAt, by: data.importedBy, source: data.source };
    classStamp = stamp;
    return true;
  }

  async function syncDir(dir, store, ingest) {
    const list = await S.list(dir);
    const names = new Set(list.map((x) => x.name));
    let changed = false;
    for (const name of [...store.keys()]) if (!names.has(name)) { store.delete(name); changed = true; }
    for (const f of list) {
      if (!f.name.endsWith('.edr')) continue;
      const have = store.get(f.name);
      if (have && have.stamp === f.stamp) continue;
      try {
        const data = await C.openJSON(A.session.dk, await S.read(dir, f.name));
        store.set(f.name, ingest(f.stamp, data));
        changed = true;
      } catch (e) {
        console.warn('Skipping unreadable file', dir, f.name, e);
      }
    }
    return changed;
  }
  const syncTypes = () => syncDir(RES_DIR, typeFiles, (stamp, data) => ({ stamp, data }));
  const syncAllocs = () => syncDir(ALLOC_DIR, allocFiles, (stamp, rec) => ({ stamp, rec }));
  const syncRules = () => syncDir(RULE_DIR, ruleFiles, (stamp, data) => ({ stamp, data }));
  const syncRuns = () => syncDir(RUN_DIR, runFiles, (stamp, data) => ({ stamp, data }));
  const syncShared = () => syncDir(SHARED_DIR, sharedFiles, (stamp, data) => ({ stamp, data }));
  const syncPrefs = () => syncDir(PREF_DIR, prefFiles, (stamp, data) => ({ stamp, data }));

  M.refresh = async () => {
    const r = await Promise.all([syncClasses(), syncTypes(), syncAllocs(), syncRules(), syncRuns(), syncShared(), syncPrefs()]);
    M.lastSync = new Date();
    const changed = r.some(Boolean);
    if (changed) derive();
    return changed;
  };
  M.load = async () => { await S.ensureDirs(); await M.refresh(); derive(); };

  // ---------- importing ----------
  const slug = (s) => U.norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Subjects belonging to a faculty (or all subjects when no faculty is given)
  M.subjectsOf = (faculty) => [...new Set(M.classes.filter((c) => !faculty || c.faculty === faculty).map((c) => c.subject).filter(Boolean))].sort(U.natCmp);

  // mapping: { name, room, period, day, week, teacher, year, faculty, subject } -> column index (or -1)
  // opts.guessSubject: when there is no subject column, take it from the class name ("9B/Maths" -> Maths)
  // opts.guessYear: when there is no year column, work it out from the start of the class name ("9B/Maths" -> Year 9)
  M.parseClasses = (rows, mapping, opts = {}) => {
    const valid = [], errors = [], notes = [];
    const seen = new Set();
    const get = (r, k) => (mapping[k] >= 0 ? (r[mapping[k]] || '').trim() : '');
    let blankWeek = 0, guessed = 0, guessedSubj = 0;
    const canonFaculty = U.canonizer(), canonSubject = U.canonizer();
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = get(r, 'name'), period = get(r, 'period');
      const dayRaw = get(r, 'day'), weekRaw = get(r, 'week');
      const day = U.normDay(dayRaw), week = U.normWeek(weekRaw);
      const problems = [];
      if (!name) problems.push('class name is blank');
      if (!period) problems.push('period is blank');
      if (!dayRaw) problems.push('day is blank'); else if (!day) problems.push(`day "${dayRaw}" is not recognised`);
      if (week === null) problems.push(`week "${weekRaw}" is not recognised (use A, B or leave blank for every week)`);
      if (problems.length) { errors.push({ line, msg: problems.join('; '), row: r }); return; }
      if (!weekRaw) blankWeek++;
      let year = '';
      if (mapping.year >= 0) year = U.normYear(get(r, 'year'));
      else if (opts.guessYear) { year = U.yearFromName(name); if (year) guessed++; }
      let subject = '';
      if (mapping.subject >= 0) subject = canonSubject(get(r, 'subject'));
      else if (opts.guessSubject) { subject = canonSubject(U.subjectFromName(name)); if (subject) guessedSubj++; }
      const rec = { name, room: get(r, 'room'), period, pkey: U.norm(period), day, week, teacher: get(r, 'teacher'), year, faculty: canonFaculty(get(r, 'faculty')), subject };
      rec.key = M.classKey(rec);
      if (seen.has(rec.key)) { errors.push({ line, msg: 'duplicate of an earlier row (same class, day, period and week)', row: r }); return; }
      seen.add(rec.key);
      valid.push(rec);
    });
    if (blankWeek) notes.push(`${blankWeek} row(s) have no week, so they are treated as running in both weeks A and B.`);
    if (opts.guessYear && mapping.year < 0) {
      notes.push(`Year group worked out from the class name for ${guessed} of ${valid.length} class(es).` + (guessed < valid.length ? ' The rest have no year group.' : ''));
    }
    if (opts.guessSubject && mapping.subject < 0) {
      notes.push(`Subject taken from the class name for ${guessedSubj} of ${valid.length} class(es).` + (guessedSubj < valid.length ? ' The rest have no subject.' : ''));
    }
    return { valid, errors, notes };
  };

  M.parseResources = (rows, mapping) => {
    const valid = [], errors = [];
    const seen = new Set();
    const get = (r, k) => (mapping[k] >= 0 ? (r[mapping[k]] || '').trim() : '');
    const canonFaculty = U.canonizer();
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = get(r, 'name');
      if (!name) { errors.push({ line, msg: 'name is blank', row: r }); return; }
      const id = slug(get(r, 'id') || name);
      if (!id) { errors.push({ line, msg: 'name/ID has no usable characters', row: r }); return; }
      if (seen.has(id)) { errors.push({ line, msg: `duplicate ID "${id}"`, row: r }); return; }
      seen.add(id);
      valid.push({ id, name, location: get(r, 'location'), notes: get(r, 'notes'), faculty: canonFaculty(get(r, 'faculty')) });
    });
    return { valid, errors, notes: [] };
  };

  M.findType = (name) => M.types.find((t) => U.norm(t.name) === U.norm(name));

  M.diffClasses = (valid) => {
    const oldKeys = new Set(M.classes.map((c) => c.key));
    const newKeys = new Set(valid.map((c) => c.key));
    const removed = [...oldKeys].filter((k) => !newKeys.has(k));
    const gone = new Set(removed);
    return {
      added: valid.filter((c) => !oldKeys.has(c.key)).length,
      kept: valid.filter((c) => oldKeys.has(c.key)).length,
      removed: removed.length,
      affected: M.allocs.filter((a) => gone.has(a.classKey)).length,
    };
  };

  M.diffResources = (typeName, valid) => {
    const t = M.findType(typeName);
    if (!t) return { existing: false, added: valid.length, kept: 0, removed: 0, affected: 0 };
    const oldIds = new Set(t.items.map((i) => i.id));
    const newIds = new Set(valid.map((i) => i.id));
    const removed = [...oldIds].filter((k) => !newIds.has(k));
    const gone = new Set(removed.map((id) => t.id + '|' + id));
    return {
      existing: true,
      added: valid.filter((i) => !oldIds.has(i.id)).length,
      kept: valid.filter((i) => oldIds.has(i.id)).length,
      removed: removed.length,
      affected: M.allocs.filter((a) => gone.has(a.resKey)).length,
    };
  };

  const need = (fn) => { if (!A.session || !fn()) throw new Error('You do not have permission to do that.'); };

  M.importClasses = async (valid, source) => {
    need(A.canManageData);
    const diff = M.diffClasses(valid);
    const payload = { importedAt: new Date().toISOString(), importedBy: A.session.user.displayName, source, classes: valid };
    classStamp = await S.write(CLASS_DIR, CLASS_FILE, await C.sealJSON(A.session.dk, payload));
    M.classes = valid;
    M.classMeta = { at: payload.importedAt, by: payload.importedBy, source };
    derive();
    return diff;
  };

  M.importResources = async (typeName, valid, source) => {
    need(A.canManageData);
    typeName = typeName.trim();
    const diff = M.diffResources(typeName, valid);
    const existing = M.findType(typeName);
    const id = existing ? existing.id : U.hex(C.rand(8));
    const data = { id, name: existing ? existing.name : typeName, importedAt: new Date().toISOString(), importedBy: A.session.user.displayName, source, items: valid };
    const file = id + '.edr';
    const stamp = await S.write(RES_DIR, file, await C.sealJSON(A.session.dk, data));
    typeFiles.set(file, { stamp, data });
    derive();
    return diff;
  };

  M.deleteType = async (typeId) => {
    need(A.canManageData);
    for (const a of M.allocs.filter((x) => x.resKey.startsWith(typeId + '|'))) await removeAllocFiles(a);
    await S.remove(RES_DIR, typeId + '.edr');
    typeFiles.delete(typeId + '.edr');
    derive();
  };

  // ---------- allocation ----------
  M.describeSlot = (c) => `${c.day} ${c.period}, Week ${c.week === 'AB' ? 'A+B' : c.week}`;

  // -> { ok, reason }
  M.dropStatus = (resKey, cls, ignoreId) => {
    const res = M.resByKey.get(resKey);
    if (!res) return { ok: false, reason: 'That resource no longer exists.' };
    if (!A.canEditClass(cls)) return { ok: false, reason: 'You can only change your own classes.' };
    const mine = new Set(M.slotsOf(cls));
    for (const a of M.allocsByRes.get(resKey) || []) {
      if (a.id === ignoreId) continue;
      const oc = M.classByKey.get(a.classKey);
      if (!oc) continue;
      if (oc.key === cls.key) return { ok: false, reason: `${res.name} is already on this class.` };
      if (M.slotsOf(oc).some((s) => mine.has(s)))
        return { ok: false, reason: `${res.name} is already with ${oc.name}${oc.teacher ? ' (' + oc.teacher + ')' : ''} at ${M.describeSlot(oc)}.` };
    }
    return { ok: true, reason: '' };
  };

  const fileFor = async (resKey, classKey) =>
    (await C.nameHash(A.session.nameKey, resKey + '|' + classKey)) + '.edr';

  M.allocate = async (resKey, classKey, ignoreId) => {
    const cls = M.classByKey.get(classKey);
    if (!cls) throw new Error('That class no longer exists.');
    const st = M.dropStatus(resKey, cls, ignoreId);
    if (!st.ok) throw new Error(st.reason);
    const rec = { r: resKey, c: classKey, by: A.session.user.displayName, at: new Date().toISOString() };
    const file = await fileFor(resKey, classKey);
    const stamp = await S.write(ALLOC_DIR, file, await C.sealJSON(A.session.dk, rec));
    allocFiles.set(file, { stamp, rec });
    derive();
  };

  async function removeAllocFiles(a) {
    for (const f of a.files) { await S.remove(ALLOC_DIR, f); allocFiles.delete(f); }
  }

  M.deallocate = async (allocId) => {
    const a = M.allocById.get(allocId);
    if (!a) return;
    const cls = M.classByKey.get(a.classKey);
    if (cls ? !A.canEditClass(cls) : !A.canManageData()) throw new Error('You do not have permission to remove that.');
    await removeAllocFiles(a);
    derive();
  };

  M.moveAlloc = async (allocId, newClassKey) => {
    const a = M.allocById.get(allocId);
    if (!a) throw new Error('That allocation no longer exists.');
    if (a.classKey === newClassKey) return;
    const oldCls = M.classByKey.get(a.classKey);
    if (oldCls && !A.canEditClass(oldCls)) throw new Error('You can only move resources from your own classes.');
    const cls = M.classByKey.get(newClassKey);
    if (!cls) throw new Error('That class no longer exists.');
    const st = M.dropStatus(a.resKey, cls, a.id);
    if (!st.ok) throw new Error(st.reason);
    await M.allocate(a.resKey, newClassKey, a.id);
    await M.deallocate(allocId);
  };

  M.removeOrphans = async () => {
    need(A.canManageData);
    for (const a of M.orphans()) await removeAllocFiles(a);
    derive();
  };

  // ---------- bulk operations (auto-allocate) ----------
  // Run `jobs` (async functions) a few at a time so a slow OneDrive folder is not hit with hundreds of writes at once.
  async function pool(jobs, limit, onProgress) {
    let next = 0, done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++;
        await jobs[i]();
        done++;
        if (onProgress) onProgress(done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  }

  // pairs: [{ resKey, classKey }]; `by` is stored as the allocator's name. The caller has already checked for clashes.
  M.bulkAllocate = async (pairs, by, onProgress) => {
    need(A.canManageData);
    const at = new Date().toISOString();
    const jobs = pairs.map((p) => async () => {
      const rec = { r: p.resKey, c: p.classKey, by: p.by || by, at: p.at || at };   // a restore keeps who/when it was first made
      const file = await fileFor(p.resKey, p.classKey);
      const stamp = await S.write(ALLOC_DIR, file, await C.sealJSON(A.session.dk, rec));
      allocFiles.set(file, { stamp, rec });
    });
    try { await pool(jobs, 6, onProgress); } finally { derive(); }
  };

  M.bulkDeallocate = async (allocIds, onProgress) => {
    need(A.canManageData);
    const list = allocIds.map((id) => M.allocById.get(id)).filter(Boolean);
    try { await pool(list.map((a) => () => removeAllocFiles(a)), 6, onProgress); } finally { derive(); }
    return list.length;
  };

  // ---------- auto-allocate rules and run history ----------
  const saveJson = async (dir, files, data) => {
    const file = data.id + '.edr';
    const stamp = await S.write(dir, file, await C.sealJSON(A.session.dk, data));
    files.set(file, { stamp, data });
    derive();
  };

  M.saveRule = async (rule) => {
    need(A.canManageData);
    const now = new Date().toISOString();
    const data = { ...rule, id: rule.id || U.hex(C.rand(8)), updatedAt: now, updatedBy: A.session.user.displayName };
    if (!data.createdAt) { data.createdAt = now; data.createdBy = A.session.user.displayName; }
    await saveJson(RULE_DIR, ruleFiles, data);
    return data;
  };

  M.deleteRule = async (id) => {
    need(A.canManageData);
    await S.remove(RULE_DIR, id + '.edr');
    ruleFiles.delete(id + '.edr');
    derive();
  };

  M.recordRun = async (run) => {
    need(A.canManageData);
    await saveJson(RUN_DIR, runFiles, run);
    return run;
  };

  // Auto-allocate runs: how many allocations are still in place (they may since have been moved or removed).
  // Clear runs (kind 'clear'): inPlace = how many removed allocations could be put back right now.
  const restorableOf = (items) => {
    const occ = new Map();
    const slotsFor = (resKey) => {
      if (!occ.has(resKey)) {
        const set = new Set();
        for (const a of M.allocsByRes.get(resKey) || []) { const c = M.classByKey.get(a.classKey); if (c) M.slotsOf(c).forEach((s) => set.add(s)); }
        occ.set(resKey, set);
      }
      return occ.get(resKey);
    };
    const ok = [];
    for (const p of items) {
      const c = M.classByKey.get(p.c);
      if (!c || !M.resByKey.has(p.r) || M.allocById.has(p.r + '||' + p.c)) continue;
      const set = slotsFor(p.r), slots = M.slotsOf(c);
      if (slots.some((s) => set.has(s))) continue;
      slots.forEach((s) => set.add(s));
      ok.push(p);
    }
    return ok;
  };
  const restorable = (run) => restorableOf(run.placements);
  M.runStatus = (run) => ({
    total: run.placements.length,
    inPlace: run.kind === 'clear' ? restorable(run).length : run.placements.filter((p) => M.allocById.has(p.r + '||' + p.c)).length,
  });

  M.undoRun = async (runId, onProgress) => {
    need(A.canManageData);
    const f = runFiles.get(runId + '.edr');
    if (!f) throw new Error('That run was not found.');
    const run = f.data;
    if (run.undoneAt) throw new Error('That run has already been undone.');
    if (run.kind === 'clear') {                       // undoing a clear = putting the allocations back
      const back = restorable(run);
      await M.bulkAllocate(back.map((p) => ({ resKey: p.r, classKey: p.c, by: p.by, at: p.at })), '', onProgress);
      await saveJson(RUN_DIR, runFiles, { ...run, undoneAt: new Date().toISOString(), undoneBy: A.session.user.displayName, undoneRemoved: back.length });
      return { removed: back.length, missing: run.placements.length - back.length, restored: true };
    }
    const ids = run.placements.map((p) => p.r + '||' + p.c).filter((id) => M.allocById.has(id));
    const removed = await M.bulkDeallocate(ids, onProgress);
    // allocations the run removed (you chose to replace them) go back where possible
    const back = restorableOf(run.removed || []);
    if (back.length) await M.bulkAllocate(back.map((p) => ({ resKey: p.r, classKey: p.c, by: p.by, at: p.at })), '');
    await saveJson(RUN_DIR, runFiles, { ...run, undoneAt: new Date().toISOString(), undoneBy: A.session.user.displayName, undoneRemoved: removed, undoneRestored: back.length });
    return { removed, missing: run.placements.length - removed, restoredCount: back.length };
  };

  // ---------- shared resources (groups + priorities); results are worked out live in shared.js ----------
  M.saveShared = async (cfg) => {
    need(A.canManageData);
    const now = new Date().toISOString();
    const data = { ...cfg, id: cfg.id || U.hex(C.rand(8)), updatedAt: now, updatedBy: A.session.user.displayName };
    if (!data.createdAt) { data.createdAt = now; data.createdBy = A.session.user.displayName; }
    await saveJson(SHARED_DIR, sharedFiles, data);
    return data;
  };
  M.deleteShared = async (id) => {
    need(A.canManageData);
    await S.remove(SHARED_DIR, id + '.edr');
    sharedFiles.delete(id + '.edr');
    derive();
  };

  // ---------- teachers' usual resources (honoured first by every auto-allocate run) ----------
  M.prefOf = (teacher) => M.prefs.find((p) => U.norm(p.teacher) === U.norm(teacher)) || null;
  M.savePref = async (pref) => {
    need(A.canManageData);
    const now = new Date().toISOString();
    const data = { ...pref, id: pref.id || U.hex(C.rand(8)), updatedAt: now, updatedBy: A.session.user.displayName };
    await saveJson(PREF_DIR, prefFiles, data);
    return data;
  };
  M.deletePref = async (id) => {
    need(A.canManageData);
    await S.remove(PREF_DIR, id + '.edr');
    prefFiles.delete(id + '.edr');
    derive();
  };

  M.deleteRun = async (runId) => {
    need(A.canManageData);
    await S.remove(RUN_DIR, runId + '.edr');
    runFiles.delete(runId + '.edr');
    derive();
  };

  // ---------- queries used by the UI ----------
  M.resourcesOfClass = (classKey) => (M.allocsByClass.get(classKey) || []).map((a) => ({ alloc: a, res: M.resByKey.get(a.resKey) }));
})();
