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

// Kolom yang dihitung sebagai aktivitas (Endure = damage diterima, untuk tank/job yang tidak memukul; Deaths tidak)
export const ACT_KEYS = ['kills', 'assists', 'player_dmg', 'building_dmg', 'heal', 'endure', 'revives', 'boss_dmg', 'monsters', 'flag_repair']
/** Aktivitas nol (masuk peta tapi tidak melakukan apa-apa) */
export const isIdle = (s) => ACT_KEYS.every((k) => !s[k])
/** Batas AFK: di bawah 25% rata-rata guild di semua kategori (skor 0 = tidak melakukan apa-apa) */
export const LOW_SCORE = 0.25

/** Job support penyembuh: dinilai HANYA dari Heal & Revive, dibanding sesama priest di peta yang sama */
export const HEALER_JOBS = ['High Priest', 'Priest', 'Acolyte', 'Arch Bishop', 'Cardinal']
export const HEALER_KEYS = ['heal', 'revives']
export const isHealer = (job) => HEALER_JOBS.some((j) => (job || '').toLowerCase() === j.toLowerCase())

const avgOf = (rows, keys) => {
  const avg = {}
  for (const k of keys) avg[k] = rows.length ? rows.reduce((t, r) => t + (r[k] || 0), 0) / rows.length : 0
  return avg
}
/**
 * Peran ditentukan OTOMATIS dari angka hasil war tiap pemain (bukan dari job),
 * karena Creator/Whitesmith dsb. bisa DPS atau support tergantung build.
 * - Priest (job penyembuh) selalu Healer.
 * - Lainnya: peran = profil yang paling menonjol dibanding rata-rata pemain di peta itu.
 */
export const ROLE_DETECT = { dps: ['kills', 'player_dmg', 'building_dmg'], tank: ['endure'], support: ['assists', 'boss_dmg', 'monsters', 'flag_repair'] }
/** Kategori yang dinilai untuk tiap peran, dibanding sesama peran di peta yang sama */
export const ROLE_KEYS = {
  dps: ['kills', 'player_dmg', 'building_dmg'],
  tank: ['endure', 'assists'],
  support: ['assists', 'boss_dmg', 'monsters', 'flag_repair'],
  healer: ['heal', 'revives'],
}
export const ROLE_LABEL = { dps: 'DPS', tank: 'Tank', support: 'Support', healer: 'Healer' }
/** Peran perlu minimal sekian pemain di peta itu supaya dibanding sesamanya; kalau kurang, dibanding semua pemain */
const MIN_PEERS = 3
const keyName = (r) => (r.name || '').toLowerCase()

/** Rata-rata hanya dari pemain yang angkanya > 0 (supaya kategori jarang seperti Boss Damage tidak melonjak) */
const activeAvgOf = (rows, keys) => {
  const avg = {}
  for (const k of keys) {
    const xs = rows.map((r) => r[k] || 0).filter((x) => x > 0)
    avg[k] = xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0
  }
  return avg
}

export function detectRole(r, activeAvg) {
  if (isHealer(r.job)) return 'healer'
  let best = null
  let bestV = 0
  for (const [role, keys] of Object.entries(ROLE_DETECT))
    for (const k of keys) {
      const v = activeAvg[k] > 0 ? (r[k] || 0) / activeAvg[k] : 0
      if (v > bestV) [best, bestV] = [role, v]
    }
  return best || 'dps' // semua 0 (AFK): peran tidak penting, skornya tetap 0
}

/** Rata-rata satu peta: rata-rata semua pemain + peran otomatis tiap pemain + rata-rata per peran */
export function mapAverages(rows) {
  const overall = avgOf(rows, ACT_KEYS)
  const activeAvg = activeAvgOf(rows, ACT_KEYS)
  const roleOf = new Map()
  const groups = { dps: [], tank: [], support: [], healer: [] }
  for (const r of rows) {
    const role = detectRole(r, activeAvg)
    roleOf.set(keyName(r), role)
    groups[role].push(r)
  }
  const roleAvg = {}
  const roleSize = {}
  for (const [role, g] of Object.entries(groups)) {
    roleAvg[role] = avgOf(g, ROLE_KEYS[role])
    roleSize[role] = g.length
  }
  return { ...overall, overall, activeAvg, roleOf, roleAvg, roleSize }
}
/** Peran pemain di peta itu (hasil deteksi otomatis) */
export const playerRole = (r, avg) => avg.roleOf?.get(keyName(r)) || detectRole(r, avg.activeAvg || avg)
/**
 * Skor = kategori terbaik pemain di antara kategori perannya, dibanding rata-rata sesama perannya di peta itu
 * (100% = rata-rata peran itu). Peran yang pemainnya kurang dari 3 dibanding rata-rata semua pemain di peta itu.
 */
export function activityScore(r, avg) {
  const role = playerRole(r, avg)
  const keys = ROLE_KEYS[role]
  const overall = avg.overall || avg
  const base = avg.roleSize && avg.roleSize[role] >= MIN_PEERS ? avg.roleAvg[role] : overall
  let best = 0
  for (const k of keys) {
    const b = base[k] > 0 ? base[k] : overall[k]
    if (b > 0) best = Math.max(best, (r[k] || 0) / b)
  }
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
