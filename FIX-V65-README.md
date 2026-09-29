# V65 — Login Hydration / Zero Data Fix

Perbaikan umum untuk semua dataset `operational_records` setelah logout/login.

## Akar masalah
Snapshot IndexedDB kosong (`[]`) dari sesi lama bisa dianggap sebagai cache valid. UI lalu langsung menampilkan `0 DATA` walaupun Supabase sebenarnya sudah memiliki record, dan full hydration hanya berjalan di background.

## Perbaikan
- Cache kosong tidak lagi dipercaya begitu saja.
- Untuk cache kosong, aplikasi melakukan fingerprint kecil ke Supabase (count + updated_at).
- Jika server punya record, hydration penuh ditunggu sebelum module dianggap selesai dimuat.
- Halaman Database menampilkan jumlah record server saat cache lokal belum selesai, dengan status `sedang dimuat ke dashboard`, bukan menyesatkan sebagai `0 DATA`.
- Berlaku umum untuk `production`, `initial_stock`, `ntm_waste`, `quality_incoming`, dan `quality_giling`.

Tidak ada SQL baru untuk V65. Backend chunk V64 tetap digunakan.
