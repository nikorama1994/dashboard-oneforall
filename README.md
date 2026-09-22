# Dashboard Produksi Giling — GitHub Pages + Supabase

Paket ini sudah disiapkan untuk alur:

**GitHub Pages (frontend) → Supabase Auth → role Admin/Viewer → Supabase Database**

## File yang harus di-upload ke root repository GitHub

```text
.nojekyll
index.html
dashboard.html
supabase-config.js
supabase-api.js
supabase-setup.sql
PETUNJUK-INSTALASI.md
README.md
```

`index.html` adalah halaman login. `dashboard.html` adalah dashboard utama.

## Hak akses

- **Admin**: lihat + input + edit + hapus + upload/import data.
- **Viewer**: lihat dashboard/filter/riwayat saja. Operasi tulis diblokir di UI dan juga oleh Supabase Row Level Security (RLS).

## Penyimpanan data

Dashboard asli memakai `localStorage`. Paket ini mempertahankan mekanisme internal tersebut agar fitur dashboard tidak rusak, lalu menyinkronkan tiga key data utama ke satu row JSON di `public.dashboard_state`:

- `giling_dashboard_2026_v4_clean`
- `giling_initial_stocks_v2`
- `ntm_waste_2026_v2`

Saat Admin mengubah data, snapshot otomatis dikirim ke Supabase. Saat user membuka/refresh dashboard, data terbaru diambil dari Supabase terlebih dahulu.

> Catatan: model snapshot ini cocok untuk satu Admin aktif pada satu waktu. Jika banyak Admin mengedit bersamaan, perubahan terakhir yang tersimpan akan menjadi versi terbaru.

## Jangan upload Secret Key

Hanya masukkan **Project URL** dan **Publishable Key** ke `supabase-config.js`. Jangan pernah memasukkan `service_role`, secret key, database password, atau token pribadi ke GitHub.

Baca `PETUNJUK-INSTALASI.md` untuk langkah lengkap.
