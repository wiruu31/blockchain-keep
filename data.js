/* Blockchain Keep v1.0.0 — data.js
 * Isi brankas (item), rantai hash riwayat, penggabungan saat sinkron, dan penyimpanan IndexedDB.
 *
 * Isi brankas (sebelum dienkripsi):
 *   { items: [ {id,type,title,created,updated,...} ], chain: [ blok, blok, ... ] }
 *
 * Setiap perubahan menambah satu blok:
 *   { n, ts, action, kind, itemId, title, itemHash, prev, hash }
 *   hash = SHA-256(n, ts, action, kind, itemId, title, itemHash, prev)
 * Mengubah blok lama diam-diam akan memutus rantai dan terdeteksi oleh verify().
 */
(function (root) {
  'use strict';

  const subtle = globalThis.crypto.subtle;
  const ZERO = '0'.repeat(64);
  const MAX_FILE = 2 * 1024 * 1024;        // 2 MB per berkas
  const MAX_TOTAL = 25 * 1024 * 1024;      // ±25 MB total berkas

  /* ---------- hash & kanonik ---------- */
  async function sha256(str) {
    const d = await subtle.digest('SHA-256', new TextEncoder().encode(str));
    let s = '';
    for (const b of new Uint8Array(d)) s += b.toString(16).padStart(2, '0');
    return s;
  }
  function canon(v) { // JSON dengan urutan kunci tetap
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  function rid() {
    const b = globalThis.crypto.getRandomValues(new Uint8Array(6));
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const hashItem = (item) => sha256(canon(item));
  const entryHash = (e) => sha256(canon([e.n, e.ts, e.action, e.kind || '', e.itemId || '', e.title || '', e.itemHash || '', e.prev]));

  /* ---------- rantai ---------- */
  async function append(vault, action, item, title) {
    const c = vault.chain;
    const e = {
      n: c.length,
      ts: Date.now(),
      action,
      kind: item ? item.type : '',
      itemId: item ? item.id : '',
      title: title !== undefined ? title : (item ? item.title : ''),
      itemHash: item ? await hashItem(item) : '',
      prev: c.length ? c[c.length - 1].hash : ZERO,
    };
    e.hash = await entryHash(e);
    c.push(e);
    return e;
  }

  async function newVault() {
    const v = { items: [], chain: [] };
    await append(v, 'genesis', null, 'Blok genesis');
    return v;
  }

  function entryMap(vault) { // itemId -> blok terakhir untuk item itu
    const m = new Map();
    for (const e of vault.chain) if (e.itemId) m.set(e.itemId, e);
    return m;
  }

  async function verify(vault, opt) {
    const checkItems = !opt || opt.items !== false;
    const c = vault.chain;
    const fail = (at, reason) => ({ ok: false, at, reason });
    if (!c || !c.length) return fail(0, 'Rantai kosong');
    for (let i = 0; i < c.length; i++) {
      const e = c[i];
      if (e.n !== i) return fail(i, 'Nomor blok tidak berurutan');
      if (e.prev !== (i ? c[i - 1].hash : ZERO)) return fail(i, 'Sambungan ke blok sebelumnya putus');
      if ((await entryHash(e)) !== e.hash) return fail(i, 'Isi blok tidak cocok dengan hash-nya');
    }
    if (checkItems) {
      const last = entryMap(vault);
      for (const it of vault.items) {
        const e = last.get(it.id);
        if (!e) return { ok: false, at: -1, itemId: it.id, reason: 'Ada item yang tidak tercatat di riwayat' };
        if (e.itemHash !== (await hashItem(it))) {
          return { ok: false, at: e.n, itemId: it.id, reason: 'Isi item berbeda dari catatan terakhirnya di riwayat' };
        }
      }
    }
    return { ok: true, count: c.length };
  }

  /* ---------- item ---------- */
  function makeItem(type) {
    const now = Date.now();
    const base = { id: rid(), type, title: '', created: now, updated: now };
    if (type === 'note') return { ...base, body: '' };
    if (type === 'pass') return { ...base, user: '', pass: '', url: '', note: '' };
    return { ...base, name: '', mime: '', size: 0, data: '', note: '' };
  }

  async function saveItem(vault, item) {
    const i = vault.items.findIndex((x) => x.id === item.id);
    item.updated = Date.now();
    if (i >= 0) vault.items[i] = item; else vault.items.push(item);
    return append(vault, i >= 0 ? 'ubah' : 'tambah', item);
  }

  async function removeItem(vault, id) {
    const i = vault.items.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const old = vault.items[i];
    const tomb = { id: old.id, type: old.type, title: '', deleted: true, created: old.created, updated: Date.now() };
    vault.items[i] = tomb;
    return append(vault, 'hapus', tomb, old.title);
  }

  function visibleItems(vault, type) {
    return vault.items.filter((x) => !x.deleted && x.type === type).sort((a, b) => b.updated - a.updated);
  }
  function matches(item, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return [item.title, item.body, item.user, item.url, item.note, item.name]
      .some((s) => s && String(s).toLowerCase().includes(q));
  }
  function filesBytes(vault) {
    return vault.items.reduce((n, x) => n + (!x.deleted && x.type === 'file' ? (x.size || 0) : 0), 0);
  }
  const head = (vault) => vault.chain[vault.chain.length - 1].hash;

  /* ---------- penggabungan (sinkron) ---------- */
  async function relink(e, chain) {
    const n = {
      n: chain.length, ts: e.ts, action: e.action, kind: e.kind, itemId: e.itemId,
      title: e.title, itemHash: e.itemHash,
      prev: chain.length ? chain[chain.length - 1].hash : ZERO,
    };
    n.hash = await entryHash(n);
    return n;
  }

  /** Gabungkan brankas lokal (a) dan jarak jauh (b). Item: yang terbaru menang. */
  async function merge(a, b) {
    const ca = a.chain, cb = b.chain;
    let i = 0;
    while (i < ca.length && i < cb.length && ca[i].hash === cb[i].hash) i++;

    let chain;
    if (i === ca.length && i === cb.length) chain = clone(ca);
    else if (i === ca.length) chain = clone(cb);          // jarak jauh lebih maju
    else if (i === cb.length) chain = clone(ca);          // lokal lebih maju
    else {
      // Bercabang: ambil ekor kedua sisi, buang blok kembar (identitas = isi logisnya, bukan hash
      // karena hash berubah saat disambung ulang), urutkan secara deterministik, lalu sambung ulang.
      // Dengan begitu dua perangkat yang menggabungkan himpunan blok yang sama menghasilkan rantai
      // yang sama persis, dan sinkron berulang tidak menggandakan riwayat.
      const key = (e) => canon([e.ts, e.action, e.kind || '', e.itemId || '', e.title || '', e.itemHash || '']);
      const seen = new Set(ca.slice(0, i).map(key));
      const tail = [];
      for (const e of ca.slice(i).concat(cb.slice(i))) {
        const k = key(e);
        if (seen.has(k)) continue;
        seen.add(k);
        tail.push({ e, k });
      }
      tail.sort((x, y) => (x.e.ts - y.e.ts) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
      chain = clone(ca.slice(0, i));
      for (const t of tail) chain.push(await relink(t.e, chain));
    }

    const map = new Map();
    for (const it of a.items) map.set(it.id, it);
    for (const it of b.items) {
      const cur = map.get(it.id);
      if (!cur || it.updated > cur.updated || (it.updated === cur.updated && it.deleted && !cur.deleted)) map.set(it.id, it);
      else if (it.updated === cur.updated && it.deleted === cur.deleted) map.set(it.id, it);
    }
    const out = { items: clone([...map.values()]), chain };

    // pastikan setiap item punya blok terakhir yang cocok
    const last = entryMap(out);
    for (const it of out.items) {
      const e = last.get(it.id);
      if (!e || e.itemHash !== (await hashItem(it))) await append(out, 'sinkron', it, e ? e.title : it.title);
    }
    return out;
  }

  /* ---------- penyimpanan lokal (IndexedDB) ---------- */
  const Store = (function () {
    const DB = 'blockchain-keep', ST = 'kv';
    let dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          const r = indexedDB.open(DB, 1);
          r.onupgradeneeded = () => r.result.createObjectStore(ST);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    }
    async function tx(mode, fn) {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(ST, mode);
        const req = fn(t.objectStore(ST));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('Transaksi dibatalkan'));
      });
    }
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
      del: (k) => tx('readwrite', (s) => s.delete(k)),
      clear: () => tx('readwrite', (s) => s.clear()),
    };
  })();

  const Data = {
    ZERO, MAX_FILE, MAX_TOTAL,
    sha256, canon, hashItem, newVault, makeItem, saveItem, removeItem,
    visibleItems, matches, entryMap, verify, merge, filesBytes, head, Store,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Data;
  else root.Data = Data;
})(typeof self !== 'undefined' ? self : globalThis);
