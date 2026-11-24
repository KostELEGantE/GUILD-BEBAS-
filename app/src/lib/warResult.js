// Baca tabel hasil war dari game (disalin / file .txt / .csv), kolom dipisah tab, titik koma, atau koma.
// Header contoh: Guild  Player  Job  Kill  Assist  Player Damage  Building Damage  Heal  Endure  Deaths  Revive  Monster  Flag Repair  Boss Kill  Boss Damage
const COLS = {
  guild: ['guild'],
  name: ['player', 'name', 'nama', 'ign'],
  job: ['job', 'class'],
  kills: ['kill', 'kills'],
  assists: ['assist', 'assists'],
  player_dmg: ['player damage', 'playerdamage', 'damage'],
  building_dmg: ['building damage', 'buildingdamage'],
  heal: ['heal', 'healing'],
  endure: ['endure'],
  deaths: ['deaths', 'death'],
  revives: ['revive', 'revives'],
  monsters: ['monster', 'monsters'],
  flag_repair: ['flag repair', 'flagrepair'],
  boss_kills: ['boss kill', 'bosskill'],
  boss_dmg: ['boss damage', 'bossdamage'],
}
const NUM = Object.keys(COLS).filter((k) => !['guild', 'name', 'job'].includes(k))

export function parseWarResult(text) {
  const lines = String(text || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (!lines.length) return { rows: [], guilds: [], error: 'Kosong' }
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase())
  const idx = {}
  for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h))
  if (idx.name < 0) return { rows: [], guilds: [], error: 'Kolom "Player" tidak ditemukan di baris pertama' }
  const rows = lines.slice(1).map((l) => {
    const c = l.split(sep)
    const r = { guild: idx.guild >= 0 ? (c[idx.guild] || '').trim() : '', name: (c[idx.name] || '').trim(), job: idx.job >= 0 ? (c[idx.job] || '').trim() : '' }
    for (const k of NUM) r[k] = idx[k] >= 0 ? Number(String(c[idx[k]] || '0').replace(/[^\d-]/g, '')) || 0 : 0
    return r
  }).filter((r) => r.name)
  const count = {}
  for (const r of rows) count[r.guild] = (count[r.guild] || 0) + 1
  const guilds = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([g, n]) => ({ guild: g, n }))
  return { rows, guilds, hasBuilding: rows.some((r) => r.building_dmg > 0) }
}

// Kolom yang dihitung sebagai aktivitas (Endure & Deaths tidak)
export const ACT_KEYS = ['kills', 'assists', 'player_dmg', 'building_dmg', 'heal', 'revives', 'boss_dmg', 'monsters', 'flag_repair']
/** Aktivitas nol (masuk peta tapi tidak melakukan apa-apa) */
export const isIdle = (s) => ACT_KEYS.every((k) => !s[k])
/** Batas AFK: di bawah 25% rata-rata guild di semua kategori (skor 0 = tidak melakukan apa-apa) */
export const LOW_SCORE = 0.25

/** Rata-rata guild kita per kolom, untuk satu peta */
export function mapAverages(rows) {
  const avg = {}
  for (const k of ACT_KEYS) avg[k] = rows.length ? rows.reduce((t, r) => t + (r[k] || 0), 0) / rows.length : 0
  return avg
}
/** Skor = kategori terbaik pemain dibanding rata-rata guild (1 = sama dengan rata-rata). Healer dinilai dari heal, DPS dari damage, dst. */
export function activityScore(r, avg) {
  let best = 0
  for (const k of ACT_KEYS) if (avg[k] > 0) best = Math.max(best, (r[k] || 0) / avg[k])
  return best
}
/** Ringkasan musuh di satu peta: guild lain dengan pemain terbanyak */
export function enemySummary(rows, ourGuild) {
  const others = rows.filter((r) => r.guild !== ourGuild)
  const count = {}
  for (const r of others) count[r.guild] = (count[r.guild] || 0) + 1
  const enemy = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const E = others.filter((r) => r.guild === enemy)
  return {
    our_guild: ourGuild,
    enemy_guild: enemy,
    our_players: rows.filter((r) => r.guild === ourGuild).length,
    enemy_players: E.length,
    enemy_active: E.filter((r) => r.kills || r.assists || r.player_dmg || r.building_dmg || r.heal).length,
    enemy_kills: E.reduce((t, r) => t + r.kills, 0),
    enemy_dmg: E.reduce((t, r) => t + r.player_dmg, 0),
  }
}

/** Tebak peta dari isi tabel: ada Building Damage = Main; ada Flag Repair (tanpa Building Damage) = Sub */
export function detectMap(parsed) {
  const rows = parsed?.rows || []
  if (!rows.length) return null
  const bld = rows.some((r) => r.building_dmg > 0)
  const flag = rows.some((r) => r.flag_repair > 0)
  if (bld && !flag) return 'main'
  if (flag && !bld) return 'sub'
  if (!bld) return 'sub'
  return null
}
