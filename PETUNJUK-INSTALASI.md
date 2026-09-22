# PETUNJUK INSTALASI LENGKAP

## A. Buat / siapkan project Supabase

1. Login ke Supabase dan buka project yang akan dipakai.
2. Buka **SQL Editor** → **New query**.
3. Buka file `supabase-setup.sql` dari paket ini.
4. Copy seluruh isinya ke SQL Editor lalu **Run**.
5. Pastikan tidak ada error.

SQL tersebut membuat:
- `public.profiles` untuk nama + role (`admin` / `viewer`)
- `public.dashboard_state` untuk data dashboard bersama
- trigger profile otomatis
- Row Level Security (RLS): semua user login boleh baca; hanya Admin boleh menulis

---

## B. Buat akun Admin dan Viewer di Supabase

Buka **Authentication → Users**.

Buat user memakai email + password, contoh:

```text
admin.perusahaan@example.com
viewer1.perusahaan@example.com
viewer2.perusahaan@example.com
```

User baru otomatis mendapat role `viewer`.

### Jadikan akun tertentu sebagai Admin

Setelah user Admin dibuat, buka **SQL Editor**, lalu jalankan:

```sql
update public.profiles
set role='admin', name='Admin', updated_at=now()
where id=(select id from auth.users where email='admin.perusahaan@example.com');
```

Ganti email tersebut dengan email Admin sebenarnya.

### Memberi nama Viewer (opsional)

```sql
update public.profiles
set name='Budi - Viewer', updated_at=now()
where id=(select id from auth.users where email='viewer1.perusahaan@example.com');
```

Viewer tidak perlu diubah role-nya karena default sudah `viewer`.

---

## C. Ambil Project URL + Publishable Key

Di Supabase, buka halaman API/Connect project dan ambil:

1. **Project URL** — bentuknya seperti `https://xxxx.supabase.co`
2. **Publishable Key** — key untuk frontend/browser

Buka `supabase-config.js` dan ganti:

```js
window.NCT_SUPABASE_CONFIG = {
  url: 'PASTE_SUPABASE_PROJECT_URL_HERE',
  publishableKey: 'PASTE_SUPABASE_PUBLISHABLE_KEY_HERE'
};
```

menjadi misalnya:

```js
window.NCT_SUPABASE_CONFIG = {
  url: 'https://abcd1234.supabase.co',
  publishableKey: 'sb_publishable_xxxxxxxxxxxxx'
};
```

**Jangan** memasukkan `service_role`, Secret Key, database password, atau token pribadi.

---

## D. Upload file ke GitHub

Buat satu repository GitHub atau gunakan repository yang sudah ada.

Upload file berikut ke **root** repository (jangan dimasukkan ke subfolder):

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

Struktur akhirnya:

```text
repository/
├── .nojekyll
├── index.html
├── dashboard.html
├── supabase-config.js
├── supabase-api.js
├── supabase-setup.sql
├── PETUNJUK-INSTALASI.md
└── README.md
```

---

## E. Aktifkan GitHub Pages

Di repository GitHub:

1. **Settings**
2. **Pages**
3. **Build and deployment**
4. Source: **Deploy from a branch**
5. Branch: **main**
6. Folder: **/(root)**
7. **Save**

Tunggu beberapa menit sampai GitHub memberi URL, biasanya:

```text
https://USERNAME.github.io/NAMA-REPOSITORY/
```

`index.html` akan otomatis menjadi halaman login.

---

## F. Tes koneksi

### Tes 1 — Admin

1. Buka URL GitHub Pages.
2. Login dengan email/password Admin.
3. Dashboard harus terbuka.
4. Coba input/edit data.
5. Di kanan atas akan terlihat badge `ADMIN` dan status sync `TERSIMPAN`.

### Tes 2 — Viewer

1. Logout Admin.
2. Login dengan akun Viewer.
3. Dashboard harus terbuka.
4. Viewer bisa melihat/filter data.
5. Tombol input/edit/hapus/upload tidak tersedia.
6. Jika Viewer mencoba menulis lewat API secara manual, RLS Supabase akan menolak.

### Tes 3 — Data lintas perangkat

1. Admin input data dari laptop A.
2. Tunggu badge kembali menjadi `TERSIMPAN`.
3. Di laptop B login sebagai Viewer.
4. Refresh dashboard / klik badge `SYNC`.
5. Data yang dimasukkan Admin harus terlihat di laptop B.

---

## G. Jika Admin punya data lama di browser

Saat `dashboard_state` masih kosong, **Admin pertama yang login** akan otomatis mengisi Supabase menggunakan data dashboard yang sudah ada di browser Admin tersebut.

Karena itu, jika ada data lama penting di browser/laptop tertentu:

1. Jalankan setup Supabase.
2. Login pertama kali sebagai Admin dari browser/laptop yang berisi data lama tersebut.
3. Setelah dashboard terbuka, cek tabel `dashboard_state` di Supabase Table Editor.

Jika database Supabase sudah berisi snapshot, data Supabase menjadi sumber utama dan akan dimuat ke browser saat dashboard dibuka.

---

## H. Troubleshooting

### Login berhasil tetapi kembali ke login
Cek tabel `profiles`. Pastikan user memiliki row dengan role `admin` atau `viewer`.

### Muncul "Dashboard belum dapat terhubung ke Supabase"
Cek:
- `supabase-config.js` sudah diisi
- `supabase-setup.sql` sudah dijalankan
- Project Supabase aktif
- internet/CDN tidak diblokir

### Viewer tidak melihat data terbaru
Refresh browser atau klik badge `SYNC` di kanan atas dashboard.

### Admin mendapat "permission denied" / RLS error saat menyimpan
Pastikan profile Admin benar:

```sql
select u.email,p.role,p.name
from auth.users u
join public.profiles p on p.id=u.id;
```

Role Admin harus persis `admin`.

### GitHub Pages menampilkan 404
Pastikan `index.html` berada di root branch yang dipilih di Settings → Pages.

---

## I. Keamanan

- Website GitHub Pages adalah frontend statis dan file HTML/JS dapat dilihat publik.
- Password user **tidak** ada di HTML; password ditangani Supabase Auth.
- Publishable Key boleh digunakan di browser, tetapi keamanan database tetap harus bergantung pada RLS.
- Jangan pernah menaruh Supabase Secret Key / `service_role` di GitHub.
