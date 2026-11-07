/* Blockchain Keep v1.0.0 — app.js
 * Alur aplikasi: setup, kunci/buka, daftar & editor item, riwayat, pengaturan, sinkron Drive.
 */
(function () {
  'use strict';

  const { h, $, icon, hexMark, shortHash, fmtSize, fmtTime, ago, toast, sheet, confirmDialog, copy, download } = UI;
  const { Store } = Data;
  const VERSION = '1.0.0';
  const root = $('#app');

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
  };

  const S = {
    container: null, vault: null, key: null,
    tab: 'note', q: '', integrity: null, histLimit: 40,
    sync: { state: 'off', msg: '' }, dirty: false, rev: 0, lastSync: 0,
    lastActive: Date.now(), hiddenAt: 0, fails: 0, lockedUntil: 0, listEl: null, corrupt: false,
  };

  const TABS = {
    note: { label: 'Catatan', ic: 'note', one: 'catatan' },
    pass: { label: 'Sandi', ic: 'key', one: 'sandi akun' },
    file: { label: 'Berkas', ic: 'file', one: 'berkas' },
    history: { label: 'Riwayat', ic: 'chain' },
  };
  const KIND = { note: 'catatan', pass: 'sandi', file: 'berkas' };
  const ACTION = { genesis: 'Genesis', tambah: 'Tambah', ubah: 'Ubah', hapus: 'Hapus', sinkron: 'Sinkron', impor: 'Impor' };

  /* ---------- antrean mutasi (cegah tabrakan simpan vs sinkron) ---------- */
  let chainP = Promise.resolve();
  function lock(fn) { const p = chainP.then(() => fn()); chainP = p.catch(() => {}); return p; }

  async function saveMeta() { await Store.set('meta', { dirty: S.dirty, lastSync: S.lastSync }); }

  /** Ubah brankas: jalankan fn, enkripsi ulang, simpan lokal, jadwalkan sinkron. */
  function commit(fn) {
    return lock(async () => {
      if (!S.key || !S.vault) throw new Error('Brankas terkunci');
      await fn(S.vault);
      S.rev++;
      S.container = await Sandi.encryptData(S.container, S.key, S.vault);
      S.dirty = true;
      await Store.set('vault', S.container);
      await saveMeta();
      S.integrity = await Data.verify(S.vault, { items: false });
      refreshChrome();
      scheduleSync();
    });
  }

  /* ---------- tampilan dasar ---------- */
  function mount(el) { root.replaceChildren(el); window.scrollTo(0, 0); }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function heroEl(busy) {
    return h('div', { class: 'hero' + (busy ? ' busy' : '') }, hexMark(112, icon('lock')), h('div', { class: 'ring' }));
  }

  /* ---------- selamat datang ---------- */
  function welcome() {
    mount(h('div', { class: 'center-screen' },
      heroEl(),
      h('h1', { class: 'title' }, 'Blockchain Keep'),
      h('p', { class: 'tag' }, 'Brankas pribadi terenkripsi untuk catatan, sandi akun, dan berkas kecil.'),
      S.corrupt ? h('div', { class: 'note-box warn', style: { marginBottom: '16px' } }, 'Data brankas di HP ini tidak terbaca. Kamu bisa mengambilnya dari Google Drive atau mengimpor file cadangan.') : null,
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', type: 'button', onclick: setupFlow }, 'Buat brankas baru'),
        h('button', { class: 'btn block', type: 'button', onclick: restoreFromDrive }, icon('cloud'), 'Ambil dari Google Drive'),
        h('button', { class: 'btn ghost block', type: 'button', onclick: importAtWelcome }, icon('upload'), 'Impor file cadangan')),
      h('div', { class: 'fine' }, 'v' + VERSION + ' · AES-256-GCM · data terenkripsi di perangkatmu')));
  }

  /** Kode pemulihan ditampilkan dua baris (3 kelompok per baris) agar mudah disalin ke kertas. */
  function codeBox(code) {
    const g = code.split('-');
    return h('div', { class: 'codebox', 'aria-label': 'Kode pemulihan: ' + g.join(' ') },
      h('div', null, g.slice(0, 3).join('-')), h('div', null, g.slice(3).join('-')));
  }

  /* ---------- setup ---------- */
  function stepsEl(n) { return h('div', { class: 'steps' }, [1, 2].map((i) => h('b', { class: i <= n ? 'on' : '' }))); }

  function setupFlow() {
    const p1 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Password utama (min. 10 karakter)' });
    const p2 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Ulangi password' });
    const bar = h('div', { class: 'strength' }, h('i'), h('i'), h('i'), h('i'));
    const bt = h('div', { class: 'strength-t' }, ' ');
    const err = h('div', { class: 'err-t' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Lanjut');
    p1.addEventListener('input', () => {
      const s = p1.value ? Math.max(1, Sandi.strength(p1.value)) : 0;
      bar.className = 'strength' + (s ? ' s' + s : '');
      bt.textContent = p1.value ? 'kekuatan: ' + ['', 'lemah', 'cukup', 'kuat', 'sangat kuat'][s] : ' ';
    });
    const form = h('form', {
      class: 'panel setup',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (p1.value.length < 10) { err.textContent = 'Minimal 10 karakter.'; return; }
        if (p1.value !== p2.value) { err.textContent = 'Kedua password tidak sama.'; return; }
        go.disabled = true; go.textContent = 'Menghitung kunci…';
        try {
          const vault = await Data.newVault();
          const r = await Sandi.create(p1.value, vault);
          p1.value = p2.value = '';
          setupCode({ vault, ...r });
        } catch (ex) { go.disabled = false; go.textContent = 'Lanjut'; err.textContent = 'Gagal: ' + ex.message; }
      },
    },
      h('h2', null, 'Buat password utama'),
      h('p', { class: 'lead' }, 'Password ini mengunci seluruh isi brankas. Tidak ada yang bisa meresetnya, termasuk aku.'),
      h('div', { class: 'field' }, p1, bar, bt),
      h('div', { class: 'field' }, p2, err),
      h('div', { class: 'note-box warn', style: { marginBottom: '14px' } }, 'Pakai kalimat yang panjang dan mudah kamu ingat. Contoh: tiga kata acak + angka.'),
      go,
      h('button', { class: 'link', type: 'button', onclick: boot }, 'Kembali'));
    mount(h('div', { class: 'center-screen' }, stepsEl(1), form));
    setTimeout(() => p1.focus(), 60);
  }

  function setupCode(r) {
    const chk = h('input', { type: 'checkbox' });
    const done = h('button', { class: 'btn primary block', type: 'button', disabled: true }, 'Buat brankas');
    chk.addEventListener('change', () => { done.disabled = !chk.checked; });
    done.addEventListener('click', async () => {
      done.disabled = true; done.textContent = 'Menyimpan…';
      try {
        S.container = r.container;
        await Store.set('vault', r.container);
        S.dirty = false; S.lastSync = 0; await saveMeta();
        await enter(r.key, r.vault);
        toast('Brankas dibuat ✓ Hubungkan Google Drive di menu Atur agar bisa dibuka dari mana saja.');
      } catch (ex) { toast('Gagal menyimpan: ' + ex.message, 'err'); done.disabled = false; done.textContent = 'Buat brankas'; }
    });
    mount(h('div', { class: 'center-screen' }, stepsEl(2),
      h('div', { class: 'panel setup' },
        h('h2', null, 'Kode pemulihan'),
        h('p', { class: 'lead' }, 'Ini satu-satunya cara masuk kalau kamu lupa password. Tulis di kertas dan simpan di tempat aman, di luar HP. Kode ini tidak akan ditampilkan lagi.'),
        codeBox(r.code),
        h('div', { class: 'row', style: { margin: '12px 0 0' } }, h('button', { class: 'btn small', type: 'button', onclick: () => copy(r.code, 'Kode pemulihan') }, icon('copy'), 'Salin')),
        h('label', { class: 'check' }, chk, h('span', null, 'Aku sudah mencatat kode ini di tempat aman.')),
        done)));
  }

  /* ---------- layar kunci ---------- */
  function lockScreen() {
    const pw = h('input', { class: 'inp', type: 'password', placeholder: 'Password utama', autocomplete: 'off', 'aria-label': 'Password utama' });
    const err = h('div', { class: 'err-t' }, ' ');
    const hero = heroEl();
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Buka brankas');
    const form = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (Date.now() < S.lockedUntil) { err.textContent = 'Tunggu ' + Math.ceil((S.lockedUntil - Date.now()) / 1000) + ' detik…'; return; }
        if (!pw.value) return;
        hero.classList.add('busy'); btn.disabled = true; err.textContent = 'Menghitung kunci…';
        try {
          const r = await Sandi.unlock(S.container, pw.value);
          S.fails = 0; pw.value = '';
          await enter(r.key, r.vault);
        } catch (ex) {
          hero.classList.remove('busy'); btn.disabled = false;
          S.fails++;
          if (S.fails >= 5) { S.lockedUntil = Date.now() + 30000; S.fails = 0; err.textContent = 'Terlalu banyak percobaan. Tunggu 30 detik.'; }
          else err.textContent = ex && ex.name === 'OperationError' ? 'Password salah.' : 'Gagal membuka: ' + (ex && ex.message);
          form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
          pw.select();
        }
      },
    }, pw, err, btn);
    mount(h('div', { class: 'center-screen' },
      hero,
      h('h1', { class: 'title' }, 'Blockchain Keep'),
      h('p', { class: 'tag' }, 'Brankasmu terkunci'),
      form,
      h('button', { class: 'link', type: 'button', style: { marginTop: '10px' }, onclick: recoverySheet }, 'Lupa password? Pakai kode pemulihan'),
      h('div', { class: 'fine' }, 'v' + VERSION)));
    setTimeout(() => pw.focus(), 80);
  }

  function recoverySheet() {
    const code = h('input', { class: 'inp mono', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', spellcheck: false, autocomplete: 'off' });
    const err = h('div', { class: 'err-t' });
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Pulihkan');
    const s = sheet(h('form', {
      class: 'dlg',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!Sandi.validCodeShape(code.value)) { err.textContent = 'Format kode tidak sesuai (24 karakter).'; return; }
        go.disabled = true; err.textContent = 'Menghitung kunci…';
        try {
          const r = await Sandi.unlockWithCode(S.container, code.value);
          s.close();
          await forceNewPassword(r.key, r.vault);
        } catch (ex) { go.disabled = false; err.textContent = 'Kode pemulihan salah.'; }
      },
    },
      h('h3', null, 'Pulihkan dengan kode'),
      h('p', { class: 'mut' }, 'Masukkan 24 karakter kode pemulihan yang kamu catat saat membuat brankas.'),
      h('div', { class: 'field' }, code, err),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => s.close() }, 'Batal'), go)));
    setTimeout(() => code.focus(), 250);
  }

  function forceNewPassword(key, vault) {
    return new Promise((resolve) => {
      const n1 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Password baru (min. 10 karakter)' });
      const n2 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Ulangi password baru' });
      const err = h('div', { class: 'err-t' });
      const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Simpan & buka');
      const s = sheet(h('form', {
        class: 'dlg',
        onsubmit: async (e) => {
          e.preventDefault();
          if (n1.value.length < 10) { err.textContent = 'Minimal 10 karakter.'; return; }
          if (n1.value !== n2.value) { err.textContent = 'Kedua password tidak sama.'; return; }
          go.disabled = true; err.textContent = 'Menghitung kunci…';
          try {
            const c = await Sandi.setPassword(S.container, key, n1.value);
            S.container = c; S.dirty = true;
            await Store.set('vault', c); await saveMeta();
            s.close(); resolve();
            await enter(key, vault);
            toast('Password baru dipasang ✓');
          } catch (ex) { go.disabled = false; err.textContent = 'Gagal: ' + ex.message; }
        },
      },
        h('h3', null, 'Buat password baru'),
        h('p', { class: 'mut' }, 'Kode pemulihan benar. Pasang password utama yang baru.'),
        h('div', { class: 'field' }, n1), h('div', { class: 'field' }, n2, err), go), { locked: true });
      setTimeout(() => n1.focus(), 250);
    });
  }

  /* ---------- masuk ke aplikasi ---------- */
  async function enter(key, vault) {
    S.key = key; S.vault = vault; S.q = ''; S.tab = 'note'; S.lastActive = Date.now();
    S.integrity = null; S.histLimit = 40;
    S.sync = { state: Drive.connected() ? 'pending' : 'off', msg: '' };
    renderMain();
    Data.verify(vault).then((r) => {
      if (S.vault !== vault) return;
      S.integrity = r; refreshChrome(); if (S.tab === 'history') refreshList();
      if (!r.ok) toast('Peringatan: integritas rantai bermasalah. Buka tab Riwayat.', 'err');
    });
    if (Drive.connected()) { Drive.preload(); if (navigator.onLine) syncNow(false); else setSync('offline'); }
  }

  function lockNow(msg) {
    if (!S.key) return;
    closeAllPages();
    document.querySelectorAll('.sheet-wrap').forEach((x) => x.remove());
    S.key = null; S.vault = null; S.integrity = null; S.q = ''; S.listEl = null;
    clearTimeout(syncTimer);
    lockScreen();
    if (msg) toast(msg);
  }

  /* ---------- kerangka utama ---------- */
  function renderMain() {
    const mkTab = (t) => h('button', { class: 'dock-btn' + (S.tab === t ? ' on' : ''), type: 'button', 'data-tab': t, onclick: () => setTab(t) },
      icon(TABS[t].ic), h('span', null, TABS[t].label));
    const shell = h('div', { class: 'shell' },
      h('div', { class: 'topbar' },
        h('div', { class: 'brand' }, hexMark(34, icon('lock', 'sm')), h('div', null, 'Keep', h('small', null, 'blockchain vault'))),
        h('button', { class: 'ibtn', type: 'button', id: 'btn-gear', 'aria-label': 'Atur', onclick: () => setTab('settings') }, icon('gear')),
        h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Kunci sekarang', onclick: () => lockNow() }, icon('lock'))),
      h('button', { class: 'node', type: 'button', id: 'node', onclick: onNodeTap }),
      h('div', { class: 'content', id: 'content' }),
      h('nav', { class: 'dock', 'aria-label': 'Navigasi' },
        mkTab('note'), mkTab('pass'),
        h('div', { class: 'dock-plus-wrap' }, h('button', { class: 'dock-plus', type: 'button', 'aria-label': 'Tambah', onclick: onPlus }, icon('plus'))),
        mkTab('file'), mkTab('history')));
    mount(shell);
    refreshChrome();
    renderTab();
  }

  function nodeParts() {
    const chain = !S.integrity ? ['warn', 'memeriksa rantai…'] : S.integrity.ok ? ['ok', 'rantai aman'] : ['bad', 'RANTAI RUSAK'];
    const st = S.sync.state;
    const syDot = { ok: 'ok', syncing: 'spin', pending: 'warn', offline: 'warn', login: 'warn', error: 'bad', off: '' }[st];
    return [
      h('span', { class: 'dot ' + chain[0] }), h('b', null, chain[1]),
      h('span', { class: 'sep' }, '·'), h('span', null, 'blok #' + (S.vault.chain.length - 1)),
      h('span', { class: 'sep' }, '·'), h('span', { class: 'dot ' + syDot }), h('span', null, syncLabel()),
    ];
  }
  function syncLabel() {
    return { off: 'lokal saja', pending: 'menunggu kirim', syncing: 'menyinkronkan…', ok: 'tersinkron', offline: 'offline', login: 'ketuk untuk masuk Google', error: 'gagal sinkron' }[S.sync.state] || '';
  }
  function refreshChrome() {
    if (!S.vault) return;
    const n = $('#node'); if (n) n.replaceChildren(...nodeParts());
    document.querySelectorAll('.dock-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const g = $('#btn-gear'); if (g) g.classList.toggle('on', S.tab === 'settings');
    updateSettingsSync();
  }
  function onNodeTap() {
    if (['login', 'error', 'pending', 'offline'].includes(S.sync.state) && Drive.connected()) syncNow(true);
    else setTab('history');
  }
  function setTab(t) {
    S.tab = t; S.q = '';
    refreshChrome(); renderTab(); window.scrollTo(0, 0);
  }
  function onPlus() {
    if (['note', 'pass', 'file'].includes(S.tab)) return openEditor(S.tab, null);
    const s = sheet(h('div', { class: 'dlg' }, h('h3', null, 'Tambah ke brankas'),
      h('div', { class: 'choose', style: { marginTop: '12px' } },
        ['note', 'pass', 'file'].map((t) => h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); openEditor(t, null); } }, icon(TABS[t].ic), TABS[t].label)))));
  }

  /* ---------- daftar ---------- */
  function renderTab() {
    const c = $('#content'); if (!c) return;
    c.replaceChildren(); S.listEl = null;
    if (S.tab === 'settings') { c.append(...settingsView()); return; }
    if (S.tab === 'history') { c.append(...historyView()); return; }
    const search = h('div', { class: 'search' }, icon('search'),
      h('input', { class: 'inp', type: 'search', placeholder: 'Cari ' + TABS[S.tab].one + '…', value: S.q, 'aria-label': 'Cari',
        oninput: (e) => { S.q = e.target.value; refreshList(); } }));
    S.listEl = h('div', { class: 'list' });
    c.append(search, S.listEl);
    refreshList();
  }

  function subtitle(it) {
    if (it.type === 'note') return (it.body || '').split('\n').find((l) => l.trim()) || '(kosong)';
    if (it.type === 'pass') return [it.user, it.url].filter(Boolean).join(' · ') || '••••••••';
    return (it.name || 'berkas') + ' · ' + fmtSize(it.size);
  }

  function refreshList() {
    if (!S.vault) return;
    if (S.tab === 'history') { renderTab(); return; }
    if (S.tab === 'settings' || !S.listEl) return;
    const ents = Data.entryMap(S.vault);
    const items = Data.visibleItems(S.vault, S.tab).filter((i) => Data.matches(i, S.q));
    if (!items.length) {
      S.listEl.replaceChildren(h('div', { class: 'empty' }, hexMark(64, icon(TABS[S.tab].ic)),
        h('div', null, S.q ? 'Tidak ada hasil untuk "' + S.q + '"' : 'Belum ada ' + TABS[S.tab].one + '. Ketuk tombol + untuk menambah.')));
      return;
    }
    S.listEl.replaceChildren(...items.map((it, i) => {
      const e = ents.get(it.id);
      return h('button', { class: 'blk', type: 'button', style: { animationDelay: Math.min(i, 8) * 30 + 'ms' }, onclick: () => openEditor(it.type, it) },
        h('div', { class: 'blk-n' }, '#' + (e ? e.n : '?')),
        h('div', { class: 'blk-b' }, h('div', { class: 'blk-t' }, it.title || '(tanpa judul)'), h('div', { class: 'blk-s' }, subtitle(it))),
        h('div', { class: 'blk-h' }, shortHash(e && e.itemHash)));
    }));
  }

  /* ---------- halaman penuh + tombol Back Android ---------- */
  const pages = [];
  let ignorePop = 0;
  function openPage(o) {
    const back = () => api.back();
    const head = h('div', { class: 'page-head' },
      h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Kembali', onclick: back }, icon('back')),
      h('h2', null, o.title), ...(o.right || []));
    const page = h('div', { class: 'page' }, head, h('div', { class: 'page-body' }, o.body));
    $('#layer').append(page);
    requestAnimationFrame(() => page.classList.add('in'));
    history.pushState({ p: pages.length + 1 }, '');
    const api = {
      el: page,
      async back(fromPop) {
        if (o.onBack && !(await o.onBack())) return false;
        api.close(fromPop); return true;
      },
      close(fromPop) {
        const i = pages.indexOf(api); if (i < 0) return;
        pages.splice(i, 1);
        page.classList.remove('in'); setTimeout(() => page.remove(), 280);
        if (o.onClose) o.onClose();
        if (!fromPop) { ignorePop++; history.back(); }
      },
    };
    pages.push(api);
    return api;
  }
  function closeAllPages() {
    const n = pages.length; if (!n) return;
    for (const p of pages.splice(0)) { p.el.remove(); }
    ignorePop++; history.go(-n);
  }
  window.addEventListener('popstate', async () => {
    if (ignorePop > 0) { ignorePop--; return; }
    const top = pages[pages.length - 1]; if (!top) return;
    const closed = await top.back(true);
    if (!closed) history.pushState({ p: pages.length }, '');
  });

  /* ---------- editor item ---------- */
  const fieldEl = (label, ...kids) => h('div', { class: 'field' }, h('label', null, label), ...kids);

  function noteForm(it) {
    const t = h('input', { class: 'inp', placeholder: 'Judul catatan', value: it.title, maxLength: 200 });
    const b = h('textarea', { class: 'inp', placeholder: 'Tulis catatan…', value: it.body });
    return { el: [fieldEl('Judul', t), fieldEl('Isi', b)], collect: () => ({ ...it, title: t.value.trim(), body: b.value }) };
  }

  function passForm(it, touch) {
    const title = h('input', { class: 'inp', placeholder: 'Mis. Gmail pribadi', value: it.title, maxLength: 200 });
    const user = h('input', { class: 'inp', placeholder: 'Email / username', value: it.user, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
    const pass = h('input', { class: 'inp mono', type: 'password', placeholder: 'Password', value: it.pass, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
    const url = h('input', { class: 'inp', placeholder: 'https://…', value: it.url, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
    const note = h('textarea', { class: 'inp', placeholder: 'Catatan (pertanyaan keamanan, kode cadangan, dll.)', value: it.note, style: { minHeight: '110px' } });
    const eye = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Tampilkan password', onclick: () => {
      const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; eye.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
    } }, icon('eye'));
    return {
      el: [
        fieldEl('Nama akun / situs', title),
        fieldEl('Username', h('div', { class: 'inp-row' }, user, h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Salin username', onclick: () => user.value && copy(user.value, 'Username') }, icon('copy')))),
        fieldEl('Password', h('div', { class: 'inp-row' }, pass, eye,
          h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Salin password', onclick: () => pass.value && copy(pass.value, 'Password') }, icon('copy')),
          h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Buat password acak', onclick: () => openGenerator((v) => { pass.value = v; pass.type = 'text'; eye.replaceChildren(icon('eyeoff')); touch(); }) }, icon('dice')))),
        fieldEl('Alamat situs', url),
        fieldEl('Catatan', note),
      ],
      collect: () => ({ ...it, title: title.value.trim() || url.value.trim() || user.value.trim(), user: user.value.trim(), pass: pass.value, url: url.value.trim(), note: note.value }),
    };
  }

  function fileForm(it, touch, isNew) {
    const title = h('input', { class: 'inp', placeholder: 'Judul berkas', value: it.title, maxLength: 200 });
    const note = h('textarea', { class: 'inp', placeholder: 'Catatan (opsional)', value: it.note, style: { minHeight: '90px' } });
    const box = h('div');
    const holder = h('div');
    let url = null;
    const draw = () => {
      if (url) { URL.revokeObjectURL(url); url = null; }
      const kids = [];
      if (it.data && /^image\/(png|jpe?g|gif|webp)$/.test(it.mime)) {
        url = URL.createObjectURL(new Blob([Sandi.fromB64(it.data)], { type: it.mime }));
        kids.push(h('img', { class: 'preview', src: url, alt: it.name }));
      }
      kids.push(h('div', { class: 'filebox' }, icon('file'),
        it.data ? [h('div', { class: 'nm' }, it.name), h('div', { class: 'mut' }, fmtSize(it.size) + ' · ' + (it.mime || 'berkas'))] : h('div', { class: 'mut' }, 'Belum ada berkas dipilih (maks. 2 MB)')));
      kids.push(h('div', { class: 'row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => picker.click() }, icon('upload'), it.data ? 'Ganti berkas' : 'Pilih berkas'),
        it.data ? h('button', { class: 'btn', type: 'button', onclick: () => download(it.name || 'berkas', new Blob([Sandi.fromB64(it.data)], { type: it.mime || 'application/octet-stream' })) }, icon('download'), 'Unduh') : null));
      box.replaceChildren(...kids);
    };
    const picker = h('input', { type: 'file', class: 'hide', onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > Data.MAX_FILE) { toast('Berkas terlalu besar. Maksimal 2 MB per berkas.', 'err'); return; }
      const others = Data.filesBytes(S.vault) - (isNew ? 0 : (it.size || 0));
      if (others + f.size > Data.MAX_TOTAL) { toast('Total berkas melebihi batas ±25 MB. Hapus berkas lain dulu.', 'err'); return; }
      try {
        it.data = Sandi.toB64(await f.arrayBuffer());
        it.name = f.name; it.mime = f.type || 'application/octet-stream'; it.size = f.size;
        if (!title.value.trim()) title.value = f.name;
        touch(); draw();
      } catch (ex) { toast('Gagal membaca berkas: ' + ex.message, 'err'); }
    } });
    draw();
    holder.append(picker, box);
    return { el: [holder, fieldEl('Judul', title), fieldEl('Catatan', note)], dispose: () => { if (url) URL.revokeObjectURL(url); },
      collect: () => ({ ...it, title: title.value.trim() || it.name, note: note.value }) };
  }

  function openEditor(type, existing) {
    const isNew = !existing;
    const it = existing ? JSON.parse(JSON.stringify(existing)) : Data.makeItem(type);
    let touched = false;
    const touch = () => { touched = true; };
    const form = type === 'note' ? noteForm(it) : type === 'pass' ? passForm(it, touch) : fileForm(it, touch, isNew);
    const body = h('div', null, ...form.el);
    const onEdit = (e) => { if (!(e.target && e.target.type === 'file')) touch(); }; // berkas: ditandai hanya jika berhasil dibaca
    body.addEventListener('input', onEdit);
    body.addEventListener('change', onEdit);

    if (!isNew) {
      const e = Data.entryMap(S.vault).get(it.id);
      body.append(h('div', { class: 'page-foot' },
        'blok ', h('b', null, '#' + (e ? e.n : '?')), ' · hash ', h('b', null, shortHash(e && e.itemHash)), h('br'),
        'dibuat ', fmtTime(it.created), h('br'), 'diubah ', fmtTime(it.updated)));
    }

    const save = async () => {
      const out = form.collect();
      if (type === 'note') {
        if (!out.title && !out.body.trim()) { toast('Isi judul atau catatan dulu.', 'err'); return; }
        if (!out.title) out.title = out.body.trim().split('\n')[0].slice(0, 40);
      } else if (type === 'pass') {
        if (!out.title) { toast('Isi nama akun atau situs dulu.', 'err'); return; }
      } else if (!out.data) { toast('Pilih berkas dulu.', 'err'); return; }
      if (!isNew && !touched) { page.close(); return; }
      try {
        await commit((v) => Data.saveItem(v, out));
        touched = false; refreshList(); toast('Tersimpan ✓ blok baru ditambahkan'); page.close();
      } catch (ex) { toast('Gagal menyimpan: ' + ex.message, 'err'); }
    };
    const del = async () => {
      const ok = await confirmDialog({ title: 'Hapus "' + (it.title || 'item ini') + '"?',
        text: 'Isinya dihapus permanen. Riwayat (judul dan hash) tetap tercatat di rantai.', danger: true, okText: 'Hapus' });
      if (!ok) return;
      try { await commit((v) => Data.removeItem(v, it.id)); touched = false; refreshList(); toast('Dihapus'); page.close(); }
      catch (ex) { toast('Gagal menghapus: ' + ex.message, 'err'); }
    };
    const page = openPage({
      title: (isNew ? 'Baru · ' : '') + TABS[type].label,
      body,
      right: [!isNew ? h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Hapus', onclick: del }, icon('trash')) : null,
        h('button', { class: 'btn primary small', type: 'button', onclick: save }, 'Simpan')],
      onBack: async () => !touched || confirmDialog({ title: 'Buang perubahan?', text: 'Ada perubahan yang belum disimpan.', okText: 'Buang', danger: true }),
      onClose: () => form.dispose && form.dispose(),
    });
    if (isNew && type !== 'file') setTimeout(() => { const f = body.querySelector('input,textarea'); if (f) f.focus(); }, 320);
  }

  /* ---------- generator password ---------- */
  function openGenerator(onUse) {
    const o = { length: 20, lower: true, upper: true, digits: true, symbols: true };
    const out = h('div', { class: 'gen-out', 'aria-live': 'polite' });
    const lenLbl = h('b', { class: 'mono' }, '20');
    const gen = () => { out.textContent = Sandi.generatePassword(o); };
    const len = h('input', { class: 'range', type: 'range', min: 8, max: 40, value: 20, 'aria-label': 'Panjang password',
      oninput: (e) => { o.length = +e.target.value; lenLbl.textContent = e.target.value; gen(); } });
    const opt = (k, label) => h('label', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => { o[k] = e.target.checked; gen(); } }), label);
    gen();
    const s = sheet(h('div', { class: 'dlg' },
      h('h3', null, 'Buat password acak'), out,
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'lbl' }, 'Panjang'), lenLbl), len,
      h('div', { class: 'opts' }, opt('lower', 'abc'), opt('upper', 'ABC'), opt('digits', '123'), opt('symbols', '#$%')),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', type: 'button', onclick: gen }, icon('refresh'), 'Acak ulang'),
        h('button', { class: 'btn primary grow', type: 'button', onclick: () => { onUse(out.textContent); s.close(); } }, 'Pakai'))));
  }

  /* ---------- riwayat ---------- */
  function historyView() {
    const r = S.integrity;
    const cls = !r ? '' : r.ok ? 'ok' : 'bad';
    const card = h('div', { class: 'card integ ' + cls },
      icon(!r ? 'refresh' : r.ok ? 'shield' : 'warn'),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, !r ? 'Memeriksa rantai…' : r.ok ? 'Rantai utuh' : 'Rantai bermasalah'),
        h('div', { class: 's' }, !r ? 'Mohon tunggu' : r.ok ? S.vault.chain.length + ' blok · semua hash cocok' : r.reason + (r.at >= 0 ? ' (blok #' + r.at + ')' : ''))),
      h('button', { class: 'btn small', type: 'button', onclick: runVerify }, 'Periksa'));
    const all = S.vault.chain;
    const shown = all.slice(Math.max(0, all.length - S.histLimit)).reverse();
    const chain = h('div', { class: 'chain' }, shown.map((e, i) => h('div', { class: 'cblk' + (r && !r.ok && r.at === e.n ? ' bad' : ''), style: { animationDelay: Math.min(i, 8) * 30 + 'ms' } },
      h('div', { class: 'cblk-top' }, h('b', null, '#' + e.n), h('span', null, fmtTime(e.ts))),
      h('div', null, h('span', { class: 'act ' + e.action }, ACTION[e.action] || e.action), e.kind ? h('span', { class: 'mut' }, KIND[e.kind] || e.kind) : null),
      h('div', { class: 'cblk-t' }, e.title || '—'),
      h('div', { class: 'cblk-h' }, h('i', null, 'hash '), shortHash(e.hash), h('i', null, '  ←  prev '), shortHash(e.prev)))));
    const more = all.length > S.histLimit ? h('button', { class: 'btn ghost block', type: 'button', onclick: () => { S.histLimit += 40; renderTab(); } }, 'Muat blok lebih lama (' + (all.length - S.histLimit) + ')') : null;
    return [card, chain, more];
  }
  async function runVerify() {
    S.integrity = null; refreshChrome(); if (S.tab === 'history') renderTab();
    const r = await Data.verify(S.vault);
    S.integrity = r; refreshChrome(); if (S.tab === 'history') renderTab();
    toast(r.ok ? 'Rantai utuh ✓' : 'Rantai bermasalah: ' + r.reason, r.ok ? '' : 'err');
  }

  /* ---------- pengaturan ---------- */
  const card = (title, ic, ...kids) => h('div', { class: 'card' }, h('h3', null, icon(ic), title), ...kids);
  const kv = (a, b, id) => h('div', { class: 'kv' }, h('span', null, a), h('span', { id }, b));

  function settingsView() {
    const out = [];
    if (!LS.get('bk.lastBackup')) {
      out.push(h('div', { class: 'note-box warn', style: { marginBottom: '14px' } }, 'Kamu belum pernah mengekspor cadangan. Kalau data browser terhapus dan Drive belum terhubung, isi brankas hilang. Ekspor cadangan di bawah.'));
    }
    // --- Drive
    const cid = h('input', { class: 'inp mono', placeholder: 'xxxx.apps.googleusercontent.com', value: Drive.clientId(), autocapitalize: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': 'Client ID Google',
      onchange: (e) => Drive.setClientId(e.target.value) });
    const conn = Drive.connected();
    out.push(card('Sinkron Google Drive', 'cloud',
      h('p', { class: 'desc' }, 'Salinan terenkripsi disimpan di folder tersembunyi aplikasi di Drive-mu. Aplikasi tidak bisa melihat file Drive lainnya. Google hanya menerima data yang sudah terkunci.'),
      kv('Status', syncLabel(), 'sync-status'), kv('Terakhir sinkron', S.lastSync ? ago(S.lastSync) : 'belum pernah', 'sync-last'),
      h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', null, 'Client ID Google'), cid),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          Drive.setClientId(cid.value);
          if (!Drive.clientId()) { toast('Isi Client ID dulu. Panduannya ada di README.', 'err'); return; }
          await syncNow(true); if (S.tab === 'settings') renderTab();
        } }, icon('refresh'), conn ? 'Sinkron sekarang' : 'Hubungkan Google Drive'),
        conn ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { Drive.disconnect(); setSync('off'); renderTab(); toast('Google Drive diputuskan'); } }, 'Putuskan Drive') : null),
      h('div', { class: 'kv', style: { marginTop: '8px' } }, h('span', null, 'Origin situs'), h('span', { class: 'mono', style: { fontSize: '12px' } }, location.origin)),
      S.sync.msg ? h('div', { class: 'err-t', id: 'sync-msg' }, S.sync.msg) : null));

    // --- Keamanan
    const lockSel = h('select', { class: 'inp', 'aria-label': 'Kunci otomatis', onchange: (e) => LS.set('bk.lock', e.target.value) },
      [['leave', 'Saat aplikasi ditinggalkan'], ['1', '1 menit tidak aktif'], ['2', '2 menit tidak aktif'], ['5', '5 menit tidak aktif'], ['10', '10 menit tidak aktif']]
        .map(([v, l]) => h('option', { value: v, selected: LS.get('bk.lock', '2') === v }, l)));
    out.push(card('Keamanan', 'shield',
      h('div', { class: 'field' }, h('label', null, 'Kunci otomatis'), lockSel),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', type: 'button', onclick: changePasswordSheet }, 'Ganti password utama'),
        h('button', { class: 'btn', type: 'button', onclick: newRecoveryFlow }, 'Buat kode pemulihan baru'))));

    // --- Cadangan
    const lb = LS.get('bk.lastBackup');
    out.push(card('Cadangan', 'download',
      h('p', { class: 'desc' }, 'File cadangan sudah terenkripsi. Simpan di tempat terpisah (mis. Google Drive biasa atau pesan ke diri sendiri). Hanya bisa dibuka dengan password brankas ini.'),
      kv('Terakhir ekspor', lb ? ago(+lb) : 'belum pernah'),
      h('div', { class: 'btns', style: { marginTop: '10px' } },
        h('button', { class: 'btn', type: 'button', onclick: exportBackup }, icon('download'), 'Ekspor cadangan'),
        h('button', { class: 'btn', type: 'button', onclick: importUnlocked }, icon('upload'), 'Impor cadangan'))));

    // --- Info
    const v = S.vault;
    out.push(card('Isi brankas', 'chain',
      kv('Catatan', String(Data.visibleItems(v, 'note').length)), kv('Sandi akun', String(Data.visibleItems(v, 'pass').length)),
      kv('Berkas', Data.visibleItems(v, 'file').length + ' · ' + fmtSize(Data.filesBytes(v)) + ' / 25 MB'),
      kv('Blok rantai', String(v.chain.length)), kv('Versi', 'v' + VERSION)));

    // --- Bahaya
    out.push(card('Zona bahaya', 'warn',
      h('p', { class: 'desc' }, 'Menghapus data hanya di HP ini. Salinan di Google Drive dan file cadangan tidak ikut terhapus.'),
      h('button', { class: 'btn danger block', type: 'button', onclick: wipeLocal }, icon('trash'), 'Hapus data di HP ini')));
    if (Drive.clientId()) Drive.preload();
    return out;
  }

  function updateSettingsSync() {
    const a = $('#sync-status'); if (a) a.textContent = syncLabel();
    const b = $('#sync-last'); if (b) b.textContent = S.lastSync ? ago(S.lastSync) : 'belum pernah';
    const m = $('#sync-msg'); if (m) m.textContent = S.sync.msg || '';
  }

  function pwFields() {
    const mk = (ph, ac) => h('input', { class: 'inp', type: 'password', placeholder: ph, autocomplete: ac });
    return { cur: mk('Password saat ini', 'off'), n1: mk('Password baru (min. 10 karakter)', 'new-password'), n2: mk('Ulangi password baru', 'new-password') };
  }
  function changePasswordSheet() {
    const { cur, n1, n2 } = pwFields();
    const err = h('div', { class: 'err-t' });
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Ganti password');
    const s = sheet(h('form', {
      class: 'dlg',
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        if (n1.value.length < 10) { err.textContent = 'Password baru minimal 10 karakter.'; return; }
        if (n1.value !== n2.value) { err.textContent = 'Password baru tidak sama.'; return; }
        go.disabled = true; err.textContent = 'Menghitung kunci…';
        try {
          if (!(await Sandi.verifyPassword(S.container, cur.value))) { err.textContent = 'Password saat ini salah.'; go.disabled = false; return; }
          const c = await Sandi.setPassword(S.container, S.key, n1.value);
          await lock(async () => { S.container = c; S.dirty = true; await Store.set('vault', c); await saveMeta(); });
          scheduleSync(); s.close(); toast('Password utama diganti ✓');
        } catch (ex) { go.disabled = false; err.textContent = 'Gagal: ' + ex.message; }
      },
    }, h('h3', null, 'Ganti password utama'),
      h('div', { class: 'field', style: { marginTop: '12px' } }, cur), h('div', { class: 'field' }, n1), h('div', { class: 'field' }, n2, err),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => s.close() }, 'Batal'), go)));
  }

  async function newRecoveryFlow() {
    const ok = await confirmDialog({ title: 'Buat kode pemulihan baru?', text: 'Kode pemulihan yang lama langsung tidak berlaku. Kamu harus mencatat kode yang baru.', okText: 'Buat kode baru' });
    if (!ok) return;
    try {
      const r = await Sandi.newRecovery(S.container, S.key);
      await lock(async () => { S.container = r.container; S.dirty = true; await Store.set('vault', r.container); await saveMeta(); });
      scheduleSync();
      showCodeSheet(r.code);
    } catch (ex) { toast('Gagal: ' + ex.message, 'err'); }
  }
  function showCodeSheet(code) {
    const chk = h('input', { type: 'checkbox' });
    const btn = h('button', { class: 'btn primary block', type: 'button', disabled: true, onclick: () => s.close() }, 'Selesai');
    chk.addEventListener('change', () => { btn.disabled = !chk.checked; });
    const s = sheet(h('div', { class: 'dlg' },
      h('h3', null, 'Kode pemulihan baru'),
      h('p', { class: 'mut' }, 'Tulis kode ini di kertas dan simpan di luar HP. Tidak akan ditampilkan lagi.'),
      codeBox(code),
      h('div', { class: 'row', style: { margin: '12px 0 0' } }, h('button', { class: 'btn small', type: 'button', onclick: () => copy(code, 'Kode pemulihan') }, icon('copy'), 'Salin')),
      h('label', { class: 'check' }, chk, h('span', null, 'Aku sudah mencatat kode ini di tempat aman.')), btn), { locked: true, center: true });
  }

  /* ---------- cadangan ---------- */
  function exportBackup() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    const name = 'blockchain-keep-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.bkeep.json';
    download(name, new Blob([JSON.stringify(S.container)], { type: 'application/json' }));
    LS.set('bk.lastBackup', String(Date.now()));
    toast('Cadangan terenkripsi diunduh ✓'); if (S.tab === 'settings') renderTab();
  }

  function pickFile() {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: '.json,application/json', class: 'hide' });
      inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
      inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
      document.body.append(inp); inp.click();
    });
  }
  async function readBackup(file) {
    try {
      const rc = JSON.parse(await file.text());
      if (!Sandi.isContainer(rc)) throw new Error('bukan cadangan');
      return rc;
    } catch (e) { toast('File itu bukan cadangan Blockchain Keep yang valid.', 'err'); return null; }
  }

  async function importAtWelcome() {
    const f = await pickFile(); if (!f) return;
    const rc = await readBackup(f); if (!rc) return;
    S.container = rc; S.corrupt = false; S.dirty = true; S.lastSync = 0;
    await Store.set('vault', rc); await saveMeta();
    lockScreen(); toast('Cadangan dipasang. Masukkan password brankas tersebut.');
  }

  async function importUnlocked() {
    const f = await pickFile(); if (!f) return;
    const rc = await readBackup(f); if (!rc) return;
    let rv = null;
    try { rv = await Sandi.decryptData(rc, S.key); } catch (e) { /* kunci berbeda */ }
    try {
      if (rv) {
        await commit(async (v) => { const m = await Data.merge(v, rv); v.items = m.items; v.chain = m.chain; });
        refreshList(); toast('Cadangan digabung ke brankas ✓');
      } else {
        const ok = await confirmDialog({ title: 'Ganti dengan cadangan ini?',
          text: 'Cadangan ini memakai kunci yang berbeda dari brankas yang sedang terbuka. Mengimpornya akan MENGGANTI seluruh isi brankas di HP ini. Pastikan brankas saat ini sudah kamu ekspor.',
          danger: true, okText: 'Ganti brankas' });
        if (!ok) return;
        await lock(async () => { await Store.set('vault', rc); S.container = rc; S.dirty = true; S.lastSync = 0; await saveMeta(); });
        lockNow('Cadangan dipasang. Masukkan password cadangan tersebut.');
      }
    } catch (ex) { toast('Gagal impor: ' + ex.message, 'err'); }
  }

  async function wipeLocal() {
    const inp = h('input', { class: 'inp', placeholder: 'ketik HAPUS', autocomplete: 'off', style: { marginTop: '12px' } });
    const ok = await confirmDialog({ title: 'Hapus semua data di HP ini?',
      text: 'Brankas di perangkat ini dihapus permanen. Pastikan kamu punya salinan di Drive atau file cadangan, plus password dan kode pemulihannya.',
      body: inp, danger: true, okText: 'Hapus semua' });
    if (!ok) return;
    if (inp.value.trim() !== 'HAPUS') { toast('Teks konfirmasi tidak cocok. Tidak ada yang dihapus.', 'err'); return; }
    try {
      await Store.clear();
      ['bk.lock', 'bk.lastBackup', 'bk.drive', 'bk.clientId'].forEach((k) => LS.del(k));
      location.reload();
    } catch (ex) { toast('Gagal menghapus: ' + ex.message, 'err'); }
  }

  /* ---------- Google Drive ---------- */
  function restoreFromDrive() {
    const cid = h('input', { class: 'inp mono', placeholder: 'xxxx.apps.googleusercontent.com', value: Drive.clientId(), autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
    const err = h('div', { class: 'err-t' });
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Masuk Google & ambil');
    Drive.preload();
    const s = sheet(h('form', {
      class: 'dlg',
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        Drive.setClientId(cid.value);
        if (!Drive.clientId()) { err.textContent = 'Isi Client ID dulu.'; return; }
        go.disabled = true; err.textContent = 'Menghubungi Google Drive…';
        try {
          const f = await Drive.find(true);
          if (!f) { err.textContent = 'Tidak ada brankas Blockchain Keep di Drive akun ini.'; go.disabled = false; return; }
          let rc; try { rc = JSON.parse(await Drive.download(f.id)); } catch (x) { throw new Error('File di Drive tidak terbaca'); }
          if (!Sandi.isContainer(rc)) throw new Error('File di Drive bukan brankas Blockchain Keep');
          S.container = rc; S.corrupt = false; S.dirty = false; S.lastSync = Date.now();
          await Store.set('vault', rc); await saveMeta();
          s.close(); lockScreen(); toast('Brankas diambil dari Drive ✓ Masukkan password.');
        } catch (ex) { go.disabled = false; err.textContent = ex.message; }
      },
    }, h('h3', null, 'Ambil dari Google Drive'),
      h('p', { class: 'mut' }, 'Masukkan Client ID Google yang sama dengan saat pertama kali menghubungkan, lalu masuk dengan akun Google yang sama.'),
      h('div', { class: 'field' }, cid, err),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => s.close() }, 'Batal'), go)));
  }

  let syncTimer = null, syncing = false, syncAgain = false;
  function setSync(state, msg) { S.sync = { state, msg: msg || '' }; refreshChrome(); }
  function scheduleSync() {
    if (!Drive.connected()) { if (S.sync.state !== 'off') setSync('off'); return; }
    if (syncing) { syncAgain = true; return; }
    setSync('pending');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(false), 2500);
  }

  async function syncNow(interactive) {
    if (!S.key || !S.vault) return;
    if (!Drive.clientId()) { toast('Isi Client ID Google dulu di menu Atur.', 'err'); return; }
    if (syncing) { syncAgain = true; return; }
    if (!navigator.onLine) { setSync('offline'); if (interactive) toast('Tidak ada koneksi internet.', 'err'); return; }
    syncing = true; clearTimeout(syncTimer); setSync('syncing');
    try {
      const file = await Drive.find(interactive);
      let rc = null, rv = null;
      if (file) {
        let parsed;
        try { parsed = JSON.parse(await Drive.download(file.id)); } catch (e) { throw new Error('File di Drive tidak terbaca'); }
        if (!Sandi.isContainer(parsed)) throw new Error('File di Drive bukan brankas Blockchain Keep');
        rc = parsed;
        try { rv = await Sandi.decryptData(rc, S.key); }
        catch (e) {
          const ok = await confirmDialog({ title: 'Brankas di Drive berbeda',
            text: 'File di Drive memakai kunci yang berbeda dari brankas di HP ini (mungkin brankas lain). Timpa isi Drive dengan brankas dari HP ini? Isi Drive yang lama akan hilang.',
            danger: true, okText: 'Timpa Drive' });
          if (!ok) { setSync('error', 'Sinkron dibatalkan: kunci brankas di Drive berbeda.'); return; }
          rc = null;
        }
      }
      let payload = null, needUpload = true, revAt = 0;
      await lock(async () => {
        if (!S.key || !S.vault) throw new Error('Brankas terkunci');
        if (rv) {
          const headBefore = Data.head(S.vault);
          const localHdrNewer = (S.container.hdrAt || 0) > (rc.hdrAt || 0);
          const m = await Data.merge(S.vault, rv);
          let changed = Data.head(m) !== headBefore;
          S.vault = m;
          if ((rc.hdrAt || 0) > (S.container.hdrAt || 0)) {
            S.container = { ...S.container, hdrAt: rc.hdrAt, kdf: rc.kdf, pw: rc.pw, rec: rc.rec }; changed = true;
          }
          if (changed) {
            S.container = await Sandi.encryptData(S.container, S.key, S.vault);
            await Store.set('vault', S.container);
            S.integrity = await Data.verify(S.vault, { items: false });
          }
          needUpload = S.dirty || Data.head(m) !== Data.head(rv) || localHdrNewer;
          if (changed) { refreshList(); }
        }
        payload = JSON.stringify(S.container); revAt = S.rev;
      });
      if (needUpload) await Drive.upload(payload, file && file.id);
      S.lastSync = Date.now();
      if (S.rev === revAt) S.dirty = false;
      await saveMeta();
      setSync('ok');
    } catch (e) {
      if (e && e.code === 'LOGIN') { setSync('login'); if (interactive) toast(e.message, 'err'); }
      else { setSync(navigator.onLine ? 'error' : 'offline', e && e.message); if (interactive) toast('Sinkron gagal: ' + (e && e.message), 'err'); }
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }
  }
  window.addEventListener('online', () => { if (S.key && Drive.connected() && S.dirty) syncNow(false); });
  window.addEventListener('offline', () => { if (S.key && Drive.connected()) setSync('offline'); });

  /* ---------- kunci otomatis ---------- */
  const bump = () => { S.lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, bump, { passive: true, capture: true }));
  setInterval(() => {
    if (!S.key) return;
    const m = LS.get('bk.lock', '2');
    if (m !== 'leave' && Date.now() - S.lastActive > Number(m) * 60000) lockNow('Terkunci otomatis');
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!S.key) return;
    const m = LS.get('bk.lock', '2');
    if (document.visibilityState === 'hidden') {
      S.hiddenAt = Date.now();
      if (m === 'leave') lockNow();
    } else if (S.hiddenAt) {
      if (m !== 'leave' && Date.now() - S.hiddenAt > Number(m) * 60000) lockNow('Terkunci otomatis');
      S.hiddenAt = 0;
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    const m = e.reason && e.reason.message; if (m) toast('Terjadi kesalahan: ' + m, 'err');
  });

  /* ---------- mulai ---------- */
  async function boot() {
    try {
      S.container = (await Store.get('vault')) || null;
      const m = (await Store.get('meta')) || {};
      S.dirty = !!m.dirty; S.lastSync = m.lastSync || 0;
    } catch (e) {
      mount(h('div', { class: 'center-screen' }, hexMark(90, icon('warn')), h('h2', null, 'Penyimpanan tidak tersedia'),
        h('p', { class: 'tag' }, 'Browser memblokir penyimpanan lokal (mungkin mode privat). Buka lewat Chrome biasa.')));
      return;
    }
    if (S.container && !Sandi.isContainer(S.container)) { S.corrupt = true; S.container = null; }
    if (S.container) lockScreen(); else welcome();
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode tidak aktif */ });
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* abaikan */ }
  boot();
})();
