import { useEffect, useState } from 'react'
import { getLocale } from '../lib/i18n.js'
import { MODES } from '../lib/util.js'

// Jam server game = GMT+7 (WIB). Hitung mundur diambil dari jadwal mingguan di lib/schedule.js
// (sama dengan kalender event di game).
import { SCHEDULE, TZ, nextOccurrence } from '../lib/schedule.js'
const WAR_MODES = ['guild_league', 'polarity_zone', 'siege']

/** kemunculan berikutnya per mode war (yang sedang berlangsung diutamakan) */
function nextWars(now) {
  return WAR_MODES.map((mode) => {
    let best = null
    for (const ev of SCHEDULE.filter((e) => e.mode === mode)) {
      const o = nextOccurrence(ev, now)
      if (o && (!best || o.start < best.start)) best = { ...o, mode }
    }
    return best
  }).filter(Boolean)
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

  const wars = nextWars(now)
    .map((w) => ({ ...w, at: w.start }))
    .sort((a, b) => a.at - b.at)

  return (
    <div className="server-bar">
      <a className="server-time" href="#/schedule" title="Waktu server game (GMT+7) · lihat jadwal mingguan">
        <span className="sb-label">
          🕒 <span className="sb-text">Waktu server</span>
        </span>
        <b className="notranslate">{clock.format(now)}</b>
        <span className="sb-tz">GMT+7</span>
        <span className="sb-sched">📅</span>
      </a>
      {wars.map((w) => {
        const ms = w.at - now
        const live = ms <= 0 && now < w.end
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
