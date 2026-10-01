// Theme: 'auto' (follow the device), 'light' or 'dark'. Loaded in <head> so there is no flash of the wrong theme.
// Only this preference is kept in the browser (localStorage); no school data ever is.
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const KEY = 'eduresourcer.theme';
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const ORDER = ['auto', 'light', 'dark'];
  const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const ICON = { auto: '◐', light: '☀', dark: '☾' };
  let printing = false;
  const buttons = new Set();

  const get = () => {
    try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : 'auto'; } catch (e) { return 'auto'; }
  };
  const effective = (p) => (p === 'auto' ? (mq.matches ? 'dark' : 'light') : p);

  function apply() {
    // paper is always light, whatever the screen theme is
    document.documentElement.dataset.theme = printing ? 'light' : effective(get());
    const p = get();
    for (const b of buttons) {
      b.textContent = ICON[p];
      b.title = `Theme: ${LABEL[p]} (click to change)`;
      b.setAttribute('aria-label', `Theme: ${LABEL[p]}. Click to change.`);
    }
  }

  const T = (ER.theme = {});
  T.get = get;
  T.set = (p) => { try { localStorage.setItem(KEY, p); } catch (e) { /* private mode etc. */ } apply(); };
  T.cycle = () => T.set(ORDER[(ORDER.indexOf(get()) + 1) % ORDER.length]);
  // a small button that cycles Auto -> Light -> Dark
  T.button = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-btn';
    b.addEventListener('click', T.cycle);
    buttons.add(b);
    apply();
    return b;
  };

  if (mq.addEventListener) mq.addEventListener('change', apply);
  window.addEventListener('beforeprint', () => { printing = true; apply(); });
  window.addEventListener('afterprint', () => { printing = false; apply(); });
  // drop references to buttons that have been removed from the page
  setInterval(() => { for (const b of buttons) if (!b.isConnected) buttons.delete(b); }, 30000);
  apply();
})();
