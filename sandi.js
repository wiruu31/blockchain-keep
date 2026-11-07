/* Blockchain Keep v1.0.0 — sandi.js
 * Semua kriptografi memakai Web Crypto bawaan browser (tanpa library).
 *
 *  Password utama ──PBKDF2(600rb)──► kunci pembungkus ─┐
 *  Kode pemulihan ──PBKDF2(100rb)──► kunci pembungkus ─┼─► membuka DEK (kunci data acak 256-bit)
 *                                                      │
 *  DEK ──AES-GCM──► isi brankas (item + rantai hash)  ◄┘
 *
 * Yang disimpan di HP dan Google Drive hanyalah "container" terenkripsi.
 * Password dan DEK tidak pernah disimpan.
 */
(function (root) {
  'use strict';

  const cr = globalThis.crypto;
  const subtle = cr.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const PW_ITER = 600000;
  const REC_ITER = 100000;
  const AAD = enc.encode('blockchain-keep:v1');
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 simbol, tanpa I O 0 1

  /* ---------- util ---------- */
  function toB64(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return btoa(s);
  }
  function fromB64(str) {
    const s = atob(str);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function rand(n) { return cr.getRandomValues(new Uint8Array(n)); }

  function randInt(max) { // acak seragam 0..max-1 tanpa bias
    const lim = Math.floor(0x100000000 / max) * max;
    const a = new Uint32Array(1);
    do { cr.getRandomValues(a); } while (a[0] >= lim);
    return a[0] % max;
  }

  /* ---------- primitif ---------- */
  async function deriveKey(secret, salt, iter) {
    const base = await subtle.importKey('raw', enc.encode(String(secret).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, bytes) {
    const iv = rand(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, bytes);
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function open(key, box) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv), additionalData: AAD }, key, fromB64(box.ct));
    return new Uint8Array(pt);
  }
  function importDek(bytes) {
    return subtle.importKey('raw', bytes, 'AES-GCM', true, ['encrypt', 'decrypt']);
  }
  async function exportDek(key) { return new Uint8Array(await subtle.exportKey('raw', key)); }

  /* ---------- kode pemulihan ---------- */
  function newRecoveryCode() {
    const r = rand(24);
    let s = '';
    for (let i = 0; i < 24; i++) s += ALPHA[r[i] & 31];
    return s.match(/.{4}/g).join('-');
  }
  function normalizeCode(code) { return String(code).toUpperCase().replace(/[\s-]/g, ''); }
  function validCodeShape(code) {
    const c = normalizeCode(code);
    return c.length === 24 && [...c].every((ch) => ALPHA.includes(ch));
  }

  /* ---------- header (pembungkus DEK) ---------- */
  async function wrapPassword(dek, password) {
    const salt = rand(16);
    const k = await deriveKey(password, salt, PW_ITER);
    return { kdf: { iter: PW_ITER, salt: toB64(salt) }, pw: await seal(k, dek) };
  }
  async function wrapRecovery(dek, code) {
    const salt = rand(16);
    const k = await deriveKey(normalizeCode(code), salt, REC_ITER);
    return { rec: { iter: REC_ITER, salt: toB64(salt), ...(await seal(k, dek)) } };
  }

  /* ---------- container ---------- */
  function isContainer(o) {
    const okIter = (n) => Number.isInteger(n) && n >= 1000 && n <= 5000000;
    return !!(o && o.app === 'blockchain-keep' && o.v === 1 &&
      o.kdf && okIter(o.kdf.iter) && typeof o.kdf.salt === 'string' &&
      o.pw && typeof o.pw.ct === 'string' && typeof o.pw.iv === 'string' &&
      o.rec && okIter(o.rec.iter) && typeof o.rec.salt === 'string' && typeof o.rec.ct === 'string' &&
      o.data && typeof o.data.ct === 'string' && typeof o.data.iv === 'string');
  }

  async function encryptData(c, key, plaintext) {
    const data = await seal(key, enc.encode(JSON.stringify(plaintext)));
    return { ...c, data, rev: (c.rev || 0) + 1, updated: Date.now() };
  }
  async function decryptData(c, key) {
    return JSON.parse(dec.decode(await open(key, c.data)));
  }

  async function create(password, plaintext) {
    const dek = rand(32);
    const code = newRecoveryCode();
    const key = await importDek(dek);
    const base = {
      v: 1, app: 'blockchain-keep', hdrAt: Date.now(), rev: 0,
      ...(await wrapPassword(dek, password)),
      ...(await wrapRecovery(dek, code)),
    };
    const container = await encryptData(base, key, plaintext);
    return { container, key, code };
  }

  /** Buka dengan password. Melempar error jika password salah. */
  async function unlock(c, password) {
    const k = await deriveKey(password, fromB64(c.kdf.salt), c.kdf.iter);
    const dek = await open(k, c.pw);
    const key = await importDek(dek);
    return { key, vault: await decryptData(c, key) };
  }
  /** Buka dengan kode pemulihan. */
  async function unlockWithCode(c, code) {
    const k = await deriveKey(normalizeCode(code), fromB64(c.rec.salt), c.rec.iter);
    const dek = await open(k, { iv: c.rec.iv, ct: c.rec.ct });
    const key = await importDek(dek);
    return { key, vault: await decryptData(c, key) };
  }
  /** Cek password tanpa membuka data. */
  async function verifyPassword(c, password) {
    try {
      const k = await deriveKey(password, fromB64(c.kdf.salt), c.kdf.iter);
      await open(k, c.pw);
      return true;
    } catch (e) { return false; }
  }
  /** Ganti password (DEK sama, data tidak dienkripsi ulang). */
  async function setPassword(c, key, newPassword) {
    const dek = await exportDek(key);
    return { ...c, hdrAt: Date.now(), ...(await wrapPassword(dek, newPassword)) };
  }
  /** Buat kode pemulihan baru (kode lama tidak berlaku lagi). */
  async function newRecovery(c, key) {
    const dek = await exportDek(key);
    const code = newRecoveryCode();
    return { container: { ...c, hdrAt: Date.now(), ...(await wrapRecovery(dek, code)) }, code };
  }

  /* ---------- password: kekuatan & generator ---------- */
  function strength(pw) {
    let s = 0;
    if (pw.length >= 10) s++;
    if (pw.length >= 14) s++;
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (classes >= 3) s++;
    if (pw.length >= 18 && classes >= 2) s++;
    return Math.min(s, 4);
  }

  function generatePassword(o) {
    o = Object.assign({ length: 20, lower: true, upper: true, digits: true, symbols: true }, o || {});
    const sets = [];
    if (o.lower) sets.push('abcdefghijkmnopqrstuvwxyz');
    if (o.upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (o.digits) sets.push('23456789');
    if (o.symbols) sets.push('!@#$%^&*-_=+?');
    if (!sets.length) sets.push('abcdefghijkmnopqrstuvwxyz');
    const len = Math.max(sets.length, Math.min(64, o.length | 0));
    const all = sets.join('');
    const out = sets.map((s) => s[randInt(s.length)]);
    while (out.length < len) out.push(all[randInt(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { // Fisher–Yates
      const j = randInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join('');
  }

  const Sandi = {
    PW_ITER, REC_ITER, toB64, fromB64, rand,
    isContainer, create, unlock, unlockWithCode, verifyPassword,
    setPassword, newRecovery, encryptData, decryptData,
    newRecoveryCode, validCodeShape, normalizeCode, strength, generatePassword,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sandi;
  else root.Sandi = Sandi;
})(typeof self !== 'undefined' ? self : globalThis);
