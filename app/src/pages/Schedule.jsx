import { useEffect, useMemo, useState } from 'react'
import { SCHEDULE, nextOccurrence, serverDay } from '../lib/schedule.js'
import { MODES } from '../lib/util.js'
import { getLocale } from '../lib/i18n.js'

// Jadwal event mingguan (sama dengan kalender di game), waktu server GMT+7.
const ORDER = [1, 2, 3, 4, 5, 6, 0] // Senin … Minggu
const pad = (n) => String(n).padStart(2, '0')
function left(ms) {
  const t = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(t / 86400)
  const hms = `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`
  return { d, hms }
}

export default function Schedule() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const today = serverDay(now)
  const dayName = useMemo(() => {
    const f = new Intl.DateTimeFormat(getLocale(), { weekday: 'long', timeZone: 'UTC' })
    // 4 Jan 1970 = Minggu
    return (d) => f.format(new Date(Date.UTC(1970, 0, 4 + d)))
  }, [])

  const withTimes = SCHEDULE.map((ev) => ({ ev, o: nextOccurrence(ev, now) }))
  const live = withTimes.filter(({ o }) => o && o.start <= now && now < o.end)
  const upcoming = withTimes.filter(({ o }) => o && o.start > now).sort((a, b) => a.o.start - b.o.start)
  const nextOne = upcoming[0]
  const isLive = (ev) => live.some((x) => x.ev === ev)
  const isNext = (ev) => nextOne && nextOne.ev === ev
  // di HP hari ini tampil paling atas
  const days = window.matchMedia?.('(max-width: 860px)').matches ? [...ORDER.slice(ORDER.indexOf(today)), ...ORDER.slice(0, ORDER.indexOf(today))] : ORDER

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Jadwal mingguan</h1>
          <p className="muted">Semua event game menurut waktu server (GMT+7). Event bertanda 🔨 adalah event guild.</p>
        </div>
      </div>

      <div className="sched-now">
        {live.length > 0 && (
          <div className="sched-banner is-live">
            <span className="sched-dot" />
            <b>Sedang berlangsung:</b>{' '}
            <span className="notranslate">{live.map(({ ev }) => `${ev.name} (${ev.start}–${ev.end})`).join(' · ')}</span>
          </div>
        )}
        {nextOne && (
          <div className="sched-banner">
            <span>⏭ Berikutnya:</span>{' '}
            <b className="notranslate">{nextOne.ev.name}</b>{' '}
            <span className="muted notranslate">
              {dayName(nextOne.ev.day)} {nextOne.ev.start}
            </span>{' '}
            · <span>dalam</span>{' '}
            {left(nextOne.o.start - now).d > 0 && <span>{`${left(nextOne.o.start - now).d} hari`}</span>}{' '}
            <b className="notranslate sched-count">{left(nextOne.o.start - now).hms}</b>
          </div>
        )}
      </div>

      <div className="sched-grid">
        {days.map((d) => {
          const evs = SCHEDULE.filter((e) => e.day === d).sort((a, b) => a.start.localeCompare(b.start))
          return (
            <section key={d} className={`sched-day ${d === today ? 'is-today' : ''}`}>
              <div className="sched-day-head">
                <span className="notranslate">{dayName(d)}</span>
                {d === today && <span className="pill pill-gold">Hari ini</span>}
              </div>
              {evs.length === 0 && <div className="sched-empty small muted">—</div>}
              {evs.map((ev, i) => {
                const m = ev.mode ? MODES[ev.mode] : null
                return (
                  <div
                    key={i}
                    className={`sched-ev ${m ? 'is-war' : ''} ${ev.special ? 'is-special' : ''} ${isLive(ev) ? 'is-live' : ''} ${isNext(ev) ? 'is-next' : ''}`}
                    style={m ? { '--mode': m.color } : undefined}
                  >
                    <div className="sched-name notranslate">
                      {ev.guild && <span title="Event guild">🔨 </span>}
                      {ev.name}
                    </div>
                    <div className="sched-time notranslate">
                      {ev.start}–{ev.end}
                    </div>
                    {isLive(ev) && <span className="sched-tag live">Sedang berlangsung</span>}
                    {!isLive(ev) && isNext(ev) && <span className="sched-tag">Berikutnya</span>}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
