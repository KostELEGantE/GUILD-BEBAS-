import { useEffect, useState } from 'react'
import { getLocale } from '../lib/i18n.js'
import { MODES } from '../lib/util.js'

// Jam server game = GMT+7 (WIB). Jadwal war tetap (waktu server):
//   Polarity Zone : Minggu 19:30
//   Guild League  : Selasa & Kamis 21:00
const TZ = 'Asia/Jakarta'
const OFFSET = 7 * 3600e3
const LIVE_MS = 60 * 60e3 // dianggap "sedang berlangsung" sampai 1 jam setelah mulai
const WARS = [
  { mode: 'guild_league', days: [2, 4], h: 21, m: 0 },
  { mode: 'polarity_zone', days: [0], h: 19, m: 30 },
]

/** waktu mulai war berikutnya (epoch ms); war yang baru mulai < LIVE_MS masih dihitung */
function nextStart(w, now) {
  const s = new Date(now + OFFSET) // field UTC = jam server
  for (let d = 0; d <= 7; d++) {
    const day = (s.getUTCDay() + d) % 7
    if (!w.days.includes(day)) continue
    const t = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + d, w.h, w.m) - OFFSET
    if (t + LIVE_MS > now) return t
  }
  return null
}

const pad = (n) => String(n).padStart(2, '0')
function hms(ms) {
  const t = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`
}

export default function ServerClock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const loc = getLocale()
  const clock = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const when = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

  const wars = WARS.map((w) => ({ ...w, at: nextStart(w, now) }))
    .filter((w) => w.at)
    .sort((a, b) => a.at - b.at)

  return (
    <div className="server-bar">
      <span className="server-time" title="Waktu server game (GMT+7)">
        <span className="sb-label">
          🕒 <span className="sb-text">Waktu server</span>
        </span>
        <b className="notranslate">{clock.format(now)}</b>
        <span className="sb-tz">GMT+7</span>
      </span>
      {wars.map((w) => {
        const ms = w.at - now
        const live = ms <= 0
        const days = Math.floor(ms / 86400e3)
        return (
          <span key={w.mode} className={`war-count ${live ? 'is-live' : ms < 3600e3 ? 'is-soon' : ''}`} style={{ '--mode': MODES[w.mode].color }}>
            <span className="dot" />
            <span className="wc-name">
              <span className="wc-full">{MODES[w.mode].label}</span>
              <span className="wc-short">{MODES[w.mode].short}</span>
            </span>
            {live ? (
              <span className="wc-live">Sedang berlangsung</span>
            ) : (
              <>
                {days > 0 && <span className="wc-days">{`${days} hari`}</span>}
                <b className="notranslate wc-time">{hms(ms)}</b>
              </>
            )}
            <span className="wc-at notranslate">{when.format(w.at)}</span>
          </span>
        )
      })}
    </div>
  )
}
