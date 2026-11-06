// Ikon job sederhana buatan sendiri (bukan aset game), digambar dengan garis SVG.
// Bentuk = job, warna = role (Tank biru, Healer hijau, Support emas, DPS merah).

const P = {
  sword: 'M19 5 8.5 15.5 M6.5 13.5l4 4 M6 18l-3 3 M19 5h-3.5 M19 5v3.5',
  shield: 'M12 3 4.5 6v5.5c0 4.8 3.2 7.9 7.5 9.5 4.3-1.6 7.5-4.7 7.5-9.5V6z M12 7v10',
  staff: 'M5 21 13.5 12.5 M17 3l1.1 2.6 2.9.4-2.1 2 .5 2.8-2.4-1.4-2.6 1.3.6-2.8-2-2 2.8-.4z',
  cross: 'M12 3v18 M6.5 8.5h11',
  bow: 'M6 3c7.5 1.5 13.5 7.5 15 15 M6 3l15 15 M14.5 9.5 5 19 M5 19H3 M5 19v2',
  note: 'M9 18V6l10-2v11 M9 18a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 18z M19 15a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 19 15z',
  sparkle: 'M12 3l2 6.5L20.5 12 14 14.5 12 21l-2-6.5L3.5 12 10 9.5z',
  hammer: 'M13 4.5l6.5 6.5-3 3L10 7.5z M11.5 9 4 20 M3 21l1-1',
  flask: 'M9 3h6 M10 3v6.5l-5 8.5a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3L14 9.5V3 M7.2 15h9.6',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z M4 20.5v-15 M8 7.5h8',
  dagger: 'M20 4 11 13 M20 4l-4.5 1 M20 4l-1 4.5 M8.5 10.5l5 5 M11 13l-6.5 6.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z',
  burst: 'M12 2.5v4 M12 17.5v4 M2.5 12h4 M17.5 12h4 M5.3 5.3l2.9 2.9 M15.8 15.8l2.9 2.9 M5.3 18.7l2.9-2.9 M15.8 8.2l2.9-2.9',
  scope: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M12 1.5v5 M12 17.5v5 M1.5 12h5 M17.5 12h5',
  moon: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10z',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M4.5 21c1-4 4-6 7.5-6s6.5 2 7.5 6',
}

const JOB = {
  'Lord Knight': 'sword',
  Paladin: 'shield',
  'High Wizard': 'staff',
  Professor: 'book',
  Scholar: 'book',
  'High Priest': 'cross',
  Champion: 'burst',
  Sniper: 'bow',
  Clown: 'note',
  Gypsy: 'sparkle',
  Whitesmith: 'hammer',
  Creator: 'flask',
  'Assassin Cross': 'dagger',
  Stalker: 'eye',
  'Night Watch': 'scope',
  Alithea: 'moon',
}

const ROLE_COLOR = { Tank: 'var(--tank)', Healer: 'var(--healer)', Support: 'var(--support)', DPS: 'var(--dps)' }

export function jobGlyph(cls) {
  return JOB[cls] ?? 'user'
}

export default function JobIcon({ m, size = 18 }) {
  if (!m) return null
  const color = ROLE_COLOR[m.role] ?? 'var(--muted)'
  return (
    <span
      className="job-icon"
      style={{ '--c': color, width: size, height: size }}
      title={`${m.class ?? 'Job tidak diketahui'} · ${m.role ?? '–'}`}
    >
      <svg viewBox="0 0 24 24" width={size - 6} height={size - 6} aria-hidden="true">
        <path d={P[jobGlyph(m.class)]} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
