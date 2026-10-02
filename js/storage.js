(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const S = (ER.store = {});

  S.DIRS = ['Class_Data', 'Resource_Data', 'Allocation_Data', 'Rule_Data', 'Run_Data', 'Shared_Data', 'Preference_Data', 'Login_Data'];
  S.supported = typeof window.showDirectoryPicker === 'function';
  S.demoSupported = !!(navigator.storage && navigator.storage.getDirectory);

  let root = null;
  let mode = null; // 'fs' (chosen folder) | 'demo' (browser-private storage)
  let pending = null;

  // ---- remember the chosen folder handle in IndexedDB (never the data itself) ----
  const idb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('EduResourcerHandles', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const idbGet = async (k) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(k);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  };
  const idbSet = async (k, v) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      if (v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  };

  S.mode = () => mode;
  S.folderName = () => (mode === 'demo' ? 'Demo (this browser only)' : root ? root.name : '');
  S.pendingName = () => (pending ? pending.name : '');

  // -> 'none' | 'ready' | 'needs-permission'
  S.restore = async () => {
    let rec;
    try { rec = await idbGet('root'); } catch (e) { return 'none'; }
    if (!rec) return 'none';
    if (rec.demo) {
      root = await navigator.storage.getDirectory();
      mode = 'demo';
      return 'ready';
    }
    pending = rec.handle;
    try {
      if ((await pending.queryPermission({ mode: 'readwrite' })) === 'granted') {
        root = pending; mode = 'fs'; pending = null;
        return 'ready';
      }
    } catch (e) { /* fall through */ }
    return 'needs-permission';
  };

  // must be called from a click handler
  S.reconnect = async () => {
    if (!pending) return false;
    if ((await pending.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    root = pending; mode = 'fs'; pending = null;
    return true;
  };

  S.choose = async () => {
    const handle = await window.showDirectoryPicker({ id: 'eduresourcer', mode: 'readwrite' });
    root = handle; mode = 'fs'; pending = null;
    await idbSet('root', { handle });
  };

  S.useDemo = async () => {
    root = await navigator.storage.getDirectory();
    mode = 'demo'; pending = null;
    await idbSet('root', { demo: true });
  };

  S.forget = async () => {
    root = null; mode = null; pending = null;
    try { await idbSet('root', undefined); } catch (e) { /* ignore */ }
  };

  S.resetDemo = async () => {
    const r = await navigator.storage.getDirectory();
    for (const d of S.DIRS) { try { await r.removeEntry(d, { recursive: true }); } catch (e) { /* ignore */ } }
  };

  // ---- file operations ----
  const dirHandle = async (name, create = false) => {
    try { return await root.getDirectoryHandle(name, { create }); }
    catch (e) { if (e.name === 'NotFoundError' && !create) return null; throw e; }
  };
  S.ensureDirs = async () => { for (const d of S.DIRS) await dirHandle(d, true); };

  S.read = async (dir, name) => {
    const d = await dirHandle(dir);
    if (!d) return null;
    try {
      const fh = await d.getFileHandle(name);
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
  };

  // returns a "stamp" (lastModified:size) so callers can tell later whether the file changed
  S.write = async (dir, name, bytes) => {
    const d = await dirHandle(dir, true);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
    const f = await fh.getFile();
    return f.lastModified + ':' + f.size;
  };

  S.remove = async (dir, name) => {
    const d = await dirHandle(dir);
    if (!d) return;
    try { await d.removeEntry(name); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
  };

  S.list = async (dir) => {
    const d = await dirHandle(dir);
    if (!d) return [];
    const jobs = [];
    for await (const [name, h] of d.entries()) {
      if (h.kind !== 'file') continue;
      jobs.push(h.getFile().then((f) => ({ name, stamp: f.lastModified + ':' + f.size })).catch(() => null));
    }
    return (await Promise.all(jobs)).filter(Boolean);
  };

  const te = new TextEncoder(), td = new TextDecoder();
  S.readText = async (dir, name) => { const b = await S.read(dir, name); return b ? td.decode(b) : null; };
  S.writeText = (dir, name, text) => S.write(dir, name, te.encode(text));
})();
