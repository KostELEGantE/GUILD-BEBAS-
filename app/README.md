# Guild Party Manager — Ragnarok

Web app untuk mengatur party **Guild League**, **Polarity Zone**, dan **Siege**:

- **Roster**: data member dari export game. Member mengklaim karakternya sendiri dan bisa mengubah role (Tank/Healer/Support/DPS).
- **Event & Party**: admin membuat event, lalu member memilih sendiri slot party yang kosong. Admin bisa mengisi, memindahkan, mengeluarkan member, dan mengunci party. Perubahan langsung terlihat oleh semua orang (realtime). Tombol **Salin untuk Discord** menyalin susunan party.
- **Kehadiran**: setelah event selesai, admin meng-import daftar peserta dari hasil game (Excel/CSV, atau tempel nama). Nama yang ada di daftar = hadir. Yang mendaftar party tapi tidak ada di daftar = tidak hadir (no-show). Halaman *Kehadiran* menampilkan persentase per member dan bisa di-export ke Excel.
- **Admin**: import/update member dari file export game (`.csv` / `.xlsx`) dengan preview perubahan, riwayat import, dan pengaturan siapa saja yang menjadi admin.

Teknologi: React + Vite (frontend) dan Supabase (database, login, realtime). Paket gratis keduanya sudah cukup.

---

## 1. Menjalankan di PC (Windows)

1. Install **Node.js LTS** dari <https://nodejs.org>.
2. Buka folder ini di terminal (klik kanan di folder → *Open in Terminal*), lalu jalankan:
   ```
   npm install
   npm run dev
   ```
3. Buka <http://localhost:3000>.

Alamat project Supabase **ragnarok-guild** sudah tertanam di `src/lib/supabase.js`. Untuk memakai project lain, salin `.env.example` menjadi `.env` lalu isi nilainya.

## 2. Pasang skema database (sekali saja)

Jika belum terpasang: buka Supabase → project **ragnarok-guild** → **SQL Editor** → *New query*. Salin seluruh isi `supabase/schema.sql`, lalu klik **Run**.

## 3. Login

### Untuk tes cepat: email
Di halaman login, klik *"Masuk pakai email"*. Link login akan dikirim ke email Anda.
(Supabase gratis membatasi email beberapa kali per jam. Untuk pemakaian guild, gunakan Discord.)

### Login Discord (untuk member)
1. Buka <https://discord.com/developers/applications>, klik **New Application** (mis. "Guild Party").
2. Di menu **OAuth2**, salin **Client ID**, lalu klik **Reset Secret** dan salin **Client Secret**.
3. Masih di **OAuth2 → Redirects**, tambahkan:
   `https://fzjnccdbqzvrboplaqnn.supabase.co/auth/v1/callback`
4. Di Supabase → **Authentication → Sign In / Providers → Discord**: aktifkan, tempel Client ID dan Secret, lalu **Save**.
5. Di Supabase → **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (nanti ganti ke alamat website setelah deploy)
   - Redirect URLs: tambahkan `http://localhost:3000/**`

## 4. Langkah pertama setelah login

1. Akun yang pertama login akan melihat tombol **"Jadikan saya admin"**. Klik tombol itu (hanya berfungsi selama belum ada admin).
2. Buka **Admin**, upload file export member dari game (contoh: `BEBAS_xxxx.csv`), cek preview, lalu klik **Import**.
3. Buka **Roster**, lalu klik **Klaim** pada karakter Anda.
4. Buka **Event & Party**, klik **+ Buat event**, dan bagikan link-nya ke member.

### Update data member
Upload file export terbaru di halaman **Admin**. Member dicocokkan berdasarkan nama karakter. Data level, GS, kontribusi, dan lainnya akan diperbarui, sedangkan klaim akun dan role tetap. Centang *"Tandai sebagai tidak aktif"* untuk menonaktifkan member yang sudah keluar guild.

> Kalau ada member yang mengganti nama karakter di game, nama baru akan dianggap member baru. Klaim ulang karakter baru tersebut, lalu nonaktifkan yang lama.

### Cek kehadiran
Setelah event selesai, buka event tersebut → tab **Kehadiran** → upload file atau tempel daftar nama peserta dari hasil game. Status **Izin** bisa diatur manual per member dan tidak akan ditimpa oleh import berikutnya.

## 5. Deploy (nanti)

1. Upload folder ini ke GitHub. File `.env` tidak ikut karena sudah ada di `.gitignore`.
2. Di <https://vercel.com>, pilih **Import Project** dari GitHub. Framework: Vite.
3. Tambahkan Environment Variables `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` (isinya sama dengan `.env`).
4. Setelah online, ubah **Site URL** di Supabase dan tambahkan `https://namasitus.vercel.app/**` ke Redirect URLs.

## Struktur

```
supabase/schema.sql      tabel, keamanan (RLS), dan fungsi database
src/pages/               Events, EventDetail, Attendance, Roster, Stats, Admin, Login
src/lib/sheet.js         baca Excel/CSV + pemetaan kolom export game
src/lib/util.js          mode event, role, format angka/tanggal
```

Role default dari class: Lord Knight/Paladin = Tank, High Priest = Healer, Clown/Gypsy/Scholar = Support, lainnya = DPS. Aturan ini bisa diubah di fungsi `default_role` pada `schema.sql`, dan member juga bisa mengubah role-nya sendiri.
