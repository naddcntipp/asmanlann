(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const STATUS = ['Baru', 'Diproses', 'Selesai', 'Ditolak'];
  const KUNCI = 'aspirasi_admin_token';
  let token = sessionStorage.getItem(KUNCI) || '';
  let semua = [];

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'checked') node.checked = v;
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  const tanggal = (iso) =>
    new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function api(url, options = {}) {
    options.headers = Object.assign({}, options.headers, token ? { Authorization: 'Bearer ' + token } : {});
    let res;
    try {
      res = await fetch(url, options);
    } catch (_) {
      throw new Error('Tidak bisa terhubung ke server.');
    }
    if (res.status === 401 && token) { keluar(); throw new Error('Sesi berakhir. Masuk lagi.'); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.pesan || 'Terjadi kesalahan. Coba lagi.');
    }
    return res;
  }

  function tampilkan(login) {
    $('#login').hidden = !login;
    $('#panel').hidden = login;
  }

  function keluar() {
    token = '';
    sessionStorage.removeItem(KUNCI);
    tampilkan(true);
  }

  // ---------- Login ----------
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.textContent = '';
    try {
      const res = await api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('#password').value }),
      });
      token = (await res.json()).token;
      sessionStorage.setItem(KUNCI, token);
      $('#password').value = '';
      await muat();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  $('#keluar').addEventListener('click', keluar);

  // ---------- Data ----------
  async function muat() {
    const res = await api('/api/admin/aspirasi');
    semua = (await res.json()).items;
    tampilkan(false);
    gambar();
  }

  for (const s of STATUS) $('#f-status').append(el('option', { value: s }, s));
  $('#f-status').addEventListener('change', gambar);
  $('#f-cari').addEventListener('input', gambar);

  function gambar() {
    const st = $('#f-status').value;
    const q = $('#f-cari').value.trim().toLowerCase();
    const daftar = semua.filter((a) =>
      (!st || a.status === st) &&
      (!q || [a.judul, a.isi, a.kode, a.nama].some((t) => (t || '').toLowerCase().includes(q)))
    );
    $('#jumlah').textContent = `${daftar.length} dari ${semua.length} aspirasi`;
    const wadah = $('#daftar-admin');
    wadah.replaceChildren();
    if (!daftar.length) {
      wadah.append(el('p', { class: 'kosong' }, semua.length ? 'Tidak ada aspirasi yang cocok dengan filter.' : 'Belum ada aspirasi masuk.'));
      return;
    }
    for (const a of daftar) wadah.append(kartu(a));
  }

  function kartu(a) {
    const pengirim = a.nama ? a.nama + (a.kelas ? ', ' + a.kelas : '') : 'Anonim' + (a.kelas ? ', ' + a.kelas : '');
    const selStatus = el('select', { id: 'st-' + a.id });
    for (const s of STATUS) selStatus.append(el('option', { value: s }, s));
    selStatus.value = a.status;
    const tanggapan = el('textarea', { id: 'tg-' + a.id, rows: '3', maxlength: '1000', placeholder: 'Tulis tanggapan untuk siswa' });
    tanggapan.value = a.tanggapan || '';
    const publik = el('input', { id: 'pb-' + a.id, type: 'checkbox' });
    publik.checked = !!a.publik;
    const info = el('span', { class: 'info', role: 'status' });

    const simpan = el('button', { class: 'btn btn-small', type: 'button' }, 'Simpan perubahan');
    simpan.addEventListener('click', async () => {
      simpan.disabled = true;
      info.textContent = '';
      try {
        const res = await api('/api/admin/aspirasi/' + a.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: selStatus.value, tanggapan: tanggapan.value, publik: publik.checked }),
        });
        const baru = (await res.json()).item;
        Object.assign(a, baru);
        info.textContent = 'Tersimpan.';
      } catch (ex) {
        info.textContent = ex.message;
      } finally {
        simpan.disabled = false;
      }
    });

    const hapus = el('button', { class: 'btn btn-bahaya btn-small', type: 'button' }, 'Hapus');
    hapus.addEventListener('click', async () => {
      if (!confirm(`Hapus aspirasi "${a.judul}"? Tindakan ini tidak bisa dibatalkan.`)) return;
      try {
        await api('/api/admin/aspirasi/' + a.id, { method: 'DELETE' });
        semua = semua.filter((x) => x.id !== a.id);
        gambar();
      } catch (ex) {
        info.textContent = ex.message;
      }
    });

    return el('article', { class: 'a-item' },
      el('div', { class: 'a-meta' },
        el('span', { class: 'kode-kecil' }, a.kode),
        el('span', {}, tanggal(a.dibuat)),
        el('span', {}, a.kategori),
        el('span', {}, pengirim)
      ),
      el('h3', {}, a.judul),
      el('p', { class: 'a-isi' }, a.isi),
      el('div', { class: 'a-kontrol' },
        el('div', { class: 'field' }, el('label', { for: 'st-' + a.id }, 'Status'), selStatus),
        el('div', { class: 'field' }, el('label', { for: 'tg-' + a.id }, 'Tanggapan'), tanggapan),
        el('label', { class: 'check lebar', for: 'pb-' + a.id }, publik, el('span', {}, 'Tampilkan di halaman Transparansi')),
        el('div', { class: 'a-tombol' }, simpan, hapus, info)
      )
    );
  }

  // ---------- Ekspor ----------
  $('#ekspor').addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/ekspor');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'aspirasi.csv' });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (ex) {
      alert(ex.message);
    }
  });

  // ---------- Mulai ----------
  if (token) muat().catch(() => tampilkan(true));
  else tampilkan(true);
})();
