# BEBAS Guild · Party Manager

Website pengatur party guild Ragnarok untuk **Guild League**, **Polarity Zone**, dan **Siege**.

🌐 **Website:** https://kostelegante.github.io/GUILD-BEBAS-/

## Fitur
- Login dengan Discord atau Google
- Roster member dari export game (import CSV/Excel, deteksi ganti nama)
- Papan party tetap untuk Guild League (Main 12 + Sub 18) dan Polarity Zone (STAR + Normal Dungeon 1–4)
- Party Fix: grup teman yang selalu masuk party bersama
- Drag & drop karakter ke party
- Konfirmasi war → kehadiran tercatat otomatis, statistik partisipasi per member

## Struktur
- `index.html` — website siap pakai (satu file, ini yang dibuka GitHub Pages)
- `app/` — kode sumber (React + Vite) dan skema database Supabase (`app/supabase/*.sql`)

Data member, party, dan kehadiran tersimpan di Supabase, bukan di repository ini.
