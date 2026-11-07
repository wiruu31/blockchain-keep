/* Blockchain Keep v1.0.0 — drive.js
 * Sinkron ke Google Drive lewat folder tersembunyi khusus aplikasi (appDataFolder).
 * Scope hanya "drive.appdata": aplikasi TIDAK bisa melihat file Drive lain milikmu.
 * Yang diunggah hanya container terenkripsi.
 */
(function (root) {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE = 'blockchain-keep.vault.json';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UP = 'https://www.googleapis.com/upload/drive/v3/files';

  let token = null, expires = 0, gsi = null;

  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
  };

  const clientId = () => (LS.get('bk.clientId') || '').trim();
  const setClientId = (v) => LS.set('bk.clientId', String(v || '').trim());
  const connected = () => LS.get('bk.drive') === '1' && !!clientId();
  const hasToken = () => !!token && Date.now() < expires - 60000;

  function loginError(msg) { const e = new Error(msg || 'Perlu login Google'); e.code = 'LOGIN'; return e; }

  function loadGsi() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    if (!gsi) {
      gsi = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = res;
        s.onerror = () => { gsi = null; rej(new Error('Tidak bisa memuat layanan Google (offline?)')); };
        document.head.appendChild(s);
      });
    }
    return gsi;
  }

  async function getToken(interactive) {
    if (hasToken()) return token;
    const cid = clientId();
    if (!cid) throw new Error('Client ID Google belum diisi');
    await loadGsi();
    return new Promise((resolve, reject) => {
      const tc = root.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: SCOPE,
        callback: (r) => {
          if (r.error) return reject(r.error === 'access_denied' ? new Error('Akses Google ditolak') : new Error(r.error_description || r.error));
          token = r.access_token;
          expires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          LS.set('bk.drive', '1');
          resolve(token);
        },
        error_callback: (e) => {
          if (!interactive || e.type === 'popup_failed_to_open') return reject(loginError());
          reject(new Error(e.type === 'popup_closed' ? 'Login Google dibatalkan' : (e.message || e.type || 'Gagal login Google')));
        },
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }

  async function call(url, opts, interactive) {
    const t = await getToken(interactive);
    const r = await fetch(url, { ...(opts || {}), headers: { ...((opts && opts.headers) || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) { token = null; throw loginError('Sesi Google berakhir'); }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error('Drive ' + r.status + (body ? ': ' + body.slice(0, 140) : ''));
    }
    return r;
  }

  async function find(interactive) {
    const q = encodeURIComponent("name='" + FILE + "' and trashed=false");
    const r = await call(API + '?spaces=appDataFolder&q=' + q + '&orderBy=createdTime&fields=files(id,name,modifiedTime)', {}, interactive);
    const j = await r.json();
    return (j.files && j.files[0]) || null;
  }

  async function download(id) {
    const r = await call(API + '/' + encodeURIComponent(id) + '?alt=media', {});
    return r.text();
  }

  async function upload(text, id) {
    if (id) {
      const r = await call(UP + '/' + encodeURIComponent(id) + '?uploadType=media&fields=id,modifiedTime', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
      });
      return r.json();
    }
    const b = 'bk' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
      '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + b + '--';
    const r = await call(UP + '?uploadType=multipart&fields=id,modifiedTime', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body,
    });
    return r.json();
  }

  function disconnect() {
    try {
      if (token && root.google && root.google.accounts && root.google.accounts.oauth2) root.google.accounts.oauth2.revoke(token, () => {});
    } catch (e) { /* abaikan */ }
    token = null; expires = 0;
    LS.set('bk.drive', '0');
  }

  root.Drive = { preload: () => loadGsi().catch(() => {}), clientId, setClientId, connected, hasToken, getToken, find, download, upload, disconnect };
})(typeof self !== 'undefined' ? self : globalThis);
