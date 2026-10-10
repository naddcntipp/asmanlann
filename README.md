# Kotak Aspirasi Siswa

Website kotak aspirasi digital: siswa mengirim aspirasi, mendapat kode untuk melacak status,
dan semua orang bisa melihat ringkasan serta tanggapan sekolah di halaman Transparansi.
Admin mengelola aspirasi lewat `/admin`.

Backend memakai Node.js murni (tanpa `npm install`). Data disimpan di file JSON.

## 1. Sesuaikan
- **Logo sekolah**: ganti `public/assets/logo.png` dengan logo sekolah (PNG transparan paling bagus).
  Logo dipakai sebagai latar belakang, ikon browser, navigasi, dan footer.
- **Nama sekolah**: ubah `public/config.js`.
- **Warna**: ubah `--aksen` (dan `--aksen-tua`, `--aksen-lembut`) di bagian atas `public/style.css`.
- **Kategori**: ubah daftar `KATEGORI` di `server.js`.

## 2. Jalankan di komputer
Butuh Node.js 18 atau lebih baru.

```bash
cp .env.example .env      # lalu isi ADMIN_PASSWORD di file .env
node server.js
```

Buka http://localhost:3000 (admin: http://localhost:3000/admin).

## 3. Deploy jadi website

Pengaturan yang selalu diperlukan di hosting mana pun:

| Variabel | Isi |
|---|---|
| `ADMIN_PASSWORD` | Kata sandi admin (wajib, buat yang panjang) |
| `TRUST_PROXY` | `1` |
| `DATA_DIR` | Folder di disk permanen (lihat catatan di bawah) |

Perintah start: `node server.js`. Tidak ada langkah build.

**Penting: data harus disimpan di disk permanen.** Hosting gratis biasanya menghapus file
setiap kali server restart. Gunakan Persistent Disk / Volume, lalu arahkan `DATA_DIR` ke sana.

### Render.com
1. Unggah folder ini ke repository GitHub.
2. New > Web Service, pilih repository. Runtime: Node. Start command: `node server.js`.
3. Tambahkan variabel di atas. Tambahkan Disk (mis. mount path `/var/data`) dan set `DATA_DIR=/var/data`.
   Disk memerlukan paket berbayar.

### Railway
1. New Project > Deploy from GitHub repo.
2. Isi variabel di tab Variables. Tambahkan Volume dengan mount path `/data`, set `DATA_DIR=/data`.

### VPS (Ubuntu)
```bash
# instal Node.js 20+, lalu:
git clone <repo-anda> aspirasi && cd aspirasi
cp .env.example .env && nano .env
sudo npm i -g pm2
pm2 start server.js --name aspirasi && pm2 save && pm2 startup
```
Pasang Nginx sebagai reverse proxy ke `localhost:3000` dan aktifkan HTTPS dengan Certbot.

### Docker
```bash
docker build -t aspirasi .
docker run -d -p 3000:3000 -e ADMIN_PASSWORD=isi-sandi -e TRUST_PROXY=1 -v aspirasi-data:/data aspirasi
```

## Cadangan data
Salin file `aspirasi.json` di `DATA_DIR` secara berkala, atau gunakan tombol **Unduh CSV** di panel admin.

## Keamanan yang sudah ada
- Kata sandi admin hanya di server; sesi admin berupa token bertanda tangan yang berlaku 12 jam.
- Pembatas kiriman (20 per jam per jaringan), pembatas login, dan kolom jebakan untuk bot.
- Semua teks ditampilkan sebagai teks biasa (aman dari XSS) dan ada Content-Security-Policy.
- Alamat IP tidak disimpan. Aspirasi anonim tidak menyimpan nama sama sekali.
- Aspirasi baru tidak langsung tampil publik. Admin memeriksa dulu, lalu mencentang
  "Tampilkan di halaman Transparansi".

Catatan: semua siswa di jaringan Wi-Fi sekolah bisa terlihat memakai satu alamat IP. Batas 20 kiriman per jam
diatur di `server.js` (cari `'kirim:'`) jika perlu dinaikkan.
