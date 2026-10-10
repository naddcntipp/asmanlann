'use strict';

/**
 * Kotak Aspirasi Siswa - backend
 * Tanpa dependensi: cukup Node.js 18+ (`node server.js`).
 * Data disimpan di file JSON pada folder DATA_DIR.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- Muat file .env (opsional) ----------
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) { /* tidak ada .env, tidak masalah */ }

// ---------- Konfigurasi ----------
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());

const KATEGORI = ['Fasilitas', 'Kegiatan belajar', 'Kegiatan sekolah', 'Kebersihan', 'Keamanan', 'Kantin', 'Lainnya'];
const STATUS = ['Baru', 'Diproses', 'Selesai', 'Ditolak'];

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'aspirasi.json');

if (!ADMIN_PASSWORD) {
  console.warn('PERINGATAN: ADMIN_PASSWORD belum diatur. Panel admin dinonaktifkan sampai kata sandi diisi.');
}

// ---------- Penyimpanan ----------
let db = [];
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error('File data rusak atau tidak bisa dibaca:', DB_FILE, err.message);
    process.exit(1);
  }
}

let saving = Promise.resolve();
function saveDb() {
  saving = saving
    .then(async () => {
      const tmp = DB_FILE + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(db));
      await fs.promises.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error('Gagal menyimpan data:', err));
  return saving;
}

function getSecret() {
  if (process.env.SECRET) return process.env.SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (_) {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = getSecret();

// ---------- Utilitas ----------
function httpError(status, pesan) {
  const e = new Error(pesan);
  e.status = status;
  return e;
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 20 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(httpError(413, 'Data yang dikirim terlalu besar.'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (_) {
        reject(httpError(400, 'Format data tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

function clean(value, max, { multiline = false } = {}) {
  let s = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Pembatas laju sederhana (di memori)
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 10 * 60 * 1000).unref();

// Token admin (HMAC, berlaku 12 jam)
function signToken() {
  const payload = String(Date.now() + 12 * 60 * 60 * 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}
function requireAdmin(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!verifyToken(token)) throw httpError(401, 'Sesi admin berakhir. Masuk lagi.');
}
function samePassword(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Kode tiket, mis. ASP-K7M2QX
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 karakter, tanpa I dan O
function newKode() {
  for (;;) {
    let s = 'ASP-';
    for (const byte of crypto.randomBytes(6)) s += ALPHABET[byte % ALPHABET.length];
    if (!db.some((a) => a.kode === s)) return s;
  }
}

const publicItem = (a) => ({
  judul: a.judul,
  isi: a.isi,
  kategori: a.kategori,
  status: a.status,
  tanggapan: a.tanggapan || '',
  tanggal: a.dibuat,
  ditanggapi: a.ditanggapi || null,
});

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah injeksi rumus di Excel
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const ip = clientIp(req);

  if (p === '/api/info' && method === 'GET') {
    return send(res, 200, { kategori: KATEGORI, status: STATUS });
  }

  if (p === '/api/ringkasan' && method === 'GET') {
    const hitung = { total: db.length };
    for (const s of STATUS) hitung[s] = db.filter((a) => a.status === s).length;
    return send(res, 200, hitung);
  }

  if (p === '/api/publik' && method === 'GET') {
    const halaman = Math.max(1, parseInt(url.searchParams.get('halaman'), 10) || 1);
    const kategori = url.searchParams.get('kategori') || '';
    const perHalaman = 10;
    const daftar = db
      .filter((a) => a.publik && (!kategori || a.kategori === kategori))
      .sort((x, y) => y.dibuat.localeCompare(x.dibuat));
    const items = daftar.slice((halaman - 1) * perHalaman, halaman * perHalaman).map(publicItem);
    return send(res, 200, { items, total: daftar.length, halaman, adaSelanjutnya: halaman * perHalaman < daftar.length });
  }

  if (p === '/api/aspirasi' && method === 'POST') {
    if (limited('kirim:' + ip, 20, 60 * 60 * 1000)) {
      throw httpError(429, 'Terlalu banyak kiriman dari jaringan ini. Coba lagi satu jam lagi.');
    }
    const body = await readJson(req);

    // Kolom jebakan untuk bot: manusia tidak akan mengisinya
    if (body.website) return send(res, 201, { kode: 'ASP-' + crypto.randomBytes(3).toString('hex').toUpperCase() });

    const judul = clean(body.judul, 100);
    const isi = clean(body.isi, 2000, { multiline: true });
    const kategori = clean(body.kategori, 40);
    const anonim = body.anonim === true;
    const nama = anonim ? '' : clean(body.nama, 60);
    const kelas = clean(body.kelas, 20);

    if (!KATEGORI.includes(kategori)) throw httpError(400, 'Pilih kategori aspirasi.');
    if (judul.length < 5) throw httpError(400, 'Judul minimal 5 karakter.');
    if (isi.length < 20) throw httpError(400, 'Isi aspirasi minimal 20 karakter agar mudah ditindaklanjuti.');

    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      kode: newKode(),
      judul, isi, kategori, nama, kelas,
      status: 'Baru',
      tanggapan: '',
      publik: false,
      dibuat: now,
      diperbarui: now,
      ditanggapi: null,
    };
    db.push(item);
    await saveDb();
    return send(res, 201, { kode: item.kode });
  }

  const lacak = p.match(/^\/api\/lacak\/([A-Za-z0-9-]{4,20})$/);
  if (lacak && method === 'GET') {
    if (limited('lacak:' + ip, 60, 10 * 60 * 1000)) throw httpError(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
    const kode = lacak[1].toUpperCase();
    const a = db.find((x) => x.kode === kode);
    if (!a) throw httpError(404, 'Kode tidak ditemukan. Periksa lagi penulisannya.');
    return send(res, 200, { ...publicItem(a), kode: a.kode });
  }

  // ----- Admin -----
  if (p === '/api/admin/login' && method === 'POST') {
    if (!ADMIN_PASSWORD) throw httpError(503, 'Kata sandi admin belum diatur di server.');
    if (limited('login:' + ip, 10, 15 * 60 * 1000)) throw httpError(429, 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.');
    const { password } = await readJson(req);
    if (!password || !samePassword(password)) throw httpError(401, 'Kata sandi salah.');
    return send(res, 200, { token: signToken() });
  }

  if (p === '/api/admin/aspirasi' && method === 'GET') {
    requireAdmin(req);
    const daftar = [...db].sort((x, y) => y.dibuat.localeCompare(x.dibuat));
    return send(res, 200, { items: daftar });
  }

  if (p === '/api/admin/ekspor' && method === 'GET') {
    requireAdmin(req);
    const kolom = ['Kode', 'Tanggal', 'Kategori', 'Judul', 'Isi', 'Nama', 'Kelas', 'Status', 'Tanggapan', 'Tampil publik'];
    const baris = [...db]
      .sort((x, y) => x.dibuat.localeCompare(y.dibuat))
      .map((a) => [a.kode, a.dibuat, a.kategori, a.judul, a.isi, a.nama || 'Anonim', a.kelas, a.status, a.tanggapan, a.publik ? 'Ya' : 'Tidak']);
    const csv = '\uFEFF' + [kolom, ...baris].map((r) => r.map(csvCell).join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="aspirasi.csv"',
      'Cache-Control': 'no-store',
    });
    return res.end(csv);
  }

  const admin = p.match(/^\/api\/admin\/aspirasi\/([0-9a-f-]{36})$/);
  if (admin && method === 'PATCH') {
    requireAdmin(req);
    const a = db.find((x) => x.id === admin[1]);
    if (!a) throw httpError(404, 'Aspirasi tidak ditemukan.');
    const body = await readJson(req);
    if (body.status !== undefined) {
      if (!STATUS.includes(body.status)) throw httpError(400, 'Status tidak valid.');
      a.status = body.status;
    }
    if (body.tanggapan !== undefined) {
      const t = clean(body.tanggapan, 1000, { multiline: true });
      if (t !== a.tanggapan) a.ditanggapi = t ? new Date().toISOString() : null;
      a.tanggapan = t;
    }
    if (body.publik !== undefined) a.publik = body.publik === true;
    a.diperbarui = new Date().toISOString();
    await saveDb();
    return send(res, 200, { item: a });
  }
  if (admin && method === 'DELETE') {
    requireAdmin(req);
    const i = db.findIndex((x) => x.id === admin[1]);
    if (i === -1) throw httpError(404, 'Aspirasi tidak ditemukan.');
    db.splice(i, 1);
    await saveDb();
    return send(res, 200, { ok: true });
  }

  throw httpError(404, 'Alamat API tidak ditemukan.');
}

// ---------- File statis ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Metode tidak diizinkan.');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { throw httpError(400, 'Alamat tidak valid.'); }
  if (rel.includes('\0')) throw httpError(400, 'Alamat tidak valid.');
  if (rel === '/') rel = '/index.html';
  else if (rel === '/admin') rel = '/admin.html';

  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw httpError(403, 'Akses ditolak.');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Halaman tidak ditemukan.');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- Server ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    if (status === 413) res.setHeader('Connection', 'close');
    send(res, status, { pesan: status === 500 ? 'Terjadi kesalahan di server. Coba lagi nanti.' : err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kotak Aspirasi Siswa berjalan di http://localhost:${PORT}`);
  console.log(`Data tersimpan di ${DB_FILE}`);
});

function shutdown() {
  server.close(() => saving.finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
