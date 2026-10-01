(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const A = (ER.auth = {});
  const C = ER.crypto, S = ER.store, U = ER.util;
  const LOGIN = 'Login_Data';

  A.ROLES = {
    sysadmin: 'System admin',
    resadmin: 'Resource admin',
    staff: 'Staff',
    readonly: 'Read-only',
  };
  A.MIN_PASSWORD = 8;

  let sys = null;      // contents of system.json (public: name salt + format version)
  A.session = null;    // { user, dk, raw, nameKey }

  // ---------- permissions (enforced by the app; see README for the honest limits) ----------
  const role = () => (A.session ? A.session.user.role : null);
  A.isSysAdmin = () => role() === 'sysadmin';
  A.canManageData = () => role() === 'sysadmin' || role() === 'resadmin';
  // Read-only accounts can look but not take copies away (CSV export / print).
  A.canExport = () => !!A.session && role() !== 'readonly';
  A.canAllocateAny = () => role() === 'sysadmin' || role() === 'resadmin';
  A.canEditClass = (cls) => {
    if (!A.session || !cls) return false;
    const r = role();
    if (r === 'sysadmin' || r === 'resadmin') return true;
    if (r === 'staff') {
      const t = U.norm(A.session.user.teacher);
      return !!t && U.norm(cls.teacher) === t;
    }
    return false;
  };
  A.user = () => (A.session ? A.session.user : null);

  // ---------- system file ----------
  A.loadSystem = async () => {
    const txt = await S.readText(LOGIN, 'system.json');
    sys = txt ? JSON.parse(txt) : null;
    return sys;
  };
  A.isSetUp = () => !!sys;

  const loginFile = async (username) =>
    (await C.sha256hex(sys.nameSalt + '|' + U.norm(username))).slice(0, 32) + '.json';

  const checkUsername = (u) => {
    if (!/^[a-z0-9._@-]{2,60}$/.test(u)) throw new Error('Usernames can use letters, numbers and . _ @ - (2 to 60 characters).');
  };
  const checkPassword = (p) => {
    if (!p || p.length < A.MIN_PASSWORD) throw new Error(`Password must be at least ${A.MIN_PASSWORD} characters.`);
  };

  // Build a login record: password hash (verifier), the data key wrapped by the password, and the profile
  // encrypted with the data key.
  const buildRecord = async (raw, dk, profile, password) => {
    const salt = C.rand(16);
    const { auth, kek } = await C.stretch(password, salt, C.ITER);
    return {
      v: 1,
      iter: C.ITER,
      salt: U.b64(salt),
      auth: U.b64(auth),
      wrap: U.b64(await C.seal(kek, raw)),
      profile: U.b64(await C.sealJSON(dk, profile)),
    };
  };
  const putRecord = (username, rec) => loginFile(username).then((f) => S.writeText(LOGIN, f, JSON.stringify(rec)));
  const getRecord = async (username) => {
    const txt = await S.readText(LOGIN, await loginFile(username));
    return txt ? JSON.parse(txt) : null;
  };

  const startSession = async (raw, dk, profile) => {
    A.session = { user: profile, dk, raw, nameKey: await C.nameKey(raw) };
  };

  // ---------- first-run setup ----------
  A.setup = async ({ displayName, username, password }) => {
    if (sys) throw new Error('This folder is already set up.');
    const u = U.norm(username);
    checkUsername(u);
    checkPassword(password);
    if (!displayName.trim()) throw new Error('Please enter a display name.');
    await S.ensureDirs();
    const dk = await C.newDataKey();
    const raw = await C.exportKey(dk);
    sys = { v: 1, nameSalt: U.b64(C.rand(16)), created: new Date().toISOString() };
    const profile = { username: u, displayName: displayName.trim(), role: 'sysadmin', teacher: '', created: sys.created, mustChange: false };
    await putRecord(u, await buildRecord(raw, dk, profile, password));
    const recoveryKey = await A.makeRecovery(raw);
    await S.writeText(LOGIN, 'system.json', JSON.stringify(sys));
    await startSession(raw, dk, profile);
    return recoveryKey;
  };

  // ---------- login / lock ----------
  A.login = async (username, password) => {
    const u = U.norm(username);
    const bad = new Error('Incorrect username or password.');
    if (!u || !password) throw bad;
    const rec = await getRecord(u);
    if (!rec) { await C.stretch(password, C.rand(16), C.ITER); throw bad; } // keep timing similar
    const { auth, kek } = await C.stretch(password, U.unb64(rec.salt), rec.iter);
    if (!C.equal(auth, U.unb64(rec.auth))) throw bad;
    const raw = await C.open(kek, U.unb64(rec.wrap));
    const dk = await C.importDataKey(raw);
    const profile = await C.openJSON(dk, U.unb64(rec.profile));
    await startSession(raw, dk, profile);
    return profile;
  };
  A.lock = () => { A.session = null; };

  // ---------- user management (system admin) ----------
  A.listUsers = async (dk) => {
    dk = dk || A.session.dk;
    const files = await S.list(LOGIN);
    const out = [];
    for (const f of files) {
      if (f.name === 'system.json' || f.name === 'recovery.json' || !f.name.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(await S.readText(LOGIN, f.name));
        out.push(await C.openJSON(dk, U.unb64(rec.profile)));
      } catch (e) { /* ignore unreadable/foreign files */ }
    }
    return out.sort((a, b) => U.natCmp(a.displayName, b.displayName));
  };

  A.createUser = async ({ username, displayName, role: r, teacher }, password) => {
    const u = U.norm(username);
    checkUsername(u);
    checkPassword(password);
    if (!displayName.trim()) throw new Error('Please enter a display name.');
    if (!A.ROLES[r]) throw new Error('Choose a role.');
    if (await getRecord(u)) throw new Error('That username already exists.');
    const profile = { username: u, displayName: displayName.trim(), role: r, teacher: (teacher || '').trim(), created: new Date().toISOString(), mustChange: true };
    await putRecord(u, await buildRecord(A.session.raw, A.session.dk, profile, password));
  };

  A.updateUser = async (username, changes, users) => {
    const rec = await getRecord(username);
    if (!rec) throw new Error('User not found.');
    const profile = await C.openJSON(A.session.dk, U.unb64(rec.profile));
    const next = { ...profile, ...changes };
    if (!next.displayName.trim()) throw new Error('Please enter a display name.');
    if (profile.role === 'sysadmin' && next.role !== 'sysadmin') {
      const admins = (users || (await A.listUsers())).filter((x) => x.role === 'sysadmin');
      if (admins.length <= 1) throw new Error('There must be at least one System admin.');
    }
    rec.profile = U.b64(await C.sealJSON(A.session.dk, next));
    await putRecord(username, rec);
    if (A.session.user.username === profile.username) A.session.user = next;
  };

  A.resetPassword = async (username, newPassword, mustChange = true) => {
    checkPassword(newPassword);
    const rec = await getRecord(username);
    if (!rec) throw new Error('User not found.');
    const profile = await C.openJSON(A.session.dk, U.unb64(rec.profile));
    profile.mustChange = mustChange;
    await putRecord(username, await buildRecord(A.session.raw, A.session.dk, profile, newPassword));
  };

  A.deleteUser = async (username) => {
    if (U.norm(username) === A.session.user.username) throw new Error('You cannot delete your own account.');
    const users = await A.listUsers();
    const target = users.find((x) => x.username === U.norm(username));
    if (target && target.role === 'sysadmin' && users.filter((x) => x.role === 'sysadmin').length <= 1)
      throw new Error('There must be at least one System admin.');
    await S.remove(LOGIN, await loginFile(username));
  };

  A.changeOwnPassword = async (oldPassword, newPassword) => {
    checkPassword(newPassword);
    const me = A.session.user;
    const rec = await getRecord(me.username);
    const { auth } = await C.stretch(oldPassword, U.unb64(rec.salt), rec.iter);
    if (!C.equal(auth, U.unb64(rec.auth))) throw new Error('Your current password is incorrect.');
    const next = { ...me, mustChange: false };
    await putRecord(me.username, await buildRecord(A.session.raw, A.session.dk, next, newPassword));
    A.session.user = next;
  };

  // Forced change (after an admin reset) - the temporary password was just verified by login.
  A.setNewPasswordAfterReset = async (newPassword) => {
    checkPassword(newPassword);
    const me = A.session.user;
    const next = { ...me, mustChange: false };
    await putRecord(me.username, await buildRecord(A.session.raw, A.session.dk, next, newPassword));
    A.session.user = next;
  };

  // ---------- recovery key ----------
  A.makeRecovery = async (raw) => {
    const key = C.newRecoveryKey();
    const salt = C.rand(16);
    const { kek } = await C.stretch(C.normRecovery(key), salt, C.RECOVERY_ITER);
    const wrap = U.b64(await C.seal(kek, raw));
    await S.writeText(LOGIN, 'recovery.json', JSON.stringify({ v: 1, iter: C.RECOVERY_ITER, salt: U.b64(salt), wrap }));
    return key;
  };
  A.regenerateRecovery = () => {
    if (!A.isSysAdmin()) throw new Error('Only a System admin can do this.');
    return A.makeRecovery(A.session.raw);
  };

  // Returns { raw, dk, admins } when the key is right.
  A.recover = async (keyText) => {
    const txt = await S.readText(LOGIN, 'recovery.json');
    if (!txt) throw new Error('No recovery key has been set up for this folder.');
    const rec = JSON.parse(txt);
    const { kek } = await C.stretch(C.normRecovery(keyText), U.unb64(rec.salt), rec.iter);
    let raw;
    try { raw = await C.open(kek, U.unb64(rec.wrap)); }
    catch (e) { throw new Error('That recovery key is not correct.'); }
    const dk = await C.importDataKey(raw);
    const admins = (await A.listUsers(dk)).filter((u) => u.role === 'sysadmin');
    return { raw, dk, admins };
  };

  A.recoveryReset = async (ctx, username, newPassword) => {
    checkPassword(newPassword);
    const rec = await getRecord(username);
    if (!rec) throw new Error('User not found.');
    const profile = await C.openJSON(ctx.dk, U.unb64(rec.profile));
    profile.mustChange = false;
    await putRecord(username, await buildRecord(ctx.raw, ctx.dk, profile, newPassword));
  };
})();
