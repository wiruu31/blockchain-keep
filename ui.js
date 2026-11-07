/* Blockchain Keep v1.0.0 — ui.js
 * Helper tampilan: pembuat elemen, ikon, toast, dialog, format, salin ke clipboard.
 * Semua teks pengguna dimasukkan lewat textContent (bukan innerHTML) agar aman dari injeksi.
 */
(function (root) {
  'use strict';

  /* ---------- elemen ---------- */
  function h(tag, props) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || (v === false && k !== 'spellcheck')) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;           // hanya untuk SVG statis internal
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'spellcheck') el.setAttribute('spellcheck', v ? 'true' : 'false');
      else if (k in el && !k.includes('-')) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      for (const kid of [].concat(arguments[i])) {
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
    }
    return el;
  }
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------- ikon (SVG statis) ---------- */
  const P = {
    hex: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
    file: '<path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8-8"/>',
    chain: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14M14 17.5h-4a3 3 0 0 1-3-3V10"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 4.2M6.6 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V4M7 8l5-5 5 5M5 20h14"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  };
  function icon(name, cls) {
    return h('span', { class: 'ic ' + (cls || ''), 'aria-hidden': 'true',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>' });
  }
  /** Logo heksagon bergradasi, dengan ikon di tengahnya (opsional) */
  function hexMark(size, inner) {
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    return h('span', { class: 'hexmark', style: { width: size + 'px', height: size + 'px' },
      html: '<svg viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#38BDF8"/></linearGradient></defs>' +
        '<path d="M12 1.5l9.5 5.5v10L12 22.5 2.5 17V7z" fill="rgba(124,92,255,.14)" stroke="url(#' + id + ')" stroke-width="1.4" stroke-linejoin="round"/></svg>' },
      inner ? h('span', { class: 'hexmark-in' }, inner) : null);
  }

  /* ---------- format ---------- */
  const shortHash = (x) => (x ? '0x' + x.slice(0, 4) + '…' + x.slice(-4) : '0x—');
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1).replace('.0', '') + ' KB';
    return (n / 1048576).toFixed(2).replace(/\.?0+$/, '') + ' MB';
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    if (s < 172800) return 'kemarin';
    return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- toast ---------- */
  function toast(msg, kind) {
    const box = $('#toasts');
    const t = h('div', { class: 'toast ' + (kind || '') }, msg);
    box.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5000 : 2400);
  }

  /* ---------- sheet & dialog ---------- */
  function sheet(content, opt) {
    opt = opt || {};
    const layer = $('#layer');
    const back = h('div', { class: 'scrim' });
    const box = h('div', { class: 'sheet' + (opt.center ? ' center' : ''), role: 'dialog', 'aria-modal': 'true' }, content);
    const wrap = h('div', { class: 'sheet-wrap' }, back, box);
    layer.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    let closed = false;
    const api = {
      el: box,
      close(v) {
        if (closed) return; closed = true;
        wrap.classList.remove('in');
        setTimeout(() => wrap.remove(), 220);
        if (opt.onClose) opt.onClose(v);
      },
    };
    if (!opt.locked) back.addEventListener('click', () => api.close());
    return api;
  }

  function confirmDialog(o) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const s = sheet(h('div', { class: 'dlg' },
        h('h3', null, o.title || 'Yakin?'),
        o.text ? h('p', { class: 'mut' }, o.text) : null,
        o.body || null,
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { fin(false); s.close(); } }, o.cancelText || 'Batal'),
          h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), type: 'button', onclick: () => { fin(true); s.close(); } }, o.okText || 'Ya'))),
        { center: true, onClose: () => fin(false) });
    });
  }

  /* ---------- clipboard ---------- */
  let clipTimer = null;
  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast((label || 'Teks') + ' disalin · dihapus dari clipboard dalam 30 dtk');
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => { try { navigator.clipboard.writeText(''); } catch (e) { /* abaikan */ } }, 30000);
    } catch (e) {
      toast('Tidak bisa menyalin. Tekan lama teksnya untuk menyalin manual.', 'err');
    }
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  root.UI = { h, $, icon, hexMark, shortHash, fmtSize, fmtTime, ago, toast, sheet, confirmDialog, copy, download };
})(typeof self !== 'undefined' ? self : globalThis);
