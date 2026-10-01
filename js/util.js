(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const U = (ER.util = {});

  const BOOL_PROPS = new Set(['disabled', 'checked', 'selected', 'hidden', 'readOnly', 'required', 'draggable', 'multiple', 'open']);

  function addKids(el, kids) {
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      if (Array.isArray(k)) addKids(el, k);
      else if (k instanceof Node) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
  }

  // Tiny hyperscript helper: h('div', {class:'x', onclick: fn}, child, child...)
  U.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value') value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (BOOL_PROPS.has(k)) el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    addKids(el, kids);
    if (value !== undefined) el.value = value;
    return el;
  };
  U.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // ---------- text normalisation ----------
  U.norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  U.natCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  U.DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const DAY_MAP = {
    mon: 0, monday: 0, m: 0, '1': 0, 'day 1': 0,
    tue: 1, tues: 1, tuesday: 1, tu: 1, '2': 1, 'day 2': 1,
    wed: 2, weds: 2, wednesday: 2, w: 2, '3': 2, 'day 3': 2,
    thu: 3, thur: 3, thurs: 3, thursday: 3, th: 3, '4': 3, 'day 4': 3,
    fri: 4, friday: 4, f: 4, '5': 4, 'day 5': 4,
    sat: 5, saturday: 5, sun: 6, sunday: 6,
  };
  U.normDay = (s) => {
    const t = U.norm(s).replace(/\./g, '');
    if (!t) return null;
    return t in DAY_MAP ? U.DAYS[DAY_MAP[t]] : null;
  };
  // returns 'A' | 'B' | 'AB' | null (null = unrecognised). Blank means every week.
  U.normWeek = (s) => {
    const t = U.norm(s).replace(/^(week|wk)\s*/, '').replace(/\s+/g, '');
    if (['', 'ab', 'a/b', 'a+b', 'a&b', 'both', 'all', 'every', 'weekly', 'ab/ba'].includes(t)) return 'AB';
    if (['a', '1', 'one'].includes(t)) return 'A';
    if (['b', '2', 'two'].includes(t)) return 'B';
    return null;
  };

  // Year groups: "9", "Y9", "yr 9", "Year 9" all become "Year 9"; anything else (Reception, Sixth Form…) is kept as typed.
  U.normYear = (s) => {
    const t = String(s ?? '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    const m = /^(?:year|yr|y)?\s*0*(\d{1,2})$/i.exec(t);
    return m ? 'Year ' + Number(m[1]) : t;
  };
  U.yearShort = (y) => { const m = /^Year (\d+)$/.exec(y || ''); return m ? 'Y' + m[1] : (y || ''); };
  U.yearCmp = (a, b) => {
    const na = /^Year (\d+)$/.exec(a), nb = /^Year (\d+)$/.exec(b);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    if (na) return -1;
    if (nb) return 1;
    return U.natCmp(a, b);
  };
  // "9B/Maths" -> "Year 9" (only for a leading number from 1 to 13)
  U.yearFromName = (name) => {
    const m = /^\s*(\d{1,2})(?=\D|$)/.exec(String(name || ''));
    return m && Number(m[1]) >= 1 && Number(m[1]) <= 13 ? 'Year ' + Number(m[1]) : '';
  };

  // Keeps one spelling for values that differ only by case/spacing ("maths", "Maths ") - the first one seen wins.
  U.canonizer = () => {
    const seen = new Map();
    return (s) => {
      const t = String(s ?? '').trim().replace(/\s+/g, ' ');
      if (!t) return '';
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
      return seen.get(k);
    };
  };
  // "9B/Maths" -> "Maths" (text after the first slash, up to a second slash)
  U.subjectFromName = (name) => {
    const s = String(name || '');
    const i = s.indexOf('/');
    return i < 0 ? '' : s.slice(i + 1).split('/')[0].trim();
  };

  // ---------- encoding helpers ----------
  U.b64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  U.unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  U.hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  U.fmtDateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  U.fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  U.download = (filename, text, mime = 'text/csv;charset=utf-8') => {
    const blob = new Blob(['﻿', text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = U.h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  U.randomPassword = (len = 10) => {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(r, (b) => alphabet[b % alphabet.length]).join('');
  };

  // ---------- toast ----------
  U.toast = (msg, kind = 'info', ms = 4200) => {
    const box = document.getElementById('toasts');
    const t = U.h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, msg);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? ms + 2500 : ms);
  };

  // ---------- modal ----------
  // actions: [{id,label,kind:'primary'|'danger'|'ghost', onClick(api) -> false keeps it open}]
  U.modal = ({ title, body, actions = [], wide = false, dismissible = true, onClose }) => {
    const h = U.h;
    const bodyWrap = h('div', { class: 'modal-body' }, body);
    const footer = h('div', { class: 'modal-foot' });
    const api = { buttons: {}, el: null, closed: false };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) api.close(); };
    api.close = () => {
      if (api.closed) return;
      api.closed = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    api.setBody = (node) => { U.clear(bodyWrap); bodyWrap.appendChild(node); };
    for (const a of actions) {
      const btn = h('button', { class: 'btn ' + (a.kind || 'ghost'), type: 'button' }, a.label);
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        let res;
        try { res = a.onClick ? await a.onClick(api) : undefined; }
        catch (err) { U.toast(err.message || String(err), 'error'); return; }
        if (res !== false) api.close();
      });
      if (a.id) api.buttons[a.id] = btn;
      footer.appendChild(btn);
    }
    const head = h('div', { class: 'modal-head' }, h('h2', null, title),
      dismissible ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => api.close() }, '×') : null);
    const dlg = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, head, bodyWrap, actions.length ? footer : null);
    const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay && dismissible) api.close(); } }, dlg);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    api.el = dlg;
    const first = dlg.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return api;
  };

  U.confirm = (message, { ok = 'Confirm', danger = false, title = 'Please confirm' } = {}) =>
    new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      U.modal({
        title, body: U.h('p', { class: 'confirm-text' }, message),
        onClose: () => finish(false),
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { finish(true); } },
        ],
      });
    });

  U.field = (label, input, hint) =>
    U.h('label', { class: 'field' }, U.h('span', { class: 'field-label' }, label), input, hint ? U.h('span', { class: 'field-hint' }, hint) : null);

  U.debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
})();
