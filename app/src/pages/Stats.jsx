import { useEffect, useMemo, useState } from 'react'
import { rpc } from '../lib/supabase.js'
import { useApp } from '../context.jsx'
import { fmtNum } from '../lib/util.js'
import { downloadXlsx } from '../lib/sheet.js'
import { Stat } from './Attendance.jsx'

export default function Stats() {
  const { toast, user, members, isAdmin } = useApp()
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState(null)
  const [sort, setSort] = useState('rate_asc')
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)

  useEffect(() => {
    setRows(null)
    rpc('participation_stats', { p_days: days })
      .then(setRows)
      .catch((e) => {
        toast(e.message, 'err')
        setRows([])
      })
  }, [days, toast])

  const mineIds = useMemo(() => new Set(members.filter((m) => m.user_id === user.id).map((m) => m.id)), [members, user.id])

  const list = useMemo(() => {
    if (!rows) return []
    const s = search.trim().toLowerCase()
    const r = rows.filter((x) => (!onlyActive || x.active) && (!s || x.name.toLowerCase().includes(s)))
    const rate = (x) => (x.attendance_rate == null ? -1 : Number(x.attendance_rate))
    const by = {
      rate_asc: (a, b) => rate(a) - rate(b) || b.no_show - a.no_show,
      rate_desc: (a, b) => rate(b) - rate(a),
      no_show: (a, b) => b.no_show - a.no_show,
      contrib: (a, b) => (b.weekly_contribution || 0) - (a.weekly_contribution || 0),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort]
    return [...r].sort(by)
  }, [rows, search, onlyActive, sort])

  const totalEvents = rows?.[0]?.events_total ?? 0
  const avg =
    list.length && totalEvents ? Math.round(list.reduce((a, x) => a + Number(x.attendance_rate || 0), 0) / list.length) : null
  const low = list.filter((x) => totalEvents && Number(x.attendance_rate || 0) < 50).length
  const noShowers = list.filter((x) => x.no_show > 0).length

  function exportXlsx() {
    downloadXlsx(
      list.map((x) => ({
        Karakter: x.name,
        Class: x.class,
        Role: x.role,
        'Gear Score': x.gear_score,
        'Kontribusi minggu ini': x.weekly_contribution,
        'Total event': x.events_total,
        Daftar: x.signed_up,
        Hadir: x.present,
        'Tidak hadir': x.absent,
        Izin: x.excused,
        'No-show': x.no_show,
        'Kehadiran %': x.attendance_rate,
        ...(isAdmin ? { 'Akun login': x.owner } : {}),
      })),
      `kehadiran-${days}hari.xlsx`,
      'Kehadiran',
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Partisipasi member</h1>
          <p className="muted">
            Dihitung dari event berstatus <b>Selesai</b> yang sudah di-import kehadirannya. Kehadiran % = hadir ÷ jumlah event
            dalam periode.
          </p>
        </div>
        <div className="row gap-sm">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 hari terakhir</option>
            <option value={30}>30 hari terakhir</option>
            <option value={90}>90 hari terakhir</option>
            <option value={365}>1 tahun</option>
          </select>
          <button className="btn btn-ghost" onClick={exportXlsx} disabled={!list.length}>
            Export Excel
          </button>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="Event selesai" value={totalEvents} />
        <Stat label="Rata-rata kehadiran" value={avg == null ? '–' : `${avg}%`} tone="green" />
        <Stat label="Kehadiran < 50%" value={low} tone="red" />
        <Stat label="Pernah no-show" value={noShowers} tone="gold" />
      </div>

      <div className="filters">
        <input placeholder="Cari karakter…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="rate_asc">Kehadiran terendah dulu</option>
          <option value="rate_desc">Kehadiran tertinggi dulu</option>
          <option value="no_show">No-show terbanyak</option>
          <option value="contrib">Kontribusi minggu ini</option>
          <option value="name">Nama</option>
        </select>
        <label className="check-label small">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Hanya member aktif
        </label>
      </div>

      {rows === null ? (
        <div className="muted pad">Menghitung…</div>
      ) : totalEvents === 0 ? (
        <div className="empty">
          Belum ada event selesai dalam periode ini. Setelah event berakhir, admin meng-import daftar peserta dari game di tab{' '}
          <b>Kehadiran</b> pada halaman event.
        </div>
      ) : (
        <div className="table-wrap card flush">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>Karakter</th>
                <th className="hide-sm">Class</th>
                <th className="num hide-xs">Mendaftar</th>
                <th className="num">Hadir</th>
                <th className="num">Tidak hadir</th>
                <th className="num hide-sm">Izin</th>
                <th className="num">No-show</th>
                <th>Kehadiran</th>
                <th className="num hide-sm">Kontribusi minggu ini</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const rate = Number(x.attendance_rate || 0)
                const tone = rate >= 75 ? 'green' : rate >= 50 ? 'gold' : 'red'
                return (
                  <tr key={x.member_id} className={mineIds.has(x.member_id) ? 'row-mine' : ''}>
                    <td>
                      <b>{x.name}</b>
                      {isAdmin && x.owner && <div className="small muted">akun: {x.owner}</div>}
                    </td>
                    <td className="muted hide-sm tc-class">{x.class}</td>
                    <td className="num hide-xs" data-label="Mendaftar">{x.signed_up}</td>
                    <td className="num" data-label="Hadir">{x.present}</td>
                    <td className="num" data-label="Tidak hadir">{x.absent}</td>
                    <td className="num hide-sm" data-label="Izin">{x.excused}</td>
                    <td className={`num ${x.no_show ? 'text-red' : ''}`} data-label="No-show">{x.no_show}</td>
                    <td className="tc-rate">
                      <div className="rate">
                        <div className="meter">
                          <div className={`meter-fill fill-${tone}`} style={{ width: `${rate}%` }} />
                        </div>
                        <span className="small">{x.attendance_rate == null ? '–' : `${rate}%`}</span>
                      </div>
                    </td>
                    <td className="num hide-sm" data-label="Kontribusi minggu ini">{fmtNum(x.weekly_contribution)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
