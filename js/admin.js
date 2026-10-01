(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const AD = (ER.admin = {});
  const { h, clear, toast } = ER.util;
  const U = ER.util, M = ER.model, A = ER.auth;

  // ====================== DATA PAGE ======================
  AD.renderData = (container) => {
    clear(container);
    const cm = M.classMeta;
    const classCard = h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Classes'),
        h('p', { class: 'muted' }, M.classes.length
          ? `${M.classes.length} class slots · ${M.teachers.length} teachers · ${M.rooms.length} rooms` + (M.years.length ? ` · ${M.years.length} year groups` : '') + (M.faculties.length ? ` · ${M.faculties.length} faculties` : '') + (M.subjects.length ? ` · ${M.subjects.length} subjects` : '')
          : 'No classes imported yet.')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ER.importer.openClasses() }, M.classes.length ? 'Re-import classes' : 'Import classes')),
      cm ? h('p', { class: 'muted small' }, `Last import: ${U.fmtDateTime(cm.at)} by ${cm.by || 'unknown'} from “${cm.source}”`) : null);

    const typeRows = M.types.map((t) => {
      const used = M.allocs.filter((a) => !a.orphan && a.resKey.startsWith(t.id + '|')).length;
      return h('div', { class: 'row-item' },
        h('span', { class: 'type-swatch', dataset: { t: String(M.typeColour(t.id)) } }),
        h('div', { class: 'row-main' }, h('strong', null, t.name),
          h('span', { class: 'muted small' }, `${t.items.length} resources · ${used} allocations · imported ${U.fmtDateTime(t.importedAt)} by ${t.importedBy || 'unknown'}`)),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => ER.importer.openResources() }, 'Import / update'),
        h('button', { class: 'btn danger-ghost small', type: 'button', onclick: async () => {
          if (!(await U.confirm(`Delete the “${t.name}” type, its ${t.items.length} resources and ${used} allocation(s)? This cannot be undone.`, { ok: 'Delete type', danger: true, title: 'Delete resource type?' }))) return;
          try { await M.deleteType(t.id); toast(`Deleted “${t.name}”.`, 'success'); AD.renderData(container); } catch (e) { toast(e.message, 'error'); }
        } }, 'Delete'));
    });
    const resCard = h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Resources'),
        h('p', { class: 'muted' }, M.types.length ? `${M.types.length} type(s). Each CSV you import becomes one tab in the resource bank.` : 'No resources imported yet.')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ER.importer.openResources() }, 'Import resource type')),
      typeRows.length ? h('div', { class: 'row-list' }, typeRows) : null);

    const orphans = M.orphans();
    let reviewCard = null;
    if (orphans.length) {
      reviewCard = h('section', { class: 'panel warn' },
        h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Allocations to review'),
          h('p', { class: 'muted' }, 'These allocations point at a class or resource that is no longer in the imported lists. Re-import to bring it back, or remove them.')),
        h('button', { class: 'btn danger-ghost', type: 'button', onclick: async () => {
          if (!(await U.confirm(`Remove all ${orphans.length} allocation(s) listed here?`, { ok: 'Remove all', danger: true }))) return;
          try { await M.removeOrphans(); toast('Removed.', 'success'); AD.renderData(container); } catch (e) { toast(e.message, 'error'); }
        } }, 'Remove all')),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Resource', 'Class', 'Problem', 'Allocated by'].map((c) => h('th', null, c)))),
          h('tbody', null, orphans.slice(0, 200).map((a) => {
            const r = M.resByKey.get(a.resKey), c = M.classByKey.get(a.classKey);
            const [cn, cd, cp, cw] = a.classKey.split('|');
            return h('tr', null,
              h('td', null, r ? r.name : '(missing resource)'),
              h('td', null, c ? c.name : `${cn} (${cd} ${cp} wk ${cw})`),
              h('td', null, !c && !r ? 'Class and resource missing' : !c ? 'Class not in list' : 'Resource not in list'),
              h('td', null, a.by || ''));
          })))));
    }

    const conflicts = M.conflicts();
    const confCard = conflicts.length ? h('section', { class: 'panel bad' },
      h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Booking clashes'),
        h('p', { class: 'muted' }, 'Two people booked the same resource for the same slot at the same time. The earlier booking stands; remove the later one (shown in red on the timetable).'))),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Resource', 'Class', 'When', 'Booked by'].map((c) => h('th', null, c)))),
        h('tbody', null, conflicts.map((a) => {
          const r = M.resByKey.get(a.resKey), c = M.classByKey.get(a.classKey);
          return h('tr', null, h('td', null, r.name), h('td', null, c.name), h('td', null, M.describeSlot(c)), h('td', null, a.by || ''));
        }))))) : null;

    container.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, 'Data')),
      h('div', { class: 'folder-note' }, h('strong', null, 'Data folder: '), ER.store.folderName(),
        h('span', { class: 'muted' }, '  ·  Class_Data, Resource_Data, Allocation_Data and Login_Data hold only encrypted files.')),
      classCard, resCard, confCard, reviewCard));
  };

  // ====================== USERS PAGE ======================
  const roleOptions = (sel) => Object.entries(A.ROLES).map(([k, v]) => h('option', { value: k, selected: k === sel }, v));

  function userForm(existing) {
    const dl = h('datalist', { id: 'teacherNames' }, M.teachers.map((t) => h('option', { value: t })));
    const f = {
      displayName: h('input', { type: 'text', value: existing ? existing.displayName : '', autocomplete: 'off' }),
      username: h('input', { type: 'text', value: existing ? existing.username : '', autocomplete: 'off', disabled: !!existing }),
      role: h('select', null, roleOptions(existing ? existing.role : 'staff')),
      teacher: h('input', { type: 'text', value: existing ? existing.teacher : '', list: 'teacherNames', autocomplete: 'off', placeholder: 'Exactly as in the class CSV' }),
      password: h('input', { type: 'text', value: existing ? '' : U.randomPassword(), autocomplete: 'off' }),
    };
    const node = h('div', { class: 'form-grid' },
      U.field('Display name', f.displayName), U.field('Username', f.username, existing ? 'Usernames cannot be changed.' : 'Used to sign in.'),
      U.field('Role', f.role),
      U.field('Teacher name (links the login to their classes)', f.teacher, 'Staff can only assign resources to classes with this teacher name.'),
      existing ? null : U.field('Temporary password', f.password, 'Share this with the person. They must change it at first sign-in.'), dl);
    return { f, node };
  }

  AD.renderUsers = async (container) => {
    clear(container);
    container.appendChild(h('div', { class: 'page' }, h('p', { class: 'muted' }, 'Loading users…')));
    let users;
    try { users = await A.listUsers(); } catch (e) { toast(e.message, 'error'); users = []; }
    clear(container);
    const me = A.user().username;

    const rows = users.map((u) => h('tr', null,
      h('td', null, h('strong', null, u.displayName), u.username === me ? h('span', { class: 'pill' }, 'you') : null),
      h('td', null, u.username),
      h('td', null, h('span', { class: 'role role-' + u.role }, A.ROLES[u.role])),
      h('td', null, u.teacher || '—'),
      h('td', null, u.mustChange ? h('span', { class: 'pill warn' }, 'must change password') : ''),
      h('td', { class: 'actions' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => editUser(u) }, 'Edit'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => resetPw(u) }, 'Reset password'),
        u.username === me ? null : h('button', { class: 'btn danger-ghost small', type: 'button', onclick: () => delUser(u) }, 'Delete'))));

    const reload = () => AD.renderUsers(container);

    function addUser() {
      const { f, node } = userForm(null);
      U.modal({ title: 'Add a user', body: node, actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Create user', kind: 'primary', onClick: async () => {
          await A.createUser({ username: f.username.value, displayName: f.displayName.value, role: f.role.value, teacher: f.teacher.value }, f.password.value);
          toast(`Created ${f.username.value.trim().toLowerCase()}. Temporary password: ${f.password.value}`, 'success', 12000);
          reload();
        } }] });
    }
    function editUser(u) {
      const { f, node } = userForm(u);
      U.modal({ title: 'Edit ' + u.displayName, body: node, actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Save', kind: 'primary', onClick: async () => {
          await A.updateUser(u.username, { displayName: f.displayName.value, role: f.role.value, teacher: f.teacher.value.trim() }, users);
          toast('Saved.', 'success'); reload();
          if (u.username === me && ER.ui) ER.ui.refreshShell();
        } }] });
    }
    function resetPw(u) {
      const pw = h('input', { type: 'text', value: U.randomPassword(), autocomplete: 'off' });
      U.modal({ title: 'Reset password for ' + u.displayName,
        body: h('div', null, U.field('New temporary password', pw, 'They will be asked to choose their own at next sign-in.')),
        actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Reset password', kind: 'primary', onClick: async () => {
          await A.resetPassword(u.username, pw.value, true);
          toast(`Password reset. Temporary password: ${pw.value}`, 'success', 12000); reload();
        } }] });
    }
    async function delUser(u) {
      if (!(await U.confirm(`Delete ${u.displayName} (${u.username})? They will no longer be able to sign in.`, { ok: 'Delete user', danger: true }))) return;
      try { await A.deleteUser(u.username); toast('User deleted.', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
    }

    function newRecovery() {
      U.confirm('This creates a new recovery key and permanently invalidates the old one. Make sure you store the new key safely.', { ok: 'Create new key', title: 'New recovery key?' })
        .then(async (ok) => {
          if (!ok) return;
          try { AD.showRecoveryKey(await A.regenerateRecovery()); } catch (e) { toast(e.message, 'error'); }
        });
    }

    container.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', null, 'Users'), h('button', { class: 'btn primary', type: 'button', onclick: addUser }, 'Add user')),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Name', 'Username', 'Role', 'Teacher link', '', ''].map((c) => h('th', null, c)))),
        h('tbody', null, rows))),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Recovery key'),
          h('p', { class: 'muted' }, 'Everything is encrypted, so if every System admin forgets their password the recovery key is the only way back in. Store it somewhere safe and offline (not in this folder).')),
        h('button', { class: 'btn ghost', type: 'button', onclick: newRecovery }, 'Create a new recovery key')))));
  };

  // Shared with first-run setup.
  AD.showRecoveryKey = (key, { onDone, required } = {}) => {
    const box = h('div', { class: 'recovery-key', 'aria-label': 'Recovery key' }, key);
    const ack = h('input', { type: 'checkbox', onchange: () => { if (api.buttons.done) api.buttons.done.disabled = !ack.checked; } });
    const body = h('div', null,
      h('p', null, 'Write this down or save it somewhere safe. It is shown only once and is the only way to regain access if all System admin passwords are lost.'),
      box,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { navigator.clipboard.writeText(key).then(() => toast('Copied.', 'success', 1500)).catch(() => toast('Could not copy — select the text instead.', 'error')); } }, 'Copy'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => U.download('EduResourcer-recovery-key.txt', `EduResourcer recovery key\r\n\r\n${key}\r\n\r\nKeep this file OUTSIDE the EduResourcer data folder.\r\n`, 'text/plain;charset=utf-8') }, 'Download .txt')),
      h('label', { class: 'check' }, ack, 'I have stored the recovery key safely'));
    const api = U.modal({ title: 'Your recovery key', body, dismissible: !required,
      actions: [{ id: 'done', label: 'Continue', kind: 'primary', onClick: () => { if (onDone) onDone(); } }] });
    api.buttons.done.disabled = true;
  };

  // ====================== ACCOUNT ======================
  AD.openAccount = () => {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const u = A.user();
    U.modal({ title: 'My account',
      body: h('div', null,
        h('p', { class: 'muted' }, `${u.displayName} · ${A.ROLES[u.role]}${u.teacher ? ' · ' + u.teacher : ''}`),
        h('div', { class: 'form-grid one' }, U.field('Current password', cur), U.field(`New password (min ${A.MIN_PASSWORD} characters)`, n1), U.field('Repeat new password', n2))),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Change password', kind: 'primary', onClick: async () => {
        if (n1.value !== n2.value) throw new Error('The new passwords do not match.');
        await A.changeOwnPassword(cur.value, n1.value);
        toast('Password changed.', 'success');
      } }] });
  };
})();
