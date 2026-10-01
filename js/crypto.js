(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const C = (ER.crypto = {});
  const te = new TextEncoder();
  const td = new TextDecoder();
  const subtle = crypto.subtle;

  C.ITER = 310000;          // PBKDF2 rounds for passwords
  C.RECOVERY_ITER = 120000; // recovery key already has 160 bits of entropy

  C.rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  C.equal = (a, b) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  };

  // Password/secret -> { auth: verifier bytes, kek: AES key that wraps the data key }.
  // PBKDF2 yields one 256-bit master; HKDF splits it so verifying a guess costs the
  // same as unwrapping the key.
  C.stretch = async (secret, salt, iter) => {
    const base = await subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits']);
    const master = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256);
    const hk = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
    const sub = async (info) => new Uint8Array(await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, hk, 256));
    const auth = await sub('auth');
    const kek = await subtle.importKey('raw', await sub('kek'), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { auth, kek };
  };

  C.newDataKey = () => subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  C.exportKey = async (k) => new Uint8Array(await subtle.exportKey('raw', k));
  C.importDataKey = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

  // File format: [0x01][12-byte IV][AES-GCM ciphertext+tag]
  C.seal = async (key, bytes) => {
    const iv = C.rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const out = new Uint8Array(13 + ct.length);
    out[0] = 1;
    out.set(iv, 1);
    out.set(ct, 13);
    return out;
  };
  C.open = async (key, data) => {
    if (!data || data.length < 30 || data[0] !== 1) throw new Error('Unreadable data file');
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(1, 13) }, key, data.subarray(13)));
  };
  C.sealJSON = (key, obj) => C.seal(key, te.encode(JSON.stringify(obj)));
  C.openJSON = async (key, data) => JSON.parse(td.decode(await C.open(key, data)));

  // Keyed hash used for opaque data file names (so file names reveal nothing).
  C.nameKey = async (raw) => {
    const hk = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('names') }, hk, 256);
    return subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  };
  const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  C.nameHash = async (key, str) => hex(await subtle.sign('HMAC', key, te.encode(str))).slice(0, 40);
  C.sha256hex = async (str) => hex(await subtle.digest('SHA-256', te.encode(str)));

  // Recovery key: 32 chars from an unambiguous base-32 alphabet = 160 bits.
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  C.newRecoveryKey = () => {
    const r = C.rand(32);
    const raw = Array.from(r, (b) => ALPHA[b & 31]).join('');
    return raw.match(/.{4}/g).join('-');
  };
  C.normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
})();
