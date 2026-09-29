# V62 — Database 01 Giling & Gunting

V62 memperbaiki upload Database 01 yang sebelumnya mengirim satu RPC untuk setiap record Excel. Untuk file sekitar 1.000 record, jalur lama dapat menghasilkan ratusan request dan gagal sebelum data benar-benar tersimpan.

V62 memakai satu RPC atomik `replace_production_upload` dan sesudahnya client membaca ulang module `production` untuk memverifikasi bahwa semua key file memang ada di Supabase. Dashboard tidak lagi menampilkan upload sebagai sukses bila verifikasi server gagal.

## Instalasi
1. Supabase → SQL Editor → jalankan `FIX-V62-PRODUCTION-UPLOAD.sql` sekali.
2. Upload/replace `dashboard.html` dan `supabase-api.js` dari paket V62 ke GitHub.
3. Tunggu GitHub Pages deploy, tutup semua tab dashboard, buka lagi dan hard refresh.
4. Console: `document.querySelector('meta[name="nct-dashboard-version"]')?.content` harus menghasilkan `62`.
5. Upload kembali Database 01 sekali.
6. Verifikasi Supabase:

```sql
select module,count(*)
from public.operational_records
where module='production'
group by module;
```

Jumlah harus > 0 dan tetap ada setelah refresh/logout/login.
