# V64 — Unified Chunked Persistence

V64 mengganti bulk upload satu-RPC V63 dengan mekanisme chunk universal untuk semua dataset besar di `operational_records`.

## Kenapa
Upload Quality sekitar 8.844 record dapat terkena `canceling statement due to statement timeout` jika seluruh JSON dikirim dan diproses dalam satu statement.

## Cara kerja
- Semua module memakai engine yang sama: `production`, `initial_stock`, `ntm_waste`, `quality_incoming`, `quality_giling`.
- Browser mengirim 250 record per chunk (dengan concurrency terbatas).
- Record upload lama belum dihapus selama chunk masih berjalan.
- Setelah seluruh chunk sukses, `finalize_operational_upload_v64` membersihkan record upload lama yang tidak ada di batch baru.
- Input manual pada key yang sama dipertahankan.
- Verifikasi jumlah dilakukan di server sebelum UI menampilkan status sukses.

## Instalasi
1. Jalankan `FIX-V64-UNIFIED-CHUNKED-PERSISTENCE.sql` di Supabase SQL Editor.
2. Replace `dashboard.html` dan `supabase-api.js` dengan file V64.
3. Deploy GitHub Pages.
4. Hard refresh dan cek meta version = `64`.
5. Upload ulang database yang sebelumnya gagal.
