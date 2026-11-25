import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, q, rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { tr } from '../lib/i18n.js'
import { parseWarResult, isIdle, mapAverages, activityScore, playerRole, autoRole, objectivesOf, ROLES, ROLE_LABEL, ROLE_KEYS, OBJECTIVE_KEYS, enemySummary, detectMap, LOW_SCORE } from '../lib/warResult.js'
import JobIcon from '../components/JobIcon.jsx'

// Cek pemain aktif / tidak aktif di Guild League dari kehadiran war dan statistik hasil war di game.
const STATUS = {
  active: { label: 'Aktif', cls: 'pill-green', rank: 4 },
  low: { label: 'Kurang aktif', cls: 'pill-gold', rank: 2 },
  afk: { label: 'Perlu dicek (AFK)', cls: 'pill-orange', rank: 1 },
  inactive: { label: 'Tidak aktif', cls: 'pill-red', rank: 0 },
  nodata: { label: 'Belum ada data', cls: '', rank: 3 },
}
/** Musuh aktif sebanyak ini atau kurang di satu peta = dianggap tidak ada musuh (AFK tidak dihitung) */
const NO_ENEMY_MAX = 4
const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
/** "Sel 24 Nov · 21:30" — hari + tanggal + jam supaya tiap GL gampang dibedakan */
export const glLabel = (d) => {
  const t = new Date(d)
  return `${HARI[t.getDay()]} ${t.getDate()} ${BULAN[t.getMonth()]} · ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}
/** Senin awal minggu (jam lokal) */
const weekStart = (d) => {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  return t
}
/** Kelompokkan sesi per minggu (terbaru dulu); tiap GL diberi nomor 1–3 di minggunya */
export function groupByWeek(sessions) {
  const weeks = new Map()
  for (const s of [...sessions].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))) {
    const ws = weekStart(s.starts_at)
    const k = ws.getTime()
    if (!weeks.has(k)) weeks.set(k, { start: ws, list: [] })
    weeks.get(k).list.push({ s, n: weeks.get(k).list.length + 1 })
  }
  return [...weeks.values()].reverse().map((w) => {
    const end = new Date(w.start)
    end.setDate(end.getDate() + 6)
    return { ...w, label: `${w.start.getDate()} ${BULAN[w.start.getMonth()]} – ${end.getDate()} ${BULAN[end.getMonth()]}` }
  })
}
/** Jadwal GL tiap minggu: GL 1 Selasa 21:30, GL 2 Selasa 22:00, GL 3 Kamis 22:00 (bisa diubah saat input) */
const GL_SCHEDULE = [
  { dow: 2, h: 21, m: 30 },
  { dow: 2, h: 22, m: 0 },
  { dow: 4, h: 22, m: 0 },
]
const GL_PER_WEEK = GL_SCHEDULE.length
const toLocalInput = (d) => {
  const t = new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`
}
/** Menit sejak Senin 00:00 */
const minOfWeek = (d) => {
  const t = new Date(d)
  return ((t.getDay() + 6) % 7) * 1440 + t.getHours() * 60 + t.getMinutes()
}
const slotMin = (j) => {
  const g = GL_SCHEDULE[j] || GL_SCHEDULE[GL_SCHEDULE.length - 1]
  return ((g.dow + 6) % 7) * 1440 + g.h * 60 + g.m
}
/** Nama babak GL sesuai game: slot 1 Preliminaries, 2 Semifinals, 3 Finals */
export const GL_STAGES = ['Preliminaries', 'Semifinals', 'Finals']
export const stageOfSlot = (n) => (GL_STAGES[n - 1] ? `${GL_STAGES[n - 1]} / GL ${n}` : `GL ${n}`)
/** Babak dari jam main: slot jadwal terdekat (Sel 21:30 / Sel 22:00 / Kam 22:00) */
export const glStage = (d) => {
  const mw = minOfWeek(d)
  let best = 0
  for (let j = 1; j < GL_PER_WEEK; j++) if (Math.abs(slotMin(j) - mw) < Math.abs(slotMin(best) - mw)) best = j
  return stageOfSlot(best + 1)
}
/** Tiap minggu selalu 3 slot GL: sesi yang sudah ada diisi ke slot jadwal terdekat, sisanya slot kosong siap diinput */
export function weekSlots(sessions, nWeeks = 4) {
  const now = new Date()
  const out = []
  for (let i = 0; i < nWeeks; i++) {
    const start = weekStart(now)
    start.setDate(start.getDate() - 7 * i)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const list = sessions
      .filter((s) => { const t = new Date(s.starts_at); return t >= start && t < end })
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    // taruh sesi yang ada di slot jadwal terdekat (hari + jam), tetap berurutan
    const total = Math.max(GL_PER_WEEK, list.length)
    const at = new Array(total).fill(null)
    let next = 0
    list.forEach((s, i) => {
      const mw = minOfWeek(s.starts_at)
      let best = next
      for (let j = next; j <= total - (list.length - i); j++) {
        if (Math.abs(slotMin(j) - mw) < Math.abs(slotMin(best) - mw)) best = j
      }
      at[best] = s
      next = best + 1
    })
    const slots = []
    for (let n = 1; n <= total; n++) {
      const s = at[n - 1]
      if (s) { slots.push({ n, s, key: String(s.id) }); continue }
      const prev = slots[slots.length - 1]
      const g = GL_SCHEDULE[n - 1] || GL_SCHEDULE[GL_SCHEDULE.length - 1]
      const d = new Date(start)
      d.setDate(d.getDate() + ((g.dow + 6) % 7))
      d.setHours(g.h, g.m, 0, 0)
      const prevT = prev ? new Date(prev.s ? prev.s.starts_at : prev.at) : null
      if (prevT && d <= prevT) { d.setTime(prevT.getTime() + 30 * 60000) }
      slots.push({ n, s: null, at: toLocalInput(d), key: `new:${start.getTime()}:${n}`, future: d > now })
    }
    const last = new Date(end)
    last.setDate(last.getDate() - 1)
    out.push({ start, slots, label: `${start.getDate()} ${BULAN[start.getMonth()]} – ${last.getDate()} ${BULAN[last.getMonth()]}` })
  }
  return out
}
/** Nilai untuk urutkan tabel ringkasan */
const SUM_SORT = {
  name: (r) => r.m.name.toLowerCase(),
  pct: (r) => r.pct,
  score: (r) => r.avgScore,
  kills: (r) => (r.warsWithStats ? r.avg.kills : null),
  dmg: (r) => (r.warsWithStats ? r.avg.player_dmg : null),
  heal: (r) => (r.warsWithStats ? r.avg.heal : null),
  last: (r) => (r.lastSeen ? new Date(r.lastSeen).getTime() : null),
  afkweek: (r) => (r.maxWeek ? r.maxWeek.afk : 0),
  missed: (r) => r.missedN,
  status: (r) => STATUS[r.st].rank,
  // riwayat: paling sering hadir (tanpa AFK) dulu
  hist: (r) => r.present - r.afk + (r.hist.length - r.missedN) / 1000,
}
/** Kolom tabel ringkasan yang bisa disorot / dipilih (nomor = urutan kolom) */
const SUM_COLS = [
  { n: 3, label: 'Hadir' },
  { n: 4, label: 'Riwayat GL' },
  { n: 5, label: 'Skor' },
  { n: 6, label: 'Kill / Assist' },
  { n: 7, label: 'Damage' },
  { n: 8, label: 'Heal' },
  { n: 9, label: 'Absent' },
  { n: 10, label: 'AFK / minggu' },
  { n: 11, label: 'Terakhir hadir' },
]
const loadCols = () => {
  try {
    const v = JSON.parse(localStorage.getItem('act:hlcols') || 'null')
    return v && Array.isArray(v.cols) ? v : { cols: [], only: false }
  } catch {
    return { cols: [], only: false }
  }
}
/** Status satu member di satu GL (untuk filter) */
const histKey = (h) => (h.missed || h.noshow ? 'absent' : h.a === 'present' ? (h.idle ? 'afk' : 'present') : h.a === 'excused' ? 'excused' : h.a === 'absent' ? 'absent' : 'none')
const SCORE_BANDS = { hi: (x) => x != null && x >= 0.75, mid: (x) => x != null && x >= LOW_SCORE && x < 0.75, lo: (x) => x != null && x < LOW_SCORE, none: (x) => x == null }
const TEXT_KEYS = new Set(['name', 'map', 'status'])
/** Header tabel yang bisa diklik untuk urutkan (klik lagi = balik arah, klik ketiga = urutan bawaan) */
function SortTh({ k, num, sort, setSort, children, title, focus }) {
  const on = sort.k === k
  const first = TEXT_KEYS.has(k) ? 1 : -1 // angka: besar dulu; teks: A→Z dulu
  const click = () => setSort(!on ? { k, dir: first } : sort.dir === first ? { k, dir: -first } : { k: '', dir: 1 })
  return (
    <th className={`sortable ${num ? 'num' : ''} ${on ? 'is-sorted' : ''} ${focus ? 'is-focus' : ''}`} onClick={click} title={title || 'Klik untuk urutkan'}>
      {children}
      <span className="sort-ind">{on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ' ↕'}</span>
    </th>
  )
}

/** Detail satu GL: semua pemain di GL itu, bisa difilter per peta & status, dan diurutkan per kolom */
function GlDetail({ g, members, att, stats, meta, search, weekAfk, onBack, onChanged }) {
  const { isAdmin } = useApp()
  const [run, busy] = useAction()
  const [moving, setMoving] = useState(false)
  const [moveAt, setMoveAt] = useState(() => toLocalInput(g.s.starts_at))
  const delGl = () => {
    if (!window.confirm(tr(`Hapus ${glStage(g.s.starts_at)} ${glLabel(g.s.starts_at)}? Hasil war Main/Sub dan kehadirannya ikut terhapus. Tidak bisa dibatalkan.`))) return
    run(async () => {
      await rpc('delete_gl_session', { p_event_id: g.s.id })
      onBack()
      await onChanged()
    }, 'GL dihapus')
  }
  const moveGl = () =>
    run(async () => {
      await rpc('move_gl_session', { p_event_id: g.s.id, p_played_at: new Date(moveAt).toISOString() })
      setMoving(false)
      await onChanged()
    }, 'Jadwal GL dipindah')
  const [pendingRole, setPendingRole] = useState(null) // { r, role } menunggu konfirmasi
  const setRole = (r, role) =>
    run(async () => {
      await rpc('set_war_role', { p_event_id: g.s.id, p_map: r.maps[0], p_name: r.name, p_role: role || null })
      setPendingRole(null)
      await onChanged()
    }, 'Peran disimpan')
  const [map, setMap] = useState('all')
  const [filter, setFilter] = useState('')
  const [roleF, setRoleF] = useState('')
  const [sort, setSort] = useState({ k: 'score', dir: -1 })
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const rows = useMemo(() => {
    const maps = map === 'all' ? ['main', 'sub'] : [map]
    const avg = Object.fromEntries(maps.map((k) => [k, mapAverages(stats.filter((x) => x.map === k))]))
    const metaOf = Object.fromEntries(meta.map((x) => [x.map, x]))
    const out = new Map()
    const keyOf = (x) => (x.member_id ? `m${x.member_id}` : `n${x.name.toLowerCase()}`)
    const seen = new Set() // pemain yang ada di hasil war (peta mana pun)
    // satu baris per pemain per peta: Main dan Sub tidak digabung, skor dibanding pemain di peta itu saja
    for (const x of stats) {
      if (!maps.includes(x.map)) continue
      const k = keyOf(x)
      seen.add(k)
      const score = activityScore(x, avg[x.map])
      const noEnemy = metaOf[x.map] ? metaOf[x.map].enemy_active <= NO_ENEMY_MAX : false
      const role = playerRole(x, avg[x.map])
      const auto = autoRole(x, avg[x.map])
      out.set(`${k}-${x.map}`, { key: `${k}-${x.map}`, m: byId.get(x.member_id), name: x.name, job: x.job, st: { ...x }, maps: [x.map], score, noEnemy, role, auto, fixed: !!x.role, obj: objectivesOf(x) })
    }
    for (const r of out.values()) {
      const a = r.m ? att.find((x) => x.member_id === r.m.id)?.status : null
      const weak = isIdle(r.st) || r.score < LOW_SCORE
      r.status = weak && !r.noEnemy ? 'afk' : a === 'excused' ? 'excused' : 'present'
      if (!r.m) r.status = 'unknown'
    }
    // yang tidak ada di hasil war: absen / izin / hadir tanpa hasil (hanya saat lihat semua peta)
    if (map === 'all' && stats.length)
      for (const m of members) {
        if (!m.active || seen.has(`m${m.id}`)) continue
        const a = att.find((x) => x.member_id === m.id)?.status
        out.set(`m${m.id}`, { key: `m${m.id}`, m, name: m.name, job: m.class, st: null, maps: [], score: null, status: a === 'excused' ? 'excused' : 'missed', score: a === 'excused' ? null : 0 })
      }
    if (map === 'all' && !stats.length && att.length)
      for (const m of members) {
        if (!m.active || att.some((x) => x.member_id === m.id)) continue
        out.set(`m${m.id}`, { key: `m${m.id}`, m, name: m.name, job: m.class, st: null, maps: [], score: 0, status: 'missed' })
      }
    if (map === 'all')
      for (const a of att) {
        const k = `m${a.member_id}`
        if (seen.has(k) || out.has(k)) continue
        const m = byId.get(a.member_id)
        if (!m) continue
        out.set(k, { key: k, m, name: m.name, job: m.class, st: null, maps: [], score: a.status === 'absent' ? 0 : null, status: a.status === 'present' ? 'present' : a.status === 'absent' ? 'missed' : a.status })
      }
    return [...out.values()]
  }, [map, stats, meta, att, byId, members])

  const ST = {
    present: ['Hadir', 'pill-green'],
    afk: ['AFK', 'pill-red'],
    missed: ['Absent', 'pill-miss'],
    absent: ['Absen', 'pill-muted'],
    excused: ['Izin', 'pill-blue'],
    unknown: ['Tidak di roster', 'pill-orange'],
    noshow: ['Tidak hadir (tidak tercatat)', 'pill-muted'],
  }
  const counts = useMemo(() => {
    const c = {}
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [rows])
  const val = {
    name: (r) => r.name.toLowerCase(),
    status: (r) => ['afk', 'missed', 'noshow', 'present', 'excused', 'absent', 'unknown'].indexOf(r.status),
    map: (r) => r.maps.join('+') || 'z',
    role: (r) => r.role || 'z',
    obj: (r) => (r.obj ? r.obj.length : null),
    score: (r) => r.score,
    kills: (r) => r.st?.kills, assists: (r) => r.st?.assists, deaths: (r) => r.st?.deaths,
    player_dmg: (r) => r.st?.player_dmg, endure: (r) => r.st?.endure, building_dmg: (r) => r.st?.building_dmg, heal: (r) => r.st?.heal,
    afkweek: (r) => (r.m ? weekAfk.get(r.m.id)?.afk || 0 : null),
    monsters: (r) => r.st?.monsters, boss_dmg: (r) => r.st?.boss_dmg, flag_repair: (r) => r.st?.flag_repair,
    revives: (r) => r.st?.revives, boss_dmg: (r) => r.st?.boss_dmg, flag_repair: (r) => r.st?.flag_repair,
  }
  const term = search.trim().toLowerCase()
  const shown = rows
    .filter((r) => !filter || r.status === filter)
    // Absent tidak punya peran: filter peran tidak berlaku saat melihat daftar Absent
    .filter((r) => !roleF || filter === 'missed' || (roleF === 'obj' ? r.obj && r.obj.length : r.role === roleF))
    .filter((r) => !term || r.name.toLowerCase().includes(term) || (r.job || '').toLowerCase().includes(term))
    .sort((a, b) => {
      const f = val[sort.k] || val.score
      const x = f(a), y = f(b)
      if (x !== y) return x == null ? 1 : y == null ? -1 : (x < y ? -1 : 1) * sort.dir
      return a.name.localeCompare(b.name)
    })
  const total = (k) => rows.reduce((t, r) => t + (r.st?.[k] || 0), 0)
  const mapsAvail = ['main', 'sub'].filter((k) => stats.some((x) => x.map === k))
  const COL_LABEL = { kills: 'Kill', assists: 'Assist', deaths: 'Mati', player_dmg: 'Damage', endure: 'Endure', heal: 'Heal', revives: 'Revive', building_dmg: 'Building', monsters: 'Monster', boss_dmg: 'MVP', flag_repair: 'Flag' }
  const baseCols = ['kills', 'assists', 'deaths', 'player_dmg', 'endure', 'heal', 'revives']
  // Filter peran dipilih: kolom yang dinilai untuk peran itu dipindah ke depan (dan disorot)
  const focus = ROLES.includes(roleF) ? ROLE_KEYS[roleF] : roleF === 'obj' ? OBJECTIVE_KEYS.map(([k]) => k) : []
  const cols = [...focus, ...baseCols.filter((k) => !focus.includes(k))].map((k) => [k, COL_LABEL[k]])
  // Rata-rata per peta untuk penjelasan cara hitung
  const mapAvgs = useMemo(
    () => Object.fromEntries(['main', 'sub'].filter((k) => stats.some((x) => x.map === k)).map((k) => [k, mapAverages(stats.filter((x) => x.map === k))])),
    [stats],
  )
  const fmtAvg = (k, v) => (['player_dmg', 'endure', 'heal', 'building_dmg', 'boss_dmg'].includes(k) ? short(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString('id-ID'))
  const explain = (() => {
    if (!roleF) return null
    const maps = Object.keys(mapAvgs).filter((k) => map === 'all' || k === map)
    if (roleF === 'obj') {
      return {
        head: 'Objective tidak masuk skor. Hanya status khusus untuk pemain yang mengerjakan Building, Monster, MVP (boss), atau Flag.',
        lines: maps.map((mk) => ({
          mk,
          text: OBJECTIVE_KEYS.map(([k, label]) => `${label} ${fmtAvg(k, stats.filter((x) => x.map === mk).reduce((t, x) => t + (x[k] || 0), 0))}`).join(' · '),
          pre: 'Total guild:',
        })),
      }
    }
    const keys = ROLE_KEYS[roleF]
    return {
      head: `${ROLE_LABEL[roleF]} dinilai dari ${keys.map((k) => COL_LABEL[k]).join(', ')}. Tiap kategori = nilai pemain ÷ rata-rata sesama ${ROLE_LABEL[roleF]} di peta yang sama; skor = rata-rata semua kategori itu (100% = rata-rata). Di bawah 25% = AFK.`,
      lines: maps.map((mk) => {
        const a = mapAvgs[mk]
        const n = a.roleSize?.[roleF] || 0
        const peer = n >= 3
        const base = peer ? a.roleAvg[roleF] : a.overall
        return {
          mk,
          pre: peer ? `Rata-rata ${n} ${ROLE_LABEL[roleF]}:` : `Hanya ${n} ${ROLE_LABEL[roleF]}, dibanding rata-rata semua pemain:`,
          text: keys.map((k) => `${COL_LABEL[k]} ${fmtAvg(k, base[k] || 0)}`).join(' · '),
        }
      }),
    }
  })()

  return (
    <div className="card act-gldetail">
      <div className="act-gldetail-head">
        <div>
          <h2>
            <span className="act-gl-no">{g.no}</span> {`${glStage(g.s.starts_at)} · ${glLabel(g.s.starts_at)}`}
          </h2>
          <div className="small muted">
            {meta.length
              ? meta
                  .sort((a, b) => a.map.localeCompare(b.map))
                  .map((x) => (
                    <span key={x.map} className="act-mapsum"><MapTag k={x.map} />{` ${x.our_players ?? stats.filter((y) => y.map === x.map).length} kita vs ${x.enemy_players} ${x.enemy_guild || 'musuh'} (${x.enemy_active} aktif)`}</span>
                  ))
              : stats.length
                ? `${new Set(stats.map((x) => x.name)).size} pemain di hasil war`
                : 'Belum ada hasil war untuk GL ini — hanya data absen.'}
          </div>
        </div>
        <div className="act-gldetail-actions">
          {isAdmin && (
            <>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMoving((v) => !v)}>
                📅 Pindah jadwal
              </button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={delGl}>
                🗑 Hapus GL
              </button>
            </>
          )}
          <button className="btn btn-ghost" onClick={onBack}>
            ← Semua GL
          </button>
        </div>
      </div>
      {moving && (
        <div className="act-move">
          <span className="small">Pindahkan GL ini ke tanggal & jam:</span>
          <input type="datetime-local" value={moveAt} onChange={(e) => setMoveAt(e.target.value)} />
          <button className="btn btn-gold btn-sm" disabled={busy || !moveAt} onClick={moveGl}>
            Simpan
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMoving(false)}>
            Batal
          </button>
        </div>
      )}

      <div className="act-gldetail-bar">
        {mapsAvail.length > 0 && (
          <div className="seg">
            {['all', ...mapsAvail].map((k) => (
              <button key={k} className={map === k ? 'is-on' : ''} onClick={() => setMap(k)}>
                {k === 'all' ? <MapTags maps={mapsAvail} /> : <MapTag k={k} />}
              </button>
            ))}
          </div>
        )}
        <div className="act-gldetail-chips">
          <button className={!filter ? 'is-on' : ''} onClick={() => setFilter('')}>{`Semua ${rows.length}`}</button>
          {Object.keys(ST)
            .filter((k) => counts[k])
            .map((k) => (
              <button
                key={k}
                className={filter === k ? 'is-on' : ''}
                onClick={() => {
                  setFilter(filter === k ? '' : k)
                  if (k === 'missed') setRoleF('')
                }}
              >
                {`${ST[k][0]} ${counts[k]}`}
              </button>
            ))}
        </div>
        {stats.length > 0 && (
          <div className="act-gldetail-chips">
            <button className={!roleF ? 'is-on' : ''} onClick={() => setRoleF('')}>Semua peran</button>
            {ROLES.map((k) => (
              <button key={k} className={roleF === k ? 'is-on' : ''} onClick={() => setRoleF(roleF === k ? '' : k)}>
                <span className={`role-tag role-${k}`}>{ROLE_LABEL[k]}</span> {rows.filter((r) => r.role === k).length}
              </button>
            ))}
            <button className={roleF === 'obj' ? 'is-on' : ''} onClick={() => setRoleF(roleF === 'obj' ? '' : 'obj')}>
              <span className="role-tag role-obj">Objective</span> {rows.filter((r) => r.obj && r.obj.length).length}
            </button>
          </div>
        )}
        {explain && (
          <div className="act-explain">
            <div>{explain.head}</div>
            {explain.lines.map((l) => (
              <div key={l.mk} className="act-explain-line">
                <MapTag k={l.mk} /> <span className="muted">{l.pre}</span> <b className="notranslate">{l.text}</b>
              </div>
            ))}
          </div>
        )}
        {stats.length > 0 && (
          <div className="small muted notranslate">{`Total: K ${total('kills')} · A ${total('assists')} · Dmg ${short(total('player_dmg'))} · Bld ${short(total('building_dmg'))} · Heal ${short(total('heal'))}`}</div>
        )}
      </div>

      <div className="table-wrap act-scroll">
        <table className="table table-cards act-table act-gltable">
          <thead>
            <tr>
              <th className="num">#</th>
              <SortTh k="name" sort={sort} setSort={setSort}>Karakter</SortTh>
              <SortTh k="status" sort={sort} setSort={setSort}>Status</SortTh>
              <SortTh k="map" sort={sort} setSort={setSort}>Peta</SortTh>
              <SortTh k="role" sort={sort} setSort={setSort} title="Ditentukan otomatis dari angka hasil war (bukan dari job)">Peran</SortTh>
              <SortTh k="score" num sort={sort} setSort={setSort} title="Rata-rata semua kategori perannya dibanding pemain di peta yang sama (Main dan Sub terpisah)">Skor</SortTh>
              <SortTh k="obj" sort={sort} setSort={setSort} title="Aktivitas tambahan (Building, Monster, MVP, Flag). Tidak dihitung ke skor.">Objective</SortTh>
              <SortTh k="afkweek" num sort={sort} setSort={setSort} title={`AFK dalam minggu ${weekLabel(weekStart(g.s.starts_at).getTime())}`}>AFK/mgg</SortTh>
              {cols.map(([k, l]) => (
                <SortTh key={k} k={k} num sort={sort} setSort={setSort} focus={focus.includes(k)}>{l}</SortTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.key} className={r.status === 'afk' ? 'is-afk-row' : r.status === 'missed' ? 'is-miss-row' : ''}>
                <td className="num muted" data-label="#">{i + 1}</td>
                <td data-label="Karakter">
                  <div className="act-char">
                    {r.m ? <JobIcon m={r.m} size={24} /> : null}
                    <div>
                      <b className="notranslate">{r.name}</b>
                      <div className="small muted">{r.job || r.m?.class || ''}</div>
                    </div>
                  </div>
                </td>
                <td data-label="Status">
                  <span className={`pill ${ST[r.status][1]}`}>{ST[r.status][0]}</span>
                </td>
                <td data-label="Peta">{r.maps.length ? <MapTags maps={r.maps} /> : '–'}</td>
                <td data-label="Peran">
                  {!r.role ? (
                    '–'
                  ) : isAdmin ? (
                    <select
                      className={`role-select role-${r.role} ${r.fixed ? 'is-fixed' : ''}`}
                      value={r.fixed ? r.role : ''}
                      disabled={busy}
                      onChange={(e) => setPendingRole({ r, role: e.target.value })}
                      title={r.fixed ? `Dikoreksi moderator (otomatis: ${ROLE_LABEL[r.auto]})` : 'Otomatis dari hasil war — pilih untuk mengoreksi'}
                    >
                      <option value="">{`Auto · ${ROLE_LABEL[r.auto]}`}</option>
                      {ROLES.map((k) => (
                        <option key={k} value={k}>
                          {ROLE_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`role-tag role-${r.role}`}>{ROLE_LABEL[r.role]}</span>
                  )}
                </td>
                <td data-label="Skor" className={`num ${r.score != null && r.score < LOW_SCORE ? 'text-red' : ''}`}>
                  {r.score == null ? '–' : `${Math.round(r.score * 100)}%`}
                </td>
                <td data-label="Objective">
                  {r.obj && r.obj.length ? (
                    <div className="obj-tags">
                      {r.obj.map((o) => (
                        <span key={o.k} className="obj-tag notranslate" title={o.label}>{`${o.icon} ${o.label} ${short(o.v)}`}</span>
                      ))}
                    </div>
                  ) : (
                    '–'
                  )}
                </td>
                <td data-label="AFK/mgg" className={`num ${(weekAfk.get(r.m?.id)?.afk || 0) >= 2 ? 'text-red' : ''}`}>
                  {r.m && weekAfk.get(r.m.id) ? `${weekAfk.get(r.m.id).afk}/${weekAfk.get(r.m.id).gl}` : '–'}
                  {r.m && weekAfk.get(r.m.id)?.miss ? <div className="small act-miss-txt">{`✗ ${weekAfk.get(r.m.id).miss} absent`}</div> : null}
                </td>
                {cols.map(([k, l]) => (
                  <td key={k} data-label={l} className={`num ${focus.includes(k) ? 'is-focus' : ''}`}>
                    {r.st ? (['player_dmg', 'endure', 'building_dmg', 'heal', 'boss_dmg'].includes(k) ? short(r.st[k]) : r.st[k]) : '–'}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={8 + cols.length} className="muted small">
                  Tidak ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pendingRole && (
        <RolePreview
          p={pendingRole}
          mapAvg={mapAvgs[pendingRole.r.maps[0]]}
          busy={busy}
          onCancel={() => setPendingRole(null)}
          onSave={() => setRole(pendingRole.r, pendingRole.role)}
        />
      )}
    </div>
  )
}

/** Perkiraan dampak sebelum peran dikoreksi: skor sekarang vs skor dengan peran baru */
function RolePreview({ p, mapAvg, busy, onCancel, onSave }) {
  const { r, role } = p
  const target = role || r.auto
  const label = { kills: 'Kill', assists: 'Assist', player_dmg: 'Damage', endure: 'Endure', heal: 'Heal', revives: 'Revive' }
  const fmt = (k, v) => (['player_dmg', 'endure', 'heal'].includes(k) ? short(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString('id-ID'))
  const n = mapAvg?.roleSize?.[target] || 0
  const peer = n >= 3
  const base = mapAvg ? (peer ? mapAvg.roleAvg[target] : mapAvg.overall) : {}
  const parts = ROLE_KEYS[target].map((k) => {
    const v = r.st?.[k] || 0
    const b = base[k] > 0 ? base[k] : mapAvg?.overall?.[k] || 0
    return { k, v, b, pct: b > 0 ? v / b : 0 }
  })
  const counted = parts.filter((x) => x.b > 0)
  const newScore = counted.length ? counted.reduce((t, x) => t + x.pct, 0) / counted.length : 0
  const afkNow = r.score < LOW_SCORE
  const afkNew = newScore < LOW_SCORE
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal role-preview" onClick={(e) => e.stopPropagation()}>
        <h3>{`Ganti peran ${r.name}?`}</h3>
        <div className="role-preview-cmp">
          <div>
            <div className="small muted">Sekarang</div>
            <span className={`role-tag role-${r.role}`}>{ROLE_LABEL[r.role]}</span>
            <b className={afkNow ? 'text-red' : ''}>{`${Math.round(r.score * 100)}%`}</b>
            {afkNow && <span className="pill pill-red">AFK</span>}
          </div>
          <div className="role-preview-arrow">→</div>
          <div>
            <div className="small muted">{role ? 'Jadi' : 'Kembali ke otomatis'}</div>
            <span className={`role-tag role-${target}`}>{ROLE_LABEL[target]}</span>
            <b className={afkNew ? 'text-red' : ''}>{`${Math.round(newScore * 100)}%`}</b>
            {afkNew && <span className="pill pill-red">AFK</span>}
          </div>
        </div>
        <div className="small">
          {`${ROLE_LABEL[target]} dinilai dari ${ROLE_KEYS[target].map((k) => label[k]).join(', ')}, ${peer ? `dibanding rata-rata ${n} ${ROLE_LABEL[target]} di peta ini` : `dibanding rata-rata semua pemain (hanya ${n} ${ROLE_LABEL[target]} di peta ini)`}:`}
        </div>
        <table className="table compact role-preview-table">
          <tbody>
            {parts.map((x) => (
              <tr key={x.k}>
                <td>{label[x.k]}</td>
                <td className="num notranslate">{fmt(x.k, x.v)}</td>
                <td className="num muted notranslate">{`÷ ${fmt(x.k, x.b)}`}</td>
                <td className="num">
                  <b>{`${Math.round(x.pct * 100)}%`}</b>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="is-best">
              <td colSpan={3} className="notranslate">{`Skor = (${counted.map((x) => `${Math.round(x.pct * 100)}%`).join(' + ')}) ÷ ${counted.length}`}</td>
              <td className="num">
                <b>{`${Math.round(newScore * 100)}%`}</b>
              </td>
            </tr>
          </tfoot>
        </table>
        <div className="small muted">
          {afkNow && !afkNew
            ? 'Setelah diganti, pemain ini tidak lagi dihitung AFK.'
            : !afkNow && afkNew
              ? 'Hati-hati: dengan peran ini pemain ini jadi dihitung AFK.'
              : 'Perkiraan; rata-rata peran bisa sedikit berubah setelah disimpan.'}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Batal
          </button>
          <button className="btn btn-gold" disabled={busy} onClick={onSave}>
            Simpan peran
          </button>
        </div>
      </div>
    </div>
  )
}

const weekLabel = (wk) => {
  const a = new Date(wk)
  const b = new Date(wk)
  b.setDate(b.getDate() + 6)
  return `${a.getDate()}–${b.getDate()} ${BULAN[b.getMonth()]}`
}
/** Label peta berwarna: Main = merah (serang bangunan), Sub = biru (jaga bendera) */
function MapTag({ k }) {
  return <span className={`map-tag map-${k}`}>{k === 'main' ? 'Main' : 'Sub'}</span>
}
const MapTags = ({ maps }) => (
  <span className="map-tags">
    {['main', 'sub'].filter((k) => maps.includes(k)).map((k) => (
      <MapTag key={k} k={k} />
    ))}
  </span>
)
const dateFmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function Activity() {
  const { members, isAdmin } = useApp()
  const [weeks, setWeeks] = useState(4) // 3 GL per minggu
  const [sessions, setSessions] = useState([])
  const [att, setAtt] = useState([])
  const [stats, setStats] = useState([])
  const [mapsMeta, setMapsMeta] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [fClass, setFClass] = useState('') // filter job
  const [fMap, setFMap] = useState('') // filter peta yang dimainkan
  const [fGl, setFGl] = useState('') // filter GL tertentu ('' = GL mana saja di periode)
  const [fGlSt, setFGlSt] = useState('') // status di GL itu
  const [fScore, setFScore] = useState('') // rentang skor
  const [hl, setHl] = useState(loadCols) // kolom yang disorot { cols: [n], only: tampilkan hanya kolom itu }
  const saveHl = (v) => {
    setHl(v)
    try { localStorage.setItem('act:hlcols', JSON.stringify(v)) } catch {}
  }
  const toggleCol = (n) => saveHl({ ...hl, cols: hl.cols.includes(n) ? hl.cols.filter((x) => x !== n) : [...hl.cols, n] })
  const hlCss = hl.cols.length
    ? hl.cols.map((n) => `.act-sumtbl tr:not(.act-detail) > :nth-child(${n}){background:rgba(227,180,90,.10);font-weight:600}.act-sumtbl thead th:nth-child(${n}){color:#e3b45a;background:#2f2a1f}`).join('') +
      (hl.only ? SUM_COLS.filter((c) => !hl.cols.includes(c.n)).map((c) => `.act-sumtbl tr:not(.act-detail) > :nth-child(${c.n}){display:none}`).join('') : '')
    : ''
  const [open, setOpen] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [glView, setGlView] = useState(null) // id sesi GL yang sedang dilihat (null = semua)
  const [histMonth, setHistMonth] = useState('') // bulan yang dipilih di dropdown Riwayat GL (YYYY-MM)
  const [sort, setSort] = useState({ k: '', dir: 1 })

  const load = useCallback(async () => {
    setLoading(true)
    const ss = await q(
      supabase
        .from('events')
        .select('id, title, starts_at, mode, parent_id')
        .not('parent_id', 'is', null)
        .eq('mode', 'guild_league')
        .order('starts_at', { ascending: false })
        .limit(60),
    )
    const ids = ss.map((s) => s.id)
    const [a, w, mm] = ids.length
      ? await Promise.all([
          q(supabase.from('attendance').select('event_id, member_id, status').in('event_id', ids)),
          q(supabase.from('war_stats').select('*').in('event_id', ids)),
          q(supabase.from('war_maps').select('*').in('event_id', ids)).catch(() => []),
        ])
      : [[], [], []]
    setMapsMeta(mm)
    setSessions([...ss].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)))
    setAtt(a)
    setStats(w)
    setLoading(false)
  }, [])
  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [load])

  // sesi dalam jendela (terbaru dulu), lalu dibalik untuk riwayat kiri → kanan
  const winSessions = useMemo(() => {
    const from = Date.now() - weeks * 7 * 86400e3
    return sessions.filter((s) => new Date(s.starts_at).getTime() >= from)
  }, [sessions, weeks])
  const winIds = useMemo(() => new Set(winSessions.map((s) => s.id)), [winSessions])
  const chrono = useMemo(() => [...winSessions].reverse(), [winSessions])
  // nomor GL dalam periode (1 = terbaru) + info data apa yang ada
  const glNo = useMemo(() => new Map(winSessions.map((s, i) => [s.id, i + 1])), [winSessions])
  const glInfo = useMemo(
    () =>
      winSessions.map((s) => {
        const mm = mapsMeta.filter((x) => x.event_id === s.id)
        const hasMap = (k) => mm.some((x) => x.map === k) || stats.some((x) => x.event_id === s.id && x.map === k)
        const maps = ['main', 'sub'].filter(hasMap)
        return { s, no: glNo.get(s.id), maps, enemy: mm[0]?.enemy_guild || '' }
      }),
    [winSessions, mapsMeta, stats, glNo],
  )

  const rows = useMemo(() => {
    const byMember = new Map()
    const get = (id) => {
      if (!byMember.has(id)) byMember.set(id, { att: new Map(), stats: new Map() })
      return byMember.get(id)
    }
    for (const a of att) if (winIds.has(a.event_id)) get(a.member_id).att.set(a.event_id, a.status)
    // rata-rata guild per peta, dan apakah musuh aktif di peta itu
    const byMap = new Map()
    for (const s of stats) {
      if (!winIds.has(s.event_id)) continue
      const key = `${s.event_id}-${s.map}`
      if (!byMap.has(key)) byMap.set(key, [])
      byMap.get(key).push(s)
    }
    const avgOf = new Map([...byMap].map(([k, rs]) => [k, mapAverages(rs)]))
    const metaOf = new Map(mapsMeta.map((m) => [`${m.event_id}-${m.map}`, m]))
    for (const s of stats) {
      if (!winIds.has(s.event_id) || !s.member_id) continue
      const key = `${s.event_id}-${s.map}`
      const meta = metaOf.get(key)
      const noEnemy = meta ? meta.enemy_active <= NO_ENEMY_MAX : false
      // skor dihitung per peta (Main dan Sub tidak digabung): dibanding rata-rata pemain BEBAS di peta itu saja
      const score = activityScore(s, avgOf.get(key))
      const pm = { score, noEnemy, weak: isIdle(s) || score < LOW_SCORE }
      const m = get(s.member_id)
      const cur = m.stats.get(s.event_id)
      if (!cur) m.stats.set(s.event_id, { ...s, maps: [s.map], per: { [s.map]: pm }, score, noEnemy, enemy: meta?.enemy_guild })
      else {
        for (const k of ['kills', 'assists', 'player_dmg', 'building_dmg', 'heal', 'endure', 'deaths', 'revives', 'boss_dmg', 'monsters', 'flag_repair']) cur[k] += s[k]
        cur.maps.push(s.map)
        cur.per[s.map] = pm
        // untuk tampilan ringkas: skor terendah (AFK di salah satu peta tidak tertutup peta lain)
        cur.score = Math.min(cur.score, score)
        cur.noEnemy = cur.noEnemy && noEnemy
      }
    }
    const withStatsSessions = new Set(stats.filter((s) => winIds.has(s.event_id)).map((s) => s.event_id))
    // GL yang punya catatan kehadiran (tanpa hasil war): pemain aktif yang tidak tercatat = tidak hadir
    const withAttSessions = new Set(att.filter((a) => winIds.has(a.event_id)).map((a) => a.event_id))
    return members
      .filter((m) => m.active)
      .map((m) => {
        const d = byMember.get(m.id) || { att: new Map(), stats: new Map() }
        const hist = chrono.map((s) => {
          const st = d.stats.get(s.id)
          // GL yang punya hasil war: tidak ada di hasil = tidak ikut war (status sendiri, bukan AFK; kecuali izin)
          const missed = !st && withStatsSessions.has(s.id) && d.att.get(s.id) !== 'excused'
          const noshow = !st && !missed && !d.att.get(s.id) && withAttSessions.has(s.id)
          // tidak tercatat: ditampilkan, tapi tidak dihitung absen (catatan GL tanpa hasil war berasal dari papan party, bisa tidak lengkap)
          // tidak ada di hasil war / tidak tercatat = Absent (skor 0), kecuali izin
          const a = missed || noshow ? 'absent' : d.att.get(s.id) || (st ? 'present' : null)
          // AFK = skor di bawah 25% rata-rata guild (termasuk 0), hanya kalau musuh ada
          // AFK dinilai per peta: AFK kalau di salah satu peta yang dia mainkan skornya < 25% dan musuh ada
          const pms = st ? Object.values(st.per) : []
          const idle = pms.some((p) => p.weak && !p.noEnemy)
          const noEnemy = !idle && pms.some((p) => p.weak && p.noEnemy)
          const low = false
          return { s, a, st, idle, noEnemy, low, missed, noshow }
        })
        const counted = hist.filter((h) => h.a)
        const present = counted.filter((h) => h.a === 'present').length
        const absent = counted.filter((h) => h.a === 'absent').length
        const excused = counted.filter((h) => h.a === 'excused').length
        const afk = hist.filter((h) => h.a === 'present' && h.idle).length
        const missedN = hist.filter((h) => h.missed || h.noshow).length
        const lowWars = hist.filter((h) => h.a === 'present' && h.low).length
        // rata-rata skor per peta (Main dan Sub terpisah); peta tanpa musuh aktif tidak dihitung
        const mapScores = { main: [], sub: [] }
        for (const h of hist) if (h.st) for (const [k, p] of Object.entries(h.st.per)) if (!p.noEnemy) mapScores[k].push(p.score)
        const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null)
        const avgByMap = { main: mean(mapScores.main), sub: mean(mapScores.sub) }
        // GL yang absen dihitung skor 0 di rata-rata keseluruhan
        const absentZeros = hist.filter((h) => h.missed || h.noshow).map(() => 0)
        const allScores = [...mapScores.main, ...mapScores.sub, ...absentZeros]
        const scored = allScores
        const avgScore = mean(allScores)
        // war dengan data hasil game yang tidak memuat pemain ini (tidak masuk peta)
        const withStats = hist.filter((h) => h.st)
        const sum = (k) => withStats.reduce((t, h) => t + (h.st[k] || 0), 0)
        const per = (k) => (withStats.length ? sum(k) / withStats.length : 0)
        const denom = present + absent
        const pct = denom ? present / denom : null
        const last2 = counted.slice(-2)
        let st = 'nodata'
        if (counted.length) {
          if (pct < 0.5 || (last2.length === 2 && last2.every((h) => h.a === 'absent'))) st = 'inactive'
          // 1x skor 0 / rendah masih dimaklumi (disconnect, telat masuk, dsb.); baru ditandai kalau berulang
          else if (afk + lowWars >= 2 || (avgScore != null && scored.length >= 2 && avgScore < LOW_SCORE)) st = 'afk'
          else if (pct >= 0.75) st = 'active'
          else st = 'low'
        }
        // AFK per minggu (Sen–Min): berapa kali AFK dari GL yang punya hasil war di minggu itu
        const weekAfk = new Map()
        for (const h of hist) {
          const wk = weekStart(h.s.starts_at).getTime()
          const w = weekAfk.get(wk) || { afk: 0, gl: 0 }
          if (h.st || h.a) w.gl++
          if (h.a === 'present' && h.idle) w.afk++
          if (h.missed || h.noshow) w.miss = (w.miss || 0) + 1
          weekAfk.set(wk, w)
        }
        let maxWeek = null
        for (const [wk, w] of weekAfk) if (w.afk && (!maxWeek || w.afk > maxWeek.afk)) maxWeek = { wk, ...w }
        const lastSeen = [...hist].reverse().find((h) => h.a === 'present')?.s.starts_at
        // AFK di war terakhir yang punya data hasil (1x dimaklumi, tapi tetap ditampilkan)
        const lastWithStats = [...hist].reverse().find((h) => h.st)
        const lastGl = [...hist].reverse().find((h) => h.st || h.missed || h.noshow)
        const lastAfk = !!(lastGl && lastGl.a === 'present' && lastGl.idle)
        const lastMissed = !!(lastGl?.missed || lastGl?.noshow)
        return {
          m,
          hist,
          present,
          absent,
          excused,
          afk,
          lowWars,
          avgScore,
          avgByMap,
          lastAfk,
          weekAfk,
          maxWeek,
          lastScore: lastWithStats?.st?.score ?? null,
          lastMissed,
          missedN,
          glWithStats: new Set([...withStatsSessions, ...withAttSessions]).size,
          pct,
          st,
          lastSeen,
          warsWithStats: withStats.length,
          avg: { kills: per('kills'), assists: per('assists'), player_dmg: per('player_dmg'), building_dmg: per('building_dmg'), heal: per('heal'), deaths: per('deaths'), revives: per('revives'), boss_dmg: per('boss_dmg') },
          missingFromResult: withStatsSessions.size ? [...withStatsSessions].filter((id) => !d.stats.has(id)).length : 0,
        }
      })
  }, [members, att, stats, mapsMeta, winIds, chrono])

  const classes = useMemo(() => [...new Set(rows.map((r) => r.m.class).filter(Boolean))].sort(), [rows])
  const anyFilter = !!(search || fClass || fMap || fGlSt || fScore || status)
  const resetFilters = () => { setSearch(''); setFClass(''); setFMap(''); setFGl(''); setFGlSt(''); setFScore(''); setStatus('') }
  const counts = useMemo(() => {
    const c = { active: 0, low: 0, afk: 0, inactive: 0, nodata: 0, lastafk: 0, lastmiss: 0 }
    for (const r of rows) c[r.st]++
    c.lastafk = rows.filter((r) => r.lastAfk).length
    c.lastmiss = rows.filter((r) => r.lastMissed).length
    return c
  }, [rows])

  const shown = rows
    .filter((r) => !status || (status === 'lastafk' ? r.lastAfk : status === 'lastmiss' ? r.lastMissed : r.st === status))
    .filter((r) => !search.trim() || r.m.name.toLowerCase().includes(search.trim().toLowerCase()) || (r.m.class || '').toLowerCase().includes(search.trim().toLowerCase()))
    .filter((r) => !fClass || r.m.class === fClass)
    .filter((r) => !fMap || r.hist.some((h) => h.st?.maps.includes(fMap)))
    .filter((r) => !fGlSt || r.hist.some((h) => (!fGl || String(h.s.id) === fGl) && histKey(h) === fGlSt))
    .filter((r) => !fScore || SCORE_BANDS[fScore](r.avgScore))
    .sort((a, b) => {
      if (sort.k) {
        const v = SUM_SORT[sort.k]
        const x = v(a), y = v(b)
        if (x !== y) return (x == null ? 1 : y == null ? -1 : (x < y ? -1 : 1) * sort.dir)
      }
      return STATUS[a.st].rank - STATUS[b.st].rank || (a.pct ?? 2) - (b.pct ?? 2) || a.m.name.localeCompare(b.m.name)
    })
  // GL yang dipilih: dari periode, atau dari riwayat (di luar periode)
  const glSel = useMemo(() => {
    const inWin = glInfo.find((g) => g.s.id === glView)
    if (inWin || glView == null) return inWin
    const s = sessions.find((x) => x.id === glView)
    if (!s) return undefined
    const mm = mapsMeta.filter((x) => x.event_id === s.id)
    const maps = ['main', 'sub'].filter((k) => mm.some((x) => x.map === k) || stats.some((x) => x.event_id === s.id && x.map === k))
    return { s, no: '•', maps, enemy: mm[0]?.enemy_guild || '' }
  }, [glInfo, glView, sessions, mapsMeta, stats])
  // Riwayat GL: tombol bulan 1–12, lalu per minggu War 1/2/3
  const histYears = useMemo(() => [...new Set(sessions.map((x) => new Date(x.starts_at).getFullYear()))].sort((a, b) => b - a), [sessions])
  const [histYear, setHistYear] = useState(null)
  const year = histYear ?? histYears[0] ?? new Date().getFullYear()
  const monthCount = useMemo(() => {
    const c = new Array(12).fill(0)
    for (const x of sessions) {
      const t = new Date(x.starts_at)
      if (t.getFullYear() === year) c[t.getMonth()]++
    }
    return c
  }, [sessions, year])
  const latestMonth = useMemo(() => {
    for (let m = 11; m >= 0; m--) if (monthCount[m]) return m
    return new Date().getMonth()
  }, [monthCount])
  const month = histMonth === '' ? latestMonth : Number(histMonth)
  const histWeeks = useMemo(() => {
    const inMonth = sessions.filter((x) => {
      const t = new Date(x.starts_at)
      return t.getFullYear() === year && t.getMonth() === month
    })
    return groupByWeek(inMonth).map((w) => ({
      ...w,
      list: w.list.map(({ s: ss, n }) => {
        const mm = mapsMeta.find((x) => x.event_id === ss.id)
        return { s: ss, n, enemy: mm?.enemy_guild || '', hasStats: stats.some((x) => x.event_id === ss.id) }
      }),
    }))
  }, [sessions, year, month, mapsMeta, stats])
  const afkPerGl = useMemo(() => {
    const c = new Map()
    for (const r of rows) for (const h of r.hist) if (h.a === 'present' && h.idle) c.set(h.s.id, (c.get(h.s.id) || 0) + 1)
    return c
  }, [rows])
  const missPerGl = useMemo(() => {
    const c = new Map()
    for (const r of rows) for (const h of r.hist) if (h.missed) c.set(h.s.id, (c.get(h.s.id) || 0) + 1)
    return c
  }, [rows])

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Aktivitas Guild League</h1>
          <p className="muted">
            Cek siapa yang aktif di Guild League dari kehadiran dan hasil war di game (kill, damage, heal). Pemain yang masuk peta tapi tidak
            melakukan apa-apa ditandai AFK.
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn-gold" onClick={() => setImportOpen(true)}>
            ⬆ Import hasil war
          </button>
        )}
      </div>

      <div className="act-filters">
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          {[1, 2, 4, 8, 12].map((n) => (
            <option key={n} value={n}>{`${n} minggu terakhir (±${n * 3} war)`}</option>
          ))}
        </select>
        <input placeholder="Cari nama / class…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={fClass} onChange={(e) => setFClass(e.target.value)} title="Filter job">
          <option value="">Semua job</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={fMap} onChange={(e) => setFMap(e.target.value)} title="Filter peta yang dimainkan">
          <option value="">Semua peta</option>
          <option value="main">Main</option>
          <option value="sub">Sub</option>
        </select>
        <select value={fScore} onChange={(e) => setFScore(e.target.value)} title="Filter rata-rata skor">
          <option value="">Semua skor</option>
          <option value="hi">Skor ≥ 75%</option>
          <option value="mid">Skor 25–75%</option>
          <option value="lo">Skor &lt; 25% (AFK)</option>
          <option value="none">Belum ada skor</option>
        </select>
        <select value={fGlSt} onChange={(e) => setFGlSt(e.target.value)} title="Filter status di GL">
          <option value="">Status di GL: semua</option>
          <option value="present">Hadir</option>
          <option value="afk">AFK</option>
          <option value="absent">Absent</option>
          <option value="excused">Izin</option>
        </select>
        {fGlSt && (
          <select value={fGl} onChange={(e) => setFGl(e.target.value)} title="Di GL yang mana">
            <option value="">di GL mana saja</option>
            {glInfo.map((g) => (
              <option key={g.s.id} value={String(g.s.id)}>
                {`${g.no}. ${glStage(g.s.starts_at)} · ${glLabel(g.s.starts_at)}`}
              </option>
            ))}
          </select>
        )}
        {anyFilter && (
          <button type="button" className="btn btn-ghost" onClick={resetFilters}>
            ✕ Reset filter
          </button>
        )}
      </div>

      <div className="act-tiles">
        {['active', 'low', 'afk', 'inactive', 'nodata', 'lastafk', 'lastmiss'].map((k) => (
          <button key={k} className={`act-tile ${status === k ? 'is-on' : ''} act-${k}`} onClick={() => setStatus(status === k ? '' : k)}>
            <b>{counts[k]}</b>
            <span>{k === 'lastafk' ? 'AFK di war terakhir' : k === 'lastmiss' ? 'Absent di GL terakhir' : STATUS[k].label}</span>
          </button>
        ))}
      </div>

      {glInfo.length > 0 && (
        <div className="act-gls">
          <button type="button" className={`act-gl act-gl-all ${glView == null ? 'is-on' : ''}`} onClick={() => setGlView(null)}>
            <span className="act-gl-no">Σ</span>
            <div>
              <b>Semua GL</b>
              <div className="small muted">Ringkasan periode</div>
            </div>
          </button>
          {glInfo.slice(0, 5).map((g) => (
            <button
              type="button"
              key={g.s.id}
              className={`act-gl ${g.maps.length ? 'has-stats' : ''} ${glView === g.s.id ? 'is-on' : ''}`}
              onClick={() => setGlView(glView === g.s.id ? null : g.s.id)}
              title="Klik untuk lihat detail GL ini"
            >
              <span className="act-gl-no">{g.no}</span>
              <div>
                <b>{glStage(g.s.starts_at)}</b> <span className="small muted">{glLabel(g.s.starts_at)}</span>
                <div className="small muted">
                  {g.maps.length ? (
                    <>
                      {afkPerGl.get(g.s.id) ? <span className="text-red">{`⚠ ${afkPerGl.get(g.s.id)} AFK`}</span> : null}
                      {missPerGl.get(g.s.id) ? <span className="act-miss-txt">{`✗ ${missPerGl.get(g.s.id)} absent`}</span> : null}
                      <MapTags maps={g.maps} />
                      {g.enemy ? <span>{`vs ${g.enemy}`}</span> : null}
                    </>
                  ) : (
                    'Absen saja (belum ada hasil war)'
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {glInfo.length > 5 && (
        <p className="small muted act-more-gl">{`Menampilkan 5 GL terakhir. ${glInfo.length - 5} GL lainnya: lihat di Riwayat GL di bawah.`}</p>
      )}
      {sessions.length > 0 && (
        <div className="act-hist2">
          <div className="act-hist2-months">
            <span className="small muted">Riwayat GL</span>
            {histYears.length > 1 && (
              <select value={year} onChange={(e) => { setHistYear(Number(e.target.value)); setHistMonth('') }}>
                {histYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
            {BULAN.map((b, i) => (
              <button
                key={b}
                type="button"
                disabled={!monthCount[i]}
                className={`act-month ${month === i ? 'is-on' : ''}`}
                onClick={() => setHistMonth(String(i))}
                title={monthCount[i] ? `${monthCount[i]} GL` : 'Belum ada GL'}
              >
                {b}
              </button>
            ))}
          </div>
          {histWeeks.length > 0 && (
            <div className="act-hist2-weeks">
              {histWeeks
                .slice()
                .reverse()
                .map((w) => (
                  <div key={w.start.getTime()} className="act-hist2-week">
                    <span className="small muted">{w.label}</span>
                    {w.list.map((h) => (
                      <button
                        key={h.s.id}
                        type="button"
                        className={`act-war ${glView === h.s.id ? 'is-on' : ''} ${h.hasStats ? 'has-stats' : ''}`}
                        onClick={() => setGlView(glView === h.s.id ? null : h.s.id)}
                        title={`${glStage(h.s.starts_at)} · ${glLabel(h.s.starts_at)}${h.enemy ? ` · vs ${h.enemy}` : ''}`}
                      >
                        <b>{glStage(h.s.starts_at)}</b>
                        <span>{h.hasStats ? h.enemy || glLabel(h.s.starts_at) : glLabel(h.s.starts_at)}</span>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {glSel && (
        <GlDetail
          g={glSel}
          members={members}
          att={att.filter((a) => a.event_id === glSel.s.id)}
          stats={stats.filter((x) => x.event_id === glSel.s.id)}
          meta={mapsMeta.filter((x) => x.event_id === glSel.s.id)}
          search={search}
          weekAfk={new Map(rows.map((r) => [r.m.id, r.weekAfk.get(weekStart(glSel.s.starts_at).getTime())]))}
          onBack={() => setGlView(null)}
          onChanged={load}
        />
      )}

      {!glSel && (<>
      <p className="muted small">
        {winSessions.length
          ? `${winSessions.length} war dihitung: ${dateFmt(winSessions[winSessions.length - 1].starts_at)} – ${dateFmt(winSessions[0].starts_at)}. ` +
            'Tidak aktif = hadir < 50% atau absen 2 war terakhir. Aktif = hadir ≥ 75%. Peran (DPS/Tank/Healer) ditentukan otomatis dari angka hasil war dan bisa dikoreksi moderator. Skor = rata-rata semua kategori perannya, masing-masing dibanding rata-rata sesama peran di peta itu; Main dan Sub dihitung terpisah (100% = rata-rata). Objective (Building, Monster, MVP, Flag) hanya status khusus, tidak masuk skor. Skor di bawah 25% = AFK. Absent = tidak ada di hasil war atau tidak tercatat (status sendiri, skor 0, bukan AFK). 1x AFK masih dimaklumi, baru "Perlu dicek" kalau 2x atau lebih. AFK tidak dihitung kalau musuh tidak ada.'
          : loading
            ? 'Memuat…'
            : 'Belum ada war Guild League yang dikonfirmasi.'}
      </p>

      <div className="act-hlcols">
        <span className="small muted">Sorot kolom:</span>
        {SUM_COLS.map((c) => (
          <button key={c.n} type="button" className={hl.cols.includes(c.n) ? 'is-on' : ''} onClick={() => toggleCol(c.n)}>
            {c.label}
          </button>
        ))}
        {hl.cols.length > 0 && (
          <>
            <label className="act-hlonly small">
              <input type="checkbox" checked={hl.only} onChange={(e) => saveHl({ ...hl, only: e.target.checked })} /> Tampilkan hanya kolom ini
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveHl({ cols: [], only: false })}>
              ✕ Hapus sorotan
            </button>
          </>
        )}
      </div>
      {hlCss && <style>{hlCss}</style>}
      <div className="table-wrap card flush act-scroll">
        <table className="table table-cards act-table act-sumtbl">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} setSort={setSort}>Karakter</SortTh>
              <SortTh k="status" sort={sort} setSort={setSort}>Status</SortTh>
              <SortTh k="pct" sort={sort} setSort={setSort}>Hadir</SortTh>
              <SortTh k="hist" num sort={sort} setSort={setSort} title="Urutkan: paling sering hadir (tanpa AFK) dulu">{`Riwayat GL (1 terbaru → ${Math.min(chrono.length, 5) || '…'} terlama)`}</SortTh>
              <SortTh k="score" num sort={sort} setSort={setSort}>Skor</SortTh>
              <SortTh k="kills" num sort={sort} setSort={setSort}>Kill / Assist</SortTh>
              <SortTh k="dmg" num sort={sort} setSort={setSort}>Damage</SortTh>
              <SortTh k="heal" num sort={sort} setSort={setSort}>Heal</SortTh>
              <SortTh k="missed" num sort={sort} setSort={setSort} title="Berapa kali Absent (tidak ada di hasil war atau tidak tercatat) dari GL yang tercatat">Absent</SortTh>
              <SortTh k="afkweek" num sort={sort} setSort={setSort} title="AFK terbanyak dalam 1 minggu (Senin–Minggu) di periode ini">AFK / minggu</SortTh>
              <SortTh k="last" sort={sort} setSort={setSort}>Terakhir hadir</SortTh>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.m.id}>
                <tr className="clickable" onClick={() => setOpen(open === r.m.id ? null : r.m.id)}>
                  <td data-label="Karakter">
                    <div className="act-char">
                      <JobIcon m={r.m} size={28} />
                      <div>
                        <b className="notranslate">{r.m.name}</b>
                        <div className="small muted">{r.m.class}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Status">
                    <span className={`pill ${STATUS[r.st].cls}`}>{STATUS[r.st].label}</span>
                    {r.lastAfk && <span className="pill pill-orange act-lastafk">{`AFK terakhir · skor ${Math.round((r.lastScore || 0) * 100)}%`}</span>}
                    {r.lastMissed && <span className="pill pill-miss act-lastafk">Absent di GL terakhir</span>}
                  </td>
                  <td data-label="Hadir">{r.pct == null ? '–' : `${r.present}/${r.present + r.absent} · ${Math.round(r.pct * 100)}%`}</td>
                  <td data-label="Riwayat">
                    <div className="act-dots">
                      {[...r.hist].reverse().slice(0, 5).map((h) => (
                        <span
                          key={h.s.id}
                          data-no={glNo.get(h.s.id)}
                          className={`act-dot ${h.missed || h.noshow ? 'is-miss' : h.a === 'present' ? (h.idle ? 'is-afk' : h.low ? 'is-low' : h.noEnemy ? 'is-ne' : 'is-p') : h.a === 'absent' ? 'is-a' : h.a === 'excused' ? 'is-e' : ''}`}
                          title={`${glNo.get(h.s.id)}. ${glStage(h.s.starts_at)} · ${glLabel(h.s.starts_at)}: ${h.missed || h.noshow ? 'Absent (skor 0)' : h.a === 'present' ? (h.idle ? `hadir tapi AFK (skor terendah ${Math.round(h.st.score * 100)}%)` : h.noEnemy ? 'hadir, tidak ada musuh' : `hadir (skor ${h.st ? Math.round(h.st.score * 100) + '%' : '–'})`) : h.a === 'absent' ? 'absen' : h.a === 'excused' ? 'izin' : 'tidak terdaftar'}`}
                        />
                      ))}
                    </div>
                  </td>
                  <td data-label="Skor" className={`num ${r.avgScore != null && r.avgScore < LOW_SCORE ? 'text-red' : ''}`}>
                    {r.avgScore == null ? (
                      '–'
                    ) : (
                      <div className="act-mapscores">
                        {['main', 'sub']
                          .filter((k) => r.avgByMap[k] != null)
                          .map((k) => (
                            <span key={k} className={r.avgByMap[k] < LOW_SCORE ? 'text-red' : ''}>
                              <MapTag k={k} /> {`${Math.round(r.avgByMap[k] * 100)}%`}
                            </span>
                          ))}
                      </div>
                    )}
                  </td>
                  <td data-label="Kill / Assist" className="num">
                    {r.warsWithStats ? `${r.avg.kills.toFixed(1)} / ${r.avg.assists.toFixed(1)}` : '–'}
                  </td>
                  <td data-label="Damage" className="num">
                    {r.warsWithStats ? short(Math.round(r.avg.player_dmg)) : '–'}
                  </td>
                  <td data-label="Heal" className="num">
                    {r.warsWithStats ? short(Math.round(r.avg.heal)) : '–'}
                  </td>
                  <td data-label="Absent" className="num">
                    {r.glWithStats ? <span className={r.missedN ? 'act-miss-txt' : 'muted'}>{`${r.missedN}× / ${r.glWithStats}`}</span> : '–'}
                  </td>
                  <td data-label="AFK / minggu" className={`num ${r.maxWeek?.afk >= 2 ? 'text-red' : ''}`}>
                    {r.maxWeek ? `${r.maxWeek.afk}/${r.maxWeek.gl} · ${weekLabel(r.maxWeek.wk)}` : '–'}
                  </td>
                  <td data-label="Terakhir hadir">{r.lastSeen ? dateFmt(r.lastSeen) : '–'}</td>
                </tr>
                {open === r.m.id && (
                  <tr className="act-detail">
                    <td colSpan={11}>
                      <div className="act-detail-grid">
                        {r.hist
                          .filter((h) => h.a || h.st)
                          .reverse()
                          .map((h) => (
                            <div key={h.s.id} className="act-war">
                              <div className="act-war-head">
                                <span className="act-gl-no">{glNo.get(h.s.id)}</span>
                                <b>{glLabel(h.s.starts_at)}</b>
                              </div>
                              <div>
                                <b>{h.missed || h.noshow ? 'Absent · skor 0' : h.a === 'present' ? (h.idle ? 'Hadir · AFK' : h.noEnemy ? 'Hadir · tidak ada musuh' : 'Hadir') : h.a === 'absent' ? 'Absen' : h.a === 'excused' ? 'Izin' : '–'}</b>
                                {h.st && (
                                  <span className="small muted">
                                    {' '}
                                    {['main', 'sub']
                                      .filter((k) => h.st.per[k])
                                      .map((k) => (
                                        <span key={k} className={h.st.per[k].weak && !h.st.per[k].noEnemy ? 'text-red' : ''}>
                                          <MapTag k={k} /> {`${Math.round(h.st.per[k].score * 100)}% `}
                                        </span>
                                      ))}
                                    {h.st.enemy ? `vs ${h.st.enemy}` : ''}
                                  </span>
                                )}
                              </div>
                              {h.st && (
                                <div className="small notranslate">
                                  {`K ${h.st.kills} · A ${h.st.assists} · D ${h.st.deaths} · Dmg ${short(h.st.player_dmg)} · Bld ${short(h.st.building_dmg)} · Heal ${short(h.st.heal)} · Rev ${h.st.revives} · Boss ${short(h.st.boss_dmg)}`}
                                </div>
                              )}
                            </div>
                          ))}
                        {!r.hist.some((h) => h.a || h.st) && <span className="muted small">Belum ada data war.</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      </>)}

      {importOpen && <ImportWar sessions={sessions} statSessions={new Set(stats.map((x) => x.event_id))} onClose={() => setImportOpen(false)} onDone={load} />}
    </div>
  )
}

/** Moderator: tempel / upload tabel hasil war (Main & Sub) → simpan statistik + kehadiran */
function ImportWar({ sessions, statSessions, onClose, onDone }) {
  const { members, toast } = useApp()
  const [run, busy] = useAction()
  const weeksList = useMemo(() => weekSlots(sessions, 4), [sessions])
  // default: slot paling baru yang sudah lewat dan belum diinput
  const [sid, setSid] = useState(() => {
    for (const w of weekSlots(sessions, 4)) for (const sl of [...w.slots].reverse()) if (!sl.future && !(sl.s && statSessions.has(sl.s.id))) return sl.key
    return sessions[0] ? String(sessions[0].id) : ''
  })
  const [newAt, setNewAt] = useState({})
  const slot = weeksList.flatMap((w) => w.slots).find((x) => x.key === String(sid))
  const picked = slot?.s || sessions.find((s) => String(s.id) === String(sid))
  const isNew = String(sid).startsWith('new:')
  const atOf = (sl) => newAt[sl.key] ?? sl.at
  const [maps, setMaps] = useState({ main: '', sub: '' })
  const [guild, setGuild] = useState('')
  const [markAtt, setMarkAtt] = useState(true)
  const names = useMemo(() => new Set(members.map((m) => m.name.toLowerCase())), [members])

  const parsed = useMemo(() => {
    const out = {}
    for (const k of ['main', 'sub']) out[k] = maps[k].trim() ? parseWarResult(maps[k]) : null
    return out
  }, [maps])
  // guild kita = guild dengan nama paling banyak cocok dengan roster
  const guilds = useMemo(() => {
    const score = {}
    for (const p of Object.values(parsed)) for (const r of p?.rows || []) score[r.guild] = (score[r.guild] || 0) + (names.has(r.name.toLowerCase()) ? 1 : 0)
    return Object.entries(score).sort((a, b) => b[1] - a[1]).map(([g]) => g)
  }, [parsed, names])
  const g = guild || guilds[0] || ''
  const ours = (k) => (parsed[k]?.rows || []).filter((r) => r.guild === g)

  const readFile = (k, f) => {
    if (!f) return
    const fr = new FileReader()
    fr.onload = () => {
      const text = String(fr.result)
      // taruh otomatis di kotak yang benar kalau petanya jelas (Flag Repair = Sub, Building Damage = Main)
      const guess = detectMap(parseWarResult(text))
      setMaps((x) => ({ ...x, [guess && !x[guess].trim() ? guess : k]: text }))
    }
    fr.readAsText(f)
  }

  const save = () =>
    run(async () => {
      // slot kosong → buat sesi GL dulu (tanpa party), lalu isi hasilnya
      const eventId = isNew ? await rpc('create_gl_session', { p_played_at: new Date(atOf(slot)).toISOString() }) : Number(sid)
      let total = 0
      const unmatched = new Set()
      for (const k of ['main', 'sub']) {
        const rows = ours(k)
        if (!rows.length) continue
        const r = await rpc('import_war_stats', { p_event_id: eventId, p_map: k, p_rows: rows, p_meta: enemySummary(parsed[k].rows, g) })
        total += r?.rows ?? rows.length
        for (const u of r?.unmatched || []) unmatched.add(u)
      }
      if (markAtt) {
        // kehadiran dari semua peta yang tersimpan untuk sesi ini (main + sub)
        const all = await q(supabase.from('war_stats').select('name').eq('event_id', eventId))
        await rpc('import_attendance', { p_event_id: eventId, p_names: all.map((x) => x.name), p_filename: 'hasil war (aktivitas)' })
      }
      await onDone()
      onClose()
      toast(`${total} baris hasil war disimpan${unmatched.size ? ` · ${unmatched.size} nama tidak ada di roster: ${[...unmatched].join(', ')}` : ''}`)
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal act-import" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⬆ Import hasil war</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="field">
          <span>Pilih Guild League yang mau diinput</span>
          <div className="act-pick">
            {weeksList.map((w, wi) => (
              <div key={w.start.getTime()} className="act-pick-week">
                <div className="small muted">{wi === 0 ? `Minggu ini · ${w.label}` : `Minggu ${w.label}`}</div>
                <div className="act-pick-row">
                  {w.slots.map((sl) => {
                    const done = sl.s && statSessions.has(sl.s.id)
                    return (
                      <button
                        key={sl.key}
                        type="button"
                        className={`act-pick-btn ${String(sid) === sl.key ? 'is-on' : ''} ${done ? 'is-done' : ''} ${sl.s ? '' : 'is-empty'}`}
                        onClick={() => setSid(sl.key)}
                      >
                        <b>{stageOfSlot(sl.n)}</b>
                        <span>{glLabel(sl.s ? sl.s.starts_at : atOf(sl))}</span>
                        <em>{done ? '✓ sudah diinput' : sl.s ? 'ada absen · belum ada hasil' : sl.future ? 'belum main' : '➕ belum diinput'}</em>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {isNew && slot && (
            <label className="field act-new-at">
              <span>{`Tanggal & jam ${stageOfSlot(slot.n)} (ubah kalau beda)`}</span>
              <input type="datetime-local" value={atOf(slot)} onChange={(e) => setNewAt((x) => ({ ...x, [slot.key]: e.target.value }))} />
            </label>
          )}
          {picked && statSessions.has(picked.id) && (
            <div className="banner small">{`${glStage(picked.starts_at)} ${glLabel(picked.starts_at)} sudah punya hasil war. Kalau disimpan lagi, data peta yang ditempel akan diganti.`}</div>
          )}
        </div>
        <label className="field act-pick-all">
          <span className="small muted">Atau pilih dari semua sesi</span>
          <select value={isNew ? '' : sid} onChange={(e) => setSid(e.target.value)}>
            {isNew && <option value="">–</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {`${glLabel(s.starts_at)}${statSessions.has(s.id) ? ' · sudah ada hasil war' : ''}`}
              </option>
            ))}
          </select>
        </label>
        <div className="act-maps">
          {['main', 'sub'].map((k) => (
            <div key={k} className="field">
              <span>
                <MapTag k={k} /> {k === 'main' ? 'Hasil Main (tempel tabel atau pilih file)' : 'Hasil Sub (tempel tabel atau pilih file)'}
              </span>
              <textarea rows={5} value={maps[k]} placeholder="Guild	Player	Job	Kill	Assist	…" onChange={(e) => setMaps((x) => ({ ...x, [k]: e.target.value }))} />
              <div className="act-paste-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      const t = await navigator.clipboard.readText()
                      if (t) setMaps((x) => ({ ...x, [k]: t }))
                    } catch {
                      toast('Browser tidak mengizinkan baca clipboard. Klik kotak lalu tekan Ctrl+V.', 'err')
                    }
                  }}
                >
                  📋 Tempel
                </button>
                <input type="file" accept=".txt,.csv,.tsv" onChange={(e) => readFile(k, e.target.files?.[0])} />
              </div>
              {parsed[k] && !parsed[k].error && detectMap(parsed[k]) && detectMap(parsed[k]) !== k && (
                <div className="act-mapwarn small">
                  {detectMap(parsed[k]) === 'sub'
                    ? 'Sepertinya ini hasil Sub (ada Flag Repair / tanpa Building Damage).'
                    : 'Sepertinya ini hasil Main (ada Building Damage).'}{' '}
                  <button type="button" className="btn btn-sm" onClick={() => setMaps((x) => ({ main: x.sub, sub: x.main }))}>
                    ⇄ Tukar Main / Sub
                  </button>
                </div>
              )}
              {parsed[k] && (
                <div className="small muted">
                  {parsed[k].error
                    ? parsed[k].error
                    : (() => {
                        const e = enemySummary(parsed[k].rows, g)
                        return `${ours(k).length} pemain ${g} · ${ours(k).filter((r) => !names.has(r.name.toLowerCase())).length} tidak ada di roster · ${ours(k).filter(isIdle).length} AFK · lawan ${e.enemy_guild ?? '-'}: ${e.enemy_active}/${e.enemy_players} aktif`
                      })()}
                </div>
              )}
            </div>
          ))}
        </div>
        {guilds.length > 1 && (
          <label className="field">
            <span>Guild kita</span>
            <select value={g} onChange={(e) => setGuild(e.target.value)}>
              {guilds.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        )}
        <label className="mp-row">
          <input type="checkbox" checked={markAtt} onChange={(e) => setMarkAtt(e.target.checked)} />
          <span>Isi kehadiran juga: yang ada di hasil = hadir, pemain di papan yang tidak ada = absen</span>
        </label>
        <div className="mp-actions">
          <button className="btn btn-gold" disabled={busy || !sid || !(ours('main').length + ours('sub').length)} onClick={save}>
            {`Simpan (${ours('main').length + ours('sub').length} baris)`}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
        </div>
      </div>
    </div>
  )
}
