// Jadwal event mingguan dari kalender di game (waktu server GMT+7).
// day: 0 = Minggu, 1 = Senin, … 6 = Sabtu. guild: event guild (ikon palu di game).
// mode: dipakai untuk warna & hitung mundur di bar atas.
export const SCHEDULE = [
  { day: 1, start: '13:00', end: '14:00', name: 'Stellar Battlefield' },
  { day: 1, start: '21:00', end: '22:00', name: 'Stellar Battlefield' },
  { day: 2, start: '21:00', end: '21:20', name: 'Guild Banquet' },
  { day: 2, start: '21:30', end: '21:55', name: 'Guild League', mode: 'guild_league', guild: true },
  { day: 2, start: '22:00', end: '22:25', name: 'Guild League', mode: 'guild_league', guild: true },
  { day: 3, start: '13:00', end: '14:00', name: 'Stellar Battlefield' },
  { day: 3, start: '21:00', end: '22:00', name: 'Stellar Battlefield' },
  { day: 3, start: '21:30', end: '22:15', name: 'Ancient Ruins' },
  { day: 4, start: '21:00', end: '21:15', name: 'Mirror World', guild: true },
  { day: 4, start: '21:30', end: '21:45', name: 'Hazy Forest', guild: true },
  { day: 4, start: '22:00', end: '22:25', name: 'Guild League', mode: 'guild_league', guild: true },
  { day: 5, start: '13:00', end: '14:00', name: 'Stellar Battlefield' },
  { day: 5, start: '21:00', end: '21:30', name: 'Hoppy Quiz' },
  { day: 5, start: '21:00', end: '22:00', name: 'Stellar Battlefield' },
  { day: 5, start: '21:30', end: '22:30', name: 'Battle for Miracle Isle' },
  { day: 6, start: '08:00', end: '23:59', name: 'Luminous Vale', special: true },
  { day: 6, start: '20:00', end: '20:50', name: 'Clash of The Chosen', special: true },
  { day: 0, start: '12:00', end: '21:00', name: 'Polarity Zone', mode: 'polarity_zone', guild: true },
  { day: 0, start: '21:00', end: '22:00', name: 'Siege', mode: 'siege' },
]

export const TZ = 'Asia/Jakarta'
const OFFSET = 7 * 3600e3
const hm = (s) => s.split(':').map(Number)

/** Waktu (epoch ms) mulai & selesai kemunculan berikutnya; yang sedang berlangsung tetap dihitung */
export function nextOccurrence(ev, now = Date.now()) {
  const s = new Date(now + OFFSET) // field UTC = jam server
  const [sh, sm] = hm(ev.start)
  const [eh, em] = hm(ev.end)
  for (let d = 0; d <= 7; d++) {
    if ((s.getUTCDay() + d) % 7 !== ev.day) continue
    const base = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + d) - OFFSET
    const start = base + (sh * 60 + sm) * 60e3
    let end = base + (eh * 60 + em) * 60e3
    if (eh === 23 && em === 59) end += 60e3
    if (end > now) return { start, end }
  }
  return null
}

/** hari ini menurut jam server (0 = Minggu) */
export const serverDay = (now = Date.now()) => new Date(now + OFFSET).getUTCDay()
