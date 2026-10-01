(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const { h, clear, toast } = ER.util;
  const U = ER.util, A = ER.auth, M = ER.model, S = ER.store;
  const root = document.getElementById('root');

  const IDLE_MS = 20 * 60 * 1000;   // auto-lock after 20 minutes of no activity
  const POLL_MS = 20 * 1000;        // pick up other people's changes

  const ui = (ER.ui = { view: 'allocate' });
  let pollTimer = null, idleTimer = null, syncEl = null, viewEl = null, navEl = null;

  const logo = () => h('div', { class: 'logo', 'aria-hidden': 'true' },
    h('i'), h('i'), h('i'));

  // ====================== centred screens ======================
  function screen(title, subtitle, ...content) {
    clear(root);
    root.appendChild(h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-corner' }, h('button', { class: 'btn link', type: 'button', onclick: () => ER.help.openModal() }, 'Help'), ER.theme.button()),
      h('div', { class: 'auth-card' },
        h('div', { class: 'brand-row' }, logo(), h('span', { class: 'brand' }, 'EduResourcer')),
        h('h1', null, title), subtitle ? h('p', { class: 'muted lead' }, subtitle) : null, ...content)));
  }
  const submitOn = (form, fn) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try { await fn(); }
    catch (err) { toast(err.message || String(err), 'error'); }
    finally { if (btn) btn.disabled = false; }
  });

  function welcomeScreen() {
    const items = [];
    if (S.supported) {
      items.push(h('button', { class: 'btn primary big', type: 'button', onclick: async () => {
        try { await S.choose(); await afterFolder(); }
        catch (e) { if (e.name !== 'AbortError') toast(e.message || 'Could not open that folder.', 'error'); }
      } }, 'Choose data folder'));
    } else {
      items.push(h('p', { class: 'callout warn' }, 'This browser cannot work with local folders. Please open EduResourcer in Microsoft Edge or Google Chrome.'));
    }
    if (S.demoSupported) items.push(h('button', { class: 'btn link', type: 'button', onclick: async () => { await S.useDemo(); await afterFolder(); } }, 'Just trying it? Use a demo store inside this browser'));
    screen('Welcome', 'Pick the folder that holds your EduResourcer data. This is usually a shared SharePoint/OneDrive folder, and it can be the same folder as this file. If it is empty, you will set up a new system there.',
      h('div', { class: 'stack' }, items),
      h('p', { class: 'muted small' }, 'Nothing is uploaded anywhere. All data stays in the folder you choose, encrypted.'));
  }

  function reconnectScreen() {
    screen('Reconnect to your folder', `Your browser needs permission to open “${S.pendingName()}” again.`,
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary big', type: 'button', onclick: async () => {
          try { if (await S.reconnect()) await afterFolder(); else toast('Permission was not granted.', 'error'); }
          catch (e) { toast(e.message, 'error'); }
        } }, 'Reconnect'),
        h('button', { class: 'btn link', type: 'button', onclick: async () => { await S.forget(); welcomeScreen(); } }, 'Use a different folder')));
  }

  async function afterFolder() {
    try { await A.loadSystem(); } catch (e) { toast('Could not read the folder: ' + e.message, 'error'); welcomeScreen(); return; }
    if (A.isSetUp()) loginScreen(); else setupScreen();
  }

  function setupScreen() {
    const f = {
      name: h('input', { type: 'text', autocomplete: 'off', required: true }),
      user: h('input', { type: 'text', autocomplete: 'username', required: true }),
      pw: h('input', { type: 'password', autocomplete: 'new-password', required: true }),
      pw2: h('input', { type: 'password', autocomplete: 'new-password', required: true }),
    };
    const form = h('form', { class: 'stack' },
      U.field('Your name', f.name), U.field('Username', f.user), U.field(`Password (min ${A.MIN_PASSWORD} characters)`, f.pw), U.field('Repeat password', f.pw2),
      h('button', { class: 'btn primary big', type: 'submit' }, 'Create system'),
      h('button', { class: 'btn link', type: 'button', onclick: async () => { await S.forget(); welcomeScreen(); } }, `Use a different folder (current: ${S.folderName()})`));
    submitOn(form, async () => {
      if (f.pw.value !== f.pw2.value) throw new Error('The passwords do not match.');
      const key = await A.setup({ displayName: f.name.value, username: f.user.value, password: f.pw.value });
      clear(root);
      ER.admin.showRecoveryKey(key, { required: true, onDone: () => enterApp() });
    });
    screen('Set up EduResourcer', `No system found in “${S.folderName()}”. Create the first System admin account to set one up here.`, form);
  }

  function loginScreen(msg) {
    const user = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const form = h('form', { class: 'stack' }, U.field('Username', user), U.field('Password', pw),
      h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in'),
      h('div', { class: 'link-row' },
        h('button', { class: 'btn link', type: 'button', onclick: recoveryScreen }, 'Forgot password? Use recovery key'),
        h('button', { class: 'btn link', type: 'button', onclick: async () => { await S.forget(); A.lock(); welcomeScreen(); } }, 'Change folder')));
    submitOn(form, async () => {
      await A.login(user.value, pw.value);
      if (A.user().mustChange) { await forcePasswordChange(); }
      await enterApp();
    });
    screen('Sign in', msg || `Data folder: ${S.folderName()}`, form);
    setTimeout(() => user.focus(), 30);
  }

  function forcePasswordChange() {
    return new Promise((resolve) => {
      const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
      const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
      U.modal({ title: 'Choose your own password', dismissible: false,
        body: h('div', null, h('p', { class: 'muted' }, 'Your password was set by an administrator. Please choose a new one to continue.'),
          h('div', { class: 'form-grid one' }, U.field(`New password (min ${A.MIN_PASSWORD} characters)`, n1), U.field('Repeat new password', n2))),
        actions: [{ label: 'Save and continue', kind: 'primary', onClick: async () => {
          if (n1.value !== n2.value) throw new Error('The passwords do not match.');
          await A.setNewPasswordAfterReset(n1.value);
          resolve();
        } }] });
    });
  }

  function recoveryScreen() {
    const key = h('input', { type: 'text', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX-…', required: true });
    const form = h('form', { class: 'stack' }, U.field('Recovery key', key),
      h('button', { class: 'btn primary big', type: 'submit' }, 'Check key'),
      h('button', { class: 'btn link', type: 'button', onclick: () => loginScreen() }, 'Back to sign in'));
    submitOn(form, async () => {
      const ctx = await A.recover(key.value);
      if (!ctx.admins.length) throw new Error('No System admin accounts were found.');
      const sel = h('select', null, ctx.admins.map((a) => h('option', { value: a.username }, `${a.displayName} (${a.username})`)));
      const p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
      const p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
      const f2 = h('form', { class: 'stack' }, U.field('System admin account', sel), U.field(`New password (min ${A.MIN_PASSWORD} characters)`, p1), U.field('Repeat new password', p2),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Set password and sign in'));
      submitOn(f2, async () => {
        if (p1.value !== p2.value) throw new Error('The passwords do not match.');
        await A.recoveryReset(ctx, sel.value, p1.value);
        await A.login(sel.value, p1.value);
        await enterApp();
      });
      screen('Recovery key accepted', 'Choose a System admin account and set a new password for it.', f2);
    });
    screen('Use recovery key', 'Enter the recovery key that was shown when this system was set up.', form);
  }

  // ====================== main shell ======================
  async function enterApp() {
    screen('Loading…', 'Reading and decrypting your data.');
    try { M.reset(); await M.load(); }
    catch (e) { console.error(e); toast('Could not load data: ' + e.message, 'error'); A.lock(); loginScreen(); return; }
    ui.view = 'allocate';
    buildShell();
    startTimers();
  }

  function navItems() {
    const items = [['allocate', 'Allocate'], ['shared', 'Shared'], ['reports', 'Reports']];
    if (A.canManageData()) items.push(['auto', 'Auto-allocate']);
    if (A.canManageData()) items.push(['data', 'Data']);
    if (A.isSysAdmin()) items.push(['users', 'Users']);
    items.push(['help', 'Help']);
    return items;
  }

  function buildShell() {
    const user = A.user();
    document.body.classList.toggle('no-print', !A.canExport());
    navEl = h('nav', { class: 'nav', 'aria-label': 'Main' });
    syncEl = h('button', { class: 'sync', type: 'button', title: 'Refresh now', onclick: () => doRefresh(true) }, 'Synced');
    viewEl = h('main', { class: 'view' });
    clear(root);
    root.appendChild(h('div', { class: 'app' },
      h('header', { class: 'topbar' },
        h('div', { class: 'brand-row' }, logo(), h('span', { class: 'brand' }, 'EduResourcer')),
        navEl, h('span', { class: 'spacer' }), syncEl, ER.theme.button(),
        h('button', { class: 'user-chip', type: 'button', title: 'My account', onclick: () => ER.admin.openAccount() },
          h('span', { class: 'avatar' }, (user.displayName || '?').trim().charAt(0).toUpperCase()),
          h('span', { class: 'user-text' }, h('strong', null, user.displayName), h('small', null, A.ROLES[user.role]))),
        h('button', { class: 'btn ghost small', type: 'button', onclick: lockNow }, 'Lock')),
      viewEl));
    renderNav();
    renderView();
    setSync();
  }
  ui.refreshShell = () => { if (A.session) buildShell(); };

  function renderNav() {
    clear(navEl);
    for (const [k, label] of navItems()) {
      navEl.appendChild(h('button', { class: 'nav-btn' + (ui.view === k ? ' on' : ''), type: 'button', 'aria-current': ui.view === k ? 'page' : null, onclick: () => ui.go(k) }, label));
    }
  }

  function renderView() {
    if (!navItems().some(([k]) => k === ui.view)) ui.view = 'allocate';
    document.body.dataset.view = ui.view;
    if (ui.view === 'allocate') ER.allocate.render(viewEl);
    else if (ui.view === 'reports') ER.reports.render(viewEl);
    else if (ui.view === 'auto') ER.autoUi.render(viewEl);
    else if (ui.view === 'shared') ER.sharedUi.render(viewEl);
    else if (ui.view === 'data') ER.admin.renderData(viewEl);
    else if (ui.view === 'users') ER.admin.renderUsers(viewEl);
    else if (ui.view === 'help') ER.help.render(viewEl);
  }

  ui.go = (v) => { ui.view = v; renderNav(); renderView(); };

  // re-draw after an import/other change
  ui.refresh = (soft) => {
    if (!A.session || !viewEl) return;
    if (ui.view === 'allocate') { if (soft && !viewEl.querySelector('.toolbar')) return renderView(); ER.allocate.refreshAll(); if (!soft) renderView(); }
    else if (ui.view === 'reports') ER.reports.rerun();
    else if (ui.view === 'auto') ER.autoUi.softRefresh();
    else if (ui.view === 'shared') ER.sharedUi.softRefresh();
    else if (ui.view === 'data') ER.admin.renderData(viewEl);
    setSync();
  };

  function setSync(err) {
    if (!syncEl) return;
    syncEl.classList.toggle('err', !!err);
    syncEl.textContent = err ? 'Sync problem — retry' : 'Synced ' + (M.lastSync ? U.fmtTime(M.lastSync) : '');
  }

  async function doRefresh(manual) {
    if (!A.session) return;
    try {
      const changed = await M.refresh();
      setSync();
      if (changed) { ui.refresh(true); if (manual) toast('Updated with the latest changes.', 'success', 1800); }
      else if (manual) toast('Already up to date.', 'info', 1500);
    } catch (e) {
      console.warn(e);
      setSync(e);
      if (manual) toast('Could not read the data folder: ' + e.message, 'error');
    }
  }

  // ====================== timers / locking ======================
  function startTimers() {
    stopTimers();
    pollTimer = setInterval(() => {
      if (!A.session || document.hidden || ER.allocate.isDragging()) return;
      doRefresh(false);
    }, POLL_MS);
    bumpIdle();
  }
  function stopTimers() { clearInterval(pollTimer); clearTimeout(idleTimer); pollTimer = idleTimer = null; }
  function bumpIdle() {
    if (!A.session) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => lockNow('Locked after 20 minutes of inactivity.'), IDLE_MS);
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, bumpIdle, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && A.session) doRefresh(false); });

  function lockNow(msg) {
    stopTimers();
    A.lock();
    M.reset();
    ER.allocate.resetUi();
    ER.autoUi.reset();
    ER.sharedUi.reset();
    document.getElementById('printArea').innerHTML = '';
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    document.body.classList.remove('armed', 'dragging', 'no-print', 'printing');
    document.body.removeAttribute('data-view');
    loginScreen(typeof msg === 'string' ? msg : undefined);
  }

  // ====================== boot ======================
  async function boot() {
    if (!window.crypto || !crypto.subtle) {
      screen('Browser not supported', 'EduResourcer needs a modern browser with built-in encryption (Edge or Chrome).');
      return;
    }
    screen('Starting…', '');
    let state = 'none';
    try { state = await S.restore(); } catch (e) { console.warn(e); }
    if (state === 'ready') await afterFolder();
    else if (state === 'needs-permission') reconnectScreen();
    else welcomeScreen();
  }
  boot();
})();
