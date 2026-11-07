# Blockchain Keep v1.0.0

Brankas pribadi terenkripsi untuk **catatan**, **sandi akun**, dan **berkas kecil**.
Berjalan sebagai web app (PWA) di HP, bisa dibuka offline, dan bisa disinkronkan lewat **Google Drive** milikmu sendiri.

> Bukan blockchain publik. Data pribadi tidak cocok ditaruh di blockchain publik (bisa dilihat semua orang dan tidak bisa dihapus). Yang dipinjam dari blockchain hanya **rantai hash** untuk riwayat perubahan, ditambah enkripsi kuat di perangkatmu.

---

## Fitur

- **Tiga jenis data:** catatan, sandi akun (dengan generator password acak dan tombol salin), berkas kecil (maks. 2 MB per berkas, total ±25 MB).
- **Enkripsi di perangkatmu:** AES-256-GCM, kunci dari password utama lewat PBKDF2 (600.000 putaran). Yang disimpan di HP dan Google Drive hanya data terenkripsi.
- **Kode pemulihan:** 24 karakter, dibuat saat setup. Satu-satunya jalan masuk kalau lupa password.
- **Riwayat berupa rantai hash:** setiap tambah, ubah, dan hapus menjadi satu blok yang terkait ke blok sebelumnya. Tombol **Periksa** memverifikasi seluruh rantai.
- **Sinkron Google Drive:** ke folder tersembunyi khusus aplikasi (`appDataFolder`). Aplikasi tidak bisa melihat file Drive lain milikmu.
- **Offline:** bisa dibuka dan diedit tanpa internet, lalu disinkronkan saat online.
- **Kunci otomatis:** saat tidak aktif 1 sampai 10 menit, atau langsung saat aplikasi ditinggalkan.
- **Cadangan:** ekspor dan impor file terenkripsi.
- Tombol **Back** Android menutup halaman editor (tidak keluar dari aplikasi).

## Isi folder

Semua file sengaja diletakkan **rata dalam satu folder** supaya mudah diupload dari HP.

| File | Fungsi |
|---|---|
| `index.html` | Halaman utama dan kebijakan keamanan konten (CSP) |
| `keep.css` | Tampilan (tema gelap ala blockchain) |
| `sandi.js` | Enkripsi, kunci, kode pemulihan, generator password |
| `data.js` | Item, rantai hash, penggabungan data, penyimpanan IndexedDB |
| `drive.js` | Sinkron Google Drive |
| `ui.js` | Pembantu tampilan: elemen, ikon, dialog, toast |
| `app.js` | Alur aplikasi |
| `sw.js` | Service worker (mode offline) |
| `manifest.webmanifest` | Agar bisa dipasang seperti aplikasi |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png` | Ikon |
| `README.md` | Dokumen ini |

Tidak ada library pihak ketiga dan tidak ada proses build. Aplikasi tidak memuat font atau skrip dari luar, kecuali layanan login Google saat kamu memakai Drive.

---

## Menghubungkan Google Drive (sekali saja)

Langkah ini membuat "Client ID" supaya aplikasimu boleh meminta izin ke Drive-mu sendiri. Gratis dan bisa dari HP. Tampilan Google Cloud sering berubah, jadi nama menu bisa sedikit berbeda.

1. Buka **console.cloud.google.com** dan masuk dengan akun Google yang akan menyimpan brankas. Kalau perlu, pakai *Situs desktop* di menu Chrome.
2. Buat **proyek baru**, misalnya `Blockchain Keep`.
3. **APIs & Services → Library**, cari **Google Drive API**, lalu **Enable**.
4. **OAuth consent screen** (atau *Google Auth Platform*): isi nama aplikasi dan email, pilih **External**. Tambahkan akun Gmail-mu sebagai **Test user**. Di bagian *Scopes* tambahkan `.../auth/drive.appdata`. Hanya itu izin yang diminta.
5. **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins:** isi `https://NAMA-GITHUB-KAMU.github.io` (tanpa nama repositori dan tanpa garis miring di akhir).
   - Klik **Create**, lalu salin **Client ID** (berakhiran `.apps.googleusercontent.com`).
6. Di aplikasi: **⚙ Atur → Sinkron Google Drive**, tempel Client ID, ketuk **Hubungkan Google Drive**, lalu setujui izinnya.

Kalau Google menampilkan "aplikasi belum diverifikasi", pilih **Lanjutan → lanjutkan**. Itu normal untuk aplikasi pribadi, dan akunmu sendiri yang menjadi pemiliknya. Kolom **Origin situs** di halaman Atur menampilkan alamat yang harus cocok dengan langkah 5.

**HP baru atau data browser terhapus?** Di layar awal pilih **Ambil dari Google Drive**, isi Client ID yang sama, masuk dengan akun yang sama, lalu masukkan password brankas.

---

## Cara pakai

1. **Buat brankas:** pilih password utama (min. 10 karakter, makin panjang makin baik), lalu **catat kode pemulihan di kertas** dan simpan di luar HP.
2. Tombol **＋** (heksagon di tengah bawah) menambah item sesuai tab yang sedang dibuka. Di tab Riwayat, ia menawarkan pilihan jenis.
3. Ketuk kartu untuk membuka atau mengedit. **Simpan** menambahkan satu blok baru ke riwayat.
4. **Riwayat** menampilkan rantai blok. Kartu di atas menunjukkan apakah rantai utuh. Ketuk **Periksa** untuk memverifikasi ulang termasuk isi tiap item.
5. **⚙ Atur:** sinkron, ganti password, kode pemulihan baru, kunci otomatis, ekspor/impor cadangan, hapus data lokal.
6. Bar status di atas menunjukkan kondisi rantai, nomor blok terakhir, dan status sinkron. Kalau tertulis *ketuk untuk masuk Google*, ketuk bar itu untuk login ulang.

### Kalau terjadi masalah

| Situasi | Yang dilakukan |
|---|---|
| Lupa password | Layar kunci → **Lupa password? Pakai kode pemulihan** → pasang password baru |
| Lupa password **dan** kehilangan kode pemulihan | Data tidak bisa dipulihkan oleh siapa pun. Ini disengaja. |
| HP hilang atau diganti | Pasang ulang aplikasi → **Ambil dari Google Drive** (atau impor file cadangan) |
| Data browser terhapus | Sama seperti di atas |
| Rantai ditandai **RUSAK** | Jangan panik, buka tab Riwayat untuk melihat blok mana. Pulihkan dari cadangan atau salinan Drive. |

---

## Catatan keamanan yang jujur

- **Rantai hash mendeteksi perubahan yang tidak semestinya** (blok diubah, dihapus, atau isi item berbeda dari catatannya). Ia **bukan** perlindungan terhadap orang yang sudah tahu password-mu. Orang itu bisa membuka brankas dan menyusun rantai baru yang sah. Pelindung utamanya tetap enkripsi dan password.
- **Keamanan setara dengan password-mu.** Password pendek atau mudah ditebak melemahkan semuanya. Pakai kalimat panjang yang unik.
- **Perangkat yang terinfeksi** (malware, keylogger) bisa membaca isi saat brankas terbuka. Enkripsi tidak melindungi dari itu.
- **Clipboard:** teks yang disalin dihapus otomatis setelah 30 detik, tetapi aplikasi lain di HP bisa membacanya selama itu.
- **Judul item tetap ada di riwayat** setelah item dihapus (isinya terhapus, judul dan hash tidak). Semuanya tetap terenkripsi.
- **Kode ini belum diaudit pihak independen.** Ia memakai primitif standar browser (Web Crypto), tetapi untuk akun yang sangat penting (bank, email utama), pertimbangkan juga pengelola sandi yang sudah matang dan diaudit.
- **Pembatasan percobaan password** hanya di sisi aplikasi (jeda 30 detik setelah 5 kali salah). Yang melindungi sebenarnya adalah PBKDF2 yang lambat dan password yang kuat.
- **Cadangan:** Google Drive bukan cadangan yang kedap. Kalau salinan Drive terhapus atau rusak lalu tersinkron, data bisa ikut hilang. **Ekspor cadangan berkala** dan simpan di tempat lain.

## Batas V1.0.0

- Setiap sinkron mengunggah **seluruh brankas**. Kalau berisi banyak berkas, sinkron makin lambat dan boros kuota.
- Konflik edit ditentukan per item oleh **waktu ubah terbaru** (jam perangkat). Dua HP dengan jam yang beda jauh bisa saling menimpa.
- Satu brankas per akun Google di aplikasi ini.
- Pencarian mencakup judul, isi catatan, username, alamat situs, dan nama berkas. Password tidak ikut dicari.

## Rencana V2 (saat sumber daya ada)

Berkas besar dan sinkron per item, autentikasi dua faktor, buka kunci dengan sidik jari, berbagi item, server sendiri, serta audit keamanan.

## Yang sudah diuji

- Logika inti di Node (30 pemeriksaan): enkripsi, password salah, kode pemulihan, ganti password, data dimodifikasi, rantai hash (blok diubah, dihapus, dipalsukan), penggabungan data dari dua perangkat.
- Aplikasi di Chromium berukuran layar HP (50 pemeriksaan): setup, kunci/buka, editor, tombol Back, offline, pemulihan, cadangan, dan sinkron dua perangkat.
- **Belum diuji dengan Google sungguhan.** Sinkron diuji dengan Drive tiruan yang meniru API-nya. Login Google dan Client ID-mu baru bisa dicoba langsung di HP-mu, jadi coba dulu dengan data contoh sebelum menyimpan hal penting.

---

Dibuat dengan HTML, CSS, dan JavaScript murni. Versi **1.0.0**.
