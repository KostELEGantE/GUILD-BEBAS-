import { getLocale } from './i18n.js'
export const MODES = {
  guild_league: { label: 'Guild League', short: 'GL', color: 'var(--gl)' },
  polarity_zone: { label: 'Polarity Zone', short: 'PZ', color: 'var(--pz)' },
  siege: { label: 'Siege', short: 'SG', color: 'var(--sg)' },
}

/** Info tampilan mode sebuah event; event 'custom' memakai nama mode yang diketik pembuatnya */
export const CUSTOM_COLOR = '#b48cff'
export function modeOf(ev) {
  return MODES[ev?.mode] ?? { label: ev?.custom_mode || 'Lainnya', short: '★', color: CUSTOM_COLOR, custom: true }
}

export const ROLES = ['Tank', 'Healer', 'Support', 'DPS']

export const STATUS_LABEL = {
  open: 'Terbuka',
  locked: 'Dikunci',
  done: 'Selesai',
}

export const ATTEND_LABEL = {
  present: 'Hadir',
  absent: 'Tidak hadir',
  excused: 'Izin',
}

export function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '–'
  return Number(n).toLocaleString(getLocale())
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleString(getLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

/** nilai untuk <input type="datetime-local"> dari Date */
export function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function nameKey(s) {
  return String(s ?? '').trim().toLowerCase()
}

export function isOnline(status) {
  return /online/i.test(status || '') && !/offline/i.test(status || '')
}

export function navigate(hash) {
  window.location.hash = hash
}

/** Warna tetap untuk sebuah party fix berdasarkan id */
export function groupColor(id) {
  return `hsl(${(Number(id) * 67) % 360} 70% 62%)`
}

/** Jumlah party Main pada event (sisanya party Sub) */
export function mainCountOf(ev) {
  return Math.min(ev.main_count ?? ev.party_count, ev.party_count)
}

/**
 * Bagian party sebuah event, dengan rentang nomor party.
 * Contoh PZ: STAR (1-10), Normal Dungeon 1 (11-20), ...
 * Event lama tanpa `sections`: Main (1..main_count) + Sub (sisanya).
 */
export function sectionsOf(ev) {
  let raw = Array.isArray(ev.sections) && ev.sections.length ? ev.sections : null
  if (!raw) {
    const main = mainCountOf(ev)
    raw = [{ name: 'Main', prefix: 'Party', parties: main, attend: true }]
    if (ev.party_count > main) raw.push({ name: 'Sub', prefix: 'Sub', parties: ev.party_count - main, attend: false })
  }
  const out = []
  let from = 1
  for (const s of raw) {
    const n = Math.max(0, Number(s.parties) || 0)
    if (!n) continue
    out.push({ name: s.name || 'Bagian', prefix: s.prefix ?? s.name ?? 'Party', parties: n, attend: s.attend !== false, from, to: from + n - 1 })
    from += n
  }
  // party tambahan di luar bagian (mis. ditambah lewat tombol) masuk bagian terakhir
  if (out.length && from <= ev.party_count) {
    const last = out[out.length - 1]
    last.to = ev.party_count
    last.parties = last.to - last.from + 1
  }
  return out
}

/** Nama bawaan party ke-p, mis. "Party 3", "STAR 2", "ND1-4" */
export function defaultPartyName(sections, p) {
  const s = sections.find((x) => p >= x.from && p <= x.to)
  if (!s) return `Party ${p}`
  const i = p - s.from + 1
  return /[-#]$/.test(s.prefix) ? `${s.prefix}${i}` : `${s.prefix} ${i}`
}

/** Gabungkan banyak panggilan beruntun menjadi satu (untuk update realtime) */
export function debounce(fn, ms = 150) {
  let t
  const d = (...a) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
  d.cancel = () => clearTimeout(t)
  return d
}
export const DISCORD_URL = 'https://discord.gg/ex4R57YNw'
export const APP_VERSION = '2.11'
// class yang bisa dipilih saat mendaftarkan karakter
export const CLASSES = [
  'Lord Knight', 'Paladin', 'High Wizard', 'Professor', 'Scholar', 'High Priest', 'Champion', 'Sniper',
  'Clown', 'Gypsy', 'Whitesmith', 'Creator', 'Assassin Cross', 'Stalker', 'Night Watch', 'Alithea',
]
export const defaultRole = (c) =>
  ['Lord Knight', 'Paladin'].includes(c) ? 'Tank' : c === 'High Priest' ? 'Healer' : ['Clown', 'Gypsy', 'Scholar'].includes(c) ? 'Support' : 'DPS'
