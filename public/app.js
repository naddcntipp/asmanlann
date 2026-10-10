(function () {
  'use strict';

  const cfg = Object.assign({ nama: 'Nama Sekolah' }, window.SEKOLAH || {});
  const $ = (sel) => document.querySelector(sel);

  // Pembantu membuat elemen. Teks selalu dimasukkan sebagai teks biasa (aman dari XSS).
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  const tanggal = (iso) =>
    new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  async function api(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (_) {
      throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internetmu.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.pesan || 'Terjadi kesalahan. Coba lagi.');
    return data;
  }

  const pill = (status) => el('span', { class: 'pill s-' + status }, status);

  // ---------- Identitas sekolah ----------
  document.querySelectorAll('[data-sekolah]').forEach((n) => (n.textContent = cfg.nama));
  document.querySelectorAll('[data-sekolah-singkat]').forEach((n) => (n.textContent = cfg.singkatan || cfg.nama));
  document.title = 'Kotak Aspirasi Siswa - ' + cfg.nama;

  // ---------- Info kategori ----------
  api('/api/info').then((info) => {
    for (const k of info.kategori) {
      $('#kategori').append(el('option', { value: k }, k));
      $('#filter-kategori').append(el('option', { value: k }, k));
    }
  }).catch(() => {});

  // ---------- Ringkasan ----------
  const WARNA = ['Baru', 'Diproses', 'Selesai', 'Ditolak'];
  async function muatRingkasan() {
    try {
      const r = await api('/api/ringkasan');
      const heroCount = $('#hero-count');
      heroCount.textContent = r.total
        ? `${r.total} aspirasi sudah masuk, ${r.Selesai} di antaranya selesai ditangani.`
        : 'Belum ada aspirasi masuk. Jadilah yang pertama.';
      if (!r.total) return;

      const bar = $('#bar');
      const legenda = $('#legenda');
      bar.replaceChildren();
      legenda.replaceChildren();
      for (const s of WARNA) {
        if (r[s]) {
          const seg = el('span', { class: 'd-' + s });
          seg.style.width = (r[s] / r.total) * 100 + '%';
          bar.append(seg);
        }
        legenda.append(el('li', {}, el('i', { class: 'd-' + s }), el('span', {}, s), el('b', {}, String(r[s]))));
      }
      $('#ringkasan').hidden = false;
    } catch (_) { /* biarkan kosong */ }
  }

  // ---------- Daftar transparansi ----------
  let halaman = 1;
  async function muatDaftar(reset) {
    if (reset) { halaman = 1; $('#daftar').replaceChildren(); }
    const tombol = $('#muat-lagi');
    try {
      const kat = encodeURIComponent($('#filter-kategori').value);
      const data = await api(`/api/publik?halaman=${halaman}&kategori=${kat}`);
      for (const a of data.items) {
        const li = el('li', { class: 'item' },
          el('div', { class: 'item-meta' }, pill(a.status), el('span', {}, a.kategori), el('span', {}, tanggal(a.tanggal))),
          el('h3', {}, a.judul),
          el('p', {}, a.isi)
        );
        if (a.tanggapan) {
          li.append(el('div', { class: 'tanggapan' }, el('strong', {}, 'Tanggapan sekolah'), el('p', {}, a.tanggapan)));
        }
        $('#daftar').append(li);
      }
      $('#kosong').textContent = 'Belum ada aspirasi yang dipublikasikan. Kirim yang pertama.';
      $('#kosong').hidden = data.total > 0;
      tombol.hidden = !data.adaSelanjutnya;
    } catch (err) {
      $('#kosong').textContent = err.message;
      $('#kosong').hidden = false;
    }
  }
  $('#muat-lagi').addEventListener('click', () => { halaman += 1; muatDaftar(false); });
  $('#filter-kategori').addEventListener('change', () => muatDaftar(true));

  // ---------- Form kirim ----------
  const form = $('#form-aspirasi');
  const errBox = $('#form-error');
  $('#isi').addEventListener('input', (e) => { $('#isi-hitung').textContent = e.target.value.length; });
  $('#anonim').addEventListener('change', (e) => {
    $('#nama').disabled = e.target.checked;
    if (e.target.checked) $('#nama').value = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';
    const d = {
      kategori: $('#kategori').value,
      judul: $('#judul').value.trim(),
      isi: $('#isi').value.trim(),
      nama: $('#nama').value.trim(),
      kelas: $('#kelas').value.trim(),
      anonim: $('#anonim').checked,
      website: $('#website').value,
    };
    if (!d.kategori) { errBox.textContent = 'Pilih kategori aspirasi.'; $('#kategori').focus(); return; }
    if (d.judul.length < 5) { errBox.textContent = 'Judul minimal 5 karakter.'; $('#judul').focus(); return; }
    if (d.isi.length < 20) { errBox.textContent = 'Isi aspirasi minimal 20 karakter agar mudah ditindaklanjuti.'; $('#isi').focus(); return; }

    const tombol = $('#tombol-kirim');
    tombol.disabled = true;
    tombol.textContent = 'Mengirim...';
    try {
      const r = await api('/api/aspirasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      form.reset();
      $('#isi-hitung').textContent = '0';
      $('#nama').disabled = false;
      $('#kartu-form').hidden = true;
      $('#kartu-sukses').hidden = false;
      $('#kode-hasil').textContent = r.kode;
      $('#salin-info').textContent = '';
      $('#kode-hasil').focus();
      $('#kartu-sukses').scrollIntoView({ block: 'center' });
      muatRingkasan();
    } catch (err) {
      errBox.textContent = err.message;
    } finally {
      tombol.disabled = false;
      tombol.textContent = 'Kirim aspirasi';
    }
  });

  $('#kirim-lagi').addEventListener('click', () => {
    $('#kartu-sukses').hidden = true;
    $('#kartu-form').hidden = false;
    $('#kategori').focus();
  });

  $('#salin-kode').addEventListener('click', async () => {
    const kode = $('#kode-hasil').textContent;
    try {
      await navigator.clipboard.writeText(kode);
      $('#salin-info').textContent = 'Kode disalin.';
    } catch (_) {
      const range = document.createRange();
      range.selectNodeContents($('#kode-hasil'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      $('#salin-info').textContent = 'Kode terpilih. Tekan lama lalu pilih Salin.';
    }
  });

  // ---------- Lacak ----------
  $('#form-lacak').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#lacak-error');
    const hasil = $('#hasil-lacak');
    err.textContent = '';
    hasil.replaceChildren();
    const kode = $('#kode').value.trim().toUpperCase();
    if (kode.length < 4) { err.textContent = 'Masukkan kode aspirasi, contoh ASP-K7M2QX.'; $('#kode').focus(); return; }
    try {
      const a = await api('/api/lacak/' + encodeURIComponent(kode));
      hasil.append(
        el('div', { class: 'item-meta' }, pill(a.status), el('span', {}, a.kategori), el('span', {}, tanggal(a.tanggal))),
        el('h3', {}, a.judul),
        a.tanggapan
          ? el('div', { class: 'tanggapan' }, el('strong', {}, 'Tanggapan sekolah'), el('p', {}, a.tanggapan))
          : el('p', {}, 'Belum ada tanggapan. Cek lagi nanti.')
      );
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  // ---------- Mulai ----------
  muatRingkasan();
  muatDaftar(true);
})();
