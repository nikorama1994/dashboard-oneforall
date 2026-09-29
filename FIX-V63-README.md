# V63 — Unified Persistence (semua database upload)

V63 mengganti pola perbaikan per-modul menjadi satu arsitektur persistensi untuk seluruh database upload.

## Database 01 — Giling & Gunting
- hasil Excel disimpan atomik ke `operational_records` module `production`;
- server dibaca ulang setelah commit;
- UI hanya menyatakan sukses bila semua key file ditemukan kembali di Supabase.

## Database 02 — Contong
- Produksi Packaging, RAW, dan NTM tetap memakai `dashboard_state` + chunk;
- sesudah setiap replace, V63 membaca ulang seluruh snapshot dari Supabase dan membandingkannya dengan cache browser;
- jika berbeda, upload dianggap gagal (tidak ada lagi sukses palsu).

## Database 03 — Quality Giling & Gunting
- memakai RPC atomik yang sama dengan Database 01;
- tidak lagi menyimpan ribuan sampling dengan POST per-record;
- server dibaca ulang sebelum status sukses.

## Operational upload lain ke depan
RPC `replace_operational_upload_v63` mendukung:
- `production`
- `initial_stock`
- `ntm_waste`
- `quality_incoming`
- `quality_giling`

Jadi modul bulk baru yang memakai `operational_records` dapat memakai jalur yang sama, bukan membuat RPC baru satu per satu.

## Instalasi
1. Jalankan `FIX-V63-UNIFIED-PERSISTENCE.sql` sekali di Supabase SQL Editor.
2. Replace seluruh isi repository GitHub dengan isi ZIP V63 (disarankan), atau minimal `dashboard.html` + `supabase-api.js`.
3. Tunggu GitHub Pages deploy.
4. Tutup semua tab dashboard, buka ulang, lalu hard refresh.
5. Console version harus `63`.

## Setelah V63
Upload setiap file database satu kali agar snapshot server terbaru terbentuk. Sesudah itu refresh/logout/login harus membaca data dari cache cepat dan memvalidasi update terhadap Supabase di background.
