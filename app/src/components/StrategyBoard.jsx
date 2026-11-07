import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, rpc } from '../lib/supabase.js'
import JobIcon from './JobIcon.jsx'
import { useApp } from '../context.jsx'
import mainMap from '../assets/maps/gl-main.webp'
import subMap from '../assets/maps/gl-sub.webp'

// Strategi perang Guild League: taruh party / anggota / penanda di peta Main & Sub.
// Posisi disimpan dalam persen peta, tersinkron realtime ke semua yang membuka papan.
const MAPS = {
  main: { img: mainMap, label: 'Peta Main' },
  sub: { img: subMap, label: 'Peta Sub' },
}
const NOTE_COLORS = ['#f2c14e', '#ef6b6b', '#5fb3ff', '#5ad08a', '#c08cff']
const uid = () => Math.random().toString(36).slice(2, 9)
const clamp = (v) => Math.min(97, Math.max(3, v))

export default function StrategyBoard({ ev, secs, size, parties, signups, memberById, partyName, leaderOf, canEdit, toast, user }) {
  const [map, setMap] = useState('main')
  const [items, setItems] = useState({ main: [], sub: [] })
  // pilihan: bisa banyak sekaligus (kotak seleksi seperti game RTS)
  const [selIds, setSelIds] = useState([])
  const setSel = (id) => setSelIds(id ? [id] : [])
  const sel = selIds.length === 1 ? selIds[0] : null
  const [box, setBox] = useState(null) // {x0,y0,x1,y1} dalam persen peta
  const [palette, setPalette] = useState('party')
  const [search, setSearch] = useState('')
  const [ghost, setGhost] = useState(null) // {label, x, y, over} saat menyeret dari daftar ke peta
  const { groupByMember } = useApp()
  const [state, setState] = useState('') // '', 'saving', 'saved', 'err'
  const mapRef = useRef(null)
  const saveTimer = useRef({})
  const lastLocal = useRef({ main: 0, sub: 0 })

  // bagian party untuk tiap peta: Main -> bagian pertama, Sub -> bagian kedua
  const secOf = (m) => (m === 'main' ? secs[0] : secs[1]) ?? null
  const sec = secOf(map)
  const partyNos = useMemo(() => (sec ? Array.from({ length: sec.to - sec.from + 1 }, (_, i) => sec.from + i) : []), [sec?.from, sec?.to])
  const membersOf = useCallback(
    (p) =>
      signups
        .filter((s) => s.party_no === p)
        .sort((a, b) => a.slot_no - b.slot_no)
        .map((s) => memberById.get(s.member_id))
        .filter(Boolean),
    [signups, memberById],
  )

  /** nama party fix yang mengisi sebagian besar party (jika ada) */
  const groupOfParty = (p) => {
    const ms = membersOf(p)
    const cnt = new Map()
    for (const m of ms) {
      const g = groupByMember.get(m.id)
      if (g) cnt.set(g, (cnt.get(g) || 0) + 1)
    }
    let best = null
    for (const [g, n] of cnt) if (n >= 2 && (!best || n > best.n)) best = { g, n }
    return best?.g ?? null
  }
  /** label party: leader (👑), atau party fix (🤝), atau nama party */
  const partyTag = (p) => {
    const ld = leaderOf(p)
    if (ld) return `👑 ${ld.name}`
    const g = groupOfParty(p)
    return g ? `🤝 ${g.name}` : null
  }

  // ---------- seret dari daftar ke peta (mouse) ----------
  const palDrag = useRef(null)
  function palDown(e, kind, ref, label, onItem) {
    if (e.button !== 0) return
    if (onItem || !canEdit || e.pointerType === 'touch') return // HP: ketuk saja
    palDrag.current = { kind, ref, label, sx: e.clientX, sy: e.clientY, moved: false }
    const move = (ev) => {
      const d = palDrag.current
      if (!d) return
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 6) return
      d.moved = true
      const r = mapRef.current?.getBoundingClientRect()
      const over = !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      setGhost({ label: d.label, x: ev.clientX, y: ev.clientY, over })
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = palDrag.current
      palDrag.current = null
      setGhost(null)
      if (!d) return
      if (!d.moved) return // klik biasa ditangani onClick
      const r = mapRef.current?.getBoundingClientRect()
      if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom)
        add(d.kind, d.ref, null, { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // klik (mouse, sentuh, keyboard): taruh di peta; yang sudah ada di peta dipilih
  const palClick = (on, kind, ref) => (on ? setSel(on.id) : add(kind, ref))

  // ---------- muat & realtime ----------
  useEffect(() => {
    let alive = true
    supabase
      .from('war_strategy')
      .select('*')
      .eq('event_id', ev.id)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) return toast(error.message, 'err')
        const next = { main: [], sub: [] }
        // penanda teks sudah tidak dipakai: hanya party & anggota
        for (const r of data || []) next[r.map] = (r.items || []).filter((x) => x.kind !== 'note')
        setItems(next)
      })
    const ch = supabase
      .channel(`strategy-${ev.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_strategy', filter: `event_id=eq.${ev.id}` }, (p) => {
        const r = p.new
        if (!r?.map) return
        // abaikan gema dari perubahan sendiri yang baru saja disimpan
        if (r.updated_by === user.id && Date.now() - lastLocal.current[r.map] < 4000) return
        setItems((it) => ({ ...it, [r.map]: (r.items || []).filter((x) => x.kind !== 'note') }))
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [ev.id])

  const save = useCallback(
    (m, list) => {
      clearTimeout(saveTimer.current[m])
      setState('saving')
      saveTimer.current[m] = setTimeout(async () => {
        lastLocal.current[m] = Date.now()
        try {
          await rpc('save_strategy', { p_event_id: ev.id, p_map: m, p_items: list })
          lastLocal.current[m] = Date.now()
          setState('saved')
        } catch (e) {
          setState('err')
          toast(e.message, 'err')
        }
      }, 450)
    },
    [ev.id],
  )

  const list = items[map] || []
  const itemsRef = useRef(items)
  itemsRef.current = items
  const update = (fn, persist = true) =>
    setItems((it) => {
      const next = fn(it[map] || [])
      if (persist) save(map, next)
      return { ...it, [map]: next }
    })

  const placed = (kind, ref) => list.find((x) => x.kind === kind && String(x.ref) === String(ref))
  // ---------- grup otomatis: party yang dipimpin orang yang sama ----------
  // kunci = akun leader (atau karakter leader jika belum diklaim)
  const leadKey = (p) => {
    const ld = leaderOf(Number(p))
    return ld ? ld.user_id || `m${ld.id}` : null
  }
  const ledParties = (key) => (key ? partyNos.filter((x) => leadKey(x) === key) : [])
  /** id item di peta yang satu grup leader dengan item ini (termasuk dirinya) */
  const groupOf = (it) => {
    if (it.kind !== 'party') return [it.id]
    const key = leadKey(it.ref)
    if (!key) return [it.id]
    return list.filter((t) => t.kind === 'party' && leadKey(t.ref) === key).map((t) => t.id)
  }
  const leaderGroups = useMemo(() => {
    const m = new Map()
    for (const t of list) {
      if (t.kind !== 'party') continue
      const key = leadKey(t.ref)
      if (!key) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(t)
    }
    return [...m.entries()].filter(([, ts]) => ts.length > 1).map(([key, ts]) => ({ key, ts, leader: leaderOf(Number(ts[0].ref)) }))
  })

  function add(kind, ref, text, pos) {
    if (!canEdit) return
    const ex = kind !== 'note' && placed(kind, ref)
    if (ex) return setSelIds(ex.kind === 'party' ? groupOf(ex) : [ex.id])
    const n = list.length
    const base = {
      x: pos ? clamp(pos.x) : clamp(13 + (n % 4) * 24),
      y: pos ? clamp(pos.y) : clamp(8 + (Math.floor(n / 4) % 10) * 9),
    }
    // party dengan leader yang sama ikut ditaruh berjejer di bawahnya
    const refs = kind === 'party' ? [ref, ...ledParties(leadKey(ref)).filter((x) => x !== ref && !placed('party', x))].sort((a, b) => a - b) : [ref]
    const news = refs.map((r, i) => ({
      id: uid(),
      kind,
      ref: r,
      x: base.x,
      y: base.y,
      ...(text ? { text } : {}),
    }))
    const it = news[0]
    if (kind === 'note') it.color = NOTE_COLORS[n % NOTE_COLORS.length]
    update((l) => [...l, ...news])
    if (news.length > 1) setSelIds(news.map((x) => x.id))
    // daftar tetap terbuka supaya bisa langsung menaruh party berikutnya; penanda langsung dipilih
    if (kind === 'note') setSel(it.id)
  }
  const remove = (id) => {
    update((l) => l.filter((x) => x.id !== id))
    setSel(null)
  }
  function editNote(it) {
    const t = prompt('Ubah teks penanda:', it.text || '')
    if (t == null) return
    update((l) => l.map((x) => (x.id === it.id ? { ...x, text: t.trim().slice(0, 40) || x.text } : x)))
  }
  function clearAll() {
    if (!confirm(`Hapus semua penempatan di ${MAPS[map].label}?`)) return
    update(() => [])
    setSel(null)
  }

  // ---------- geser token (mouse & sentuh) ----------
  const drag = useRef(null)
  function onPointerDown(e, it) {
    e.stopPropagation()
    // Shift + klik: langsung hapus dari peta (grup leader terhapus bersama)
    if (e.shiftKey && canEdit) {
      const ids = new Set(groupOf(it))
      update((l) => l.filter((x) => !ids.has(x.id)))
      setSelIds((cur) => cur.filter((x) => !ids.has(x)))
      return
    }
    // Ctrl + klik: tambah atau kurangi dari pilihan
    if (e.ctrlKey || e.metaKey) {
      const ids = groupOf(it)
      setSelIds((cur) => (cur.includes(it.id) ? cur.filter((x) => !ids.includes(x)) : [...new Set([...cur, ...ids])]))
      return
    }
    // klik party yang dipimpin orang yang sama = pilih semua party-nya
    const group = selIds.includes(it.id) ? [...new Set([...selIds, ...groupOf(it)])] : groupOf(it)
    if (!selIds.includes(it.id)) setSelIds(group)
    if (!canEdit) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const orig = new Map(list.filter((t) => group.includes(t.id)).map((t) => [t.id, { x: t.x, y: t.y }]))
    drag.current = { sx: e.clientX, sy: e.clientY, moved: false, orig }
  }
  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
    d.moved = true
    const r = mapRef.current.getBoundingClientRect()
    // geser semua yang terpilih dengan jarak yang sama, tetap di dalam peta
    let dx = ((e.clientX - d.sx) / r.width) * 100
    let dy = ((e.clientY - d.sy) / r.height) * 100
    for (const o of d.orig.values()) {
      dx = Math.min(Math.max(dx, 3 - o.x), 97 - o.x)
      dy = Math.min(Math.max(dy, 3 - o.y), 97 - o.y)
    }
    const rnd = (v) => Math.round(v * 10) / 10
    update((l) => l.map((t) => (d.orig.has(t.id) ? { ...t, x: rnd(d.orig.get(t.id).x + dx), y: rnd(d.orig.get(t.id).y + dy) } : t)), false)
  }

  // ---------- kotak seleksi di area kosong peta ----------
  const boxRef = useRef(null)
  const pct = (e) => {
    const r = mapRef.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }
  }
  function mapDown(e) {
    if (e.button && e.button !== 0) return
    const p0 = pct(e)
    boxRef.current = { x0: p0.x, y0: p0.y, add: e.ctrlKey || e.metaKey, base: selIds }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (!boxRef.current.add) setSelIds([])
  }
  function mapMove(e) {
    const b = boxRef.current
    if (!b) return
    const p1 = pct(e)
    setBox({ x0: b.x0, y0: b.y0, x1: p1.x, y1: p1.y })
  }
  function mapUp() {
    const b = boxRef.current
    boxRef.current = null
    if (!b || !box) return setBox(null)
    const [x0, x1] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)]
    const [y0, y1] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
    setBox(null)
    if (x1 - x0 < 1 && y1 - y0 < 1) return
    const inside = list.filter((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map((t) => t.id)
    setSelIds(b.add ? [...new Set([...b.base, ...inside])] : inside)
  }
  function removeSelected() {
    const ids = new Set(selIds)
    update((l) => l.filter((x) => !ids.has(x.id)))
    setSelIds([])
  }
  // keyboard: Delete = hapus pilihan, Esc = batal pilih, Ctrl+A = pilih semua
  useEffect(() => {
    const onKey = (e) => {
      if (/input|textarea|select/i.test(document.activeElement?.tagName || '')) return
      if (e.key === 'Escape') setSelIds([])
      else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit && selIds.length) {
        e.preventDefault()
        removeSelected()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && list.length) {
        e.preventDefault()
        setSelIds(list.map((t) => t.id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (d?.moved) save(map, itemsRef.current[map])
  }

  const selItem = list.find((x) => x.id === sel)
  const q = search.trim().toLowerCase()

  // ---------- tampilan token ----------
  const groupedIds = new Set(leaderGroups.flatMap((g) => g.ts.map((t) => t.id)))
  function renderToken(it) {
    if (groupedIds.has(it.id)) return null // tampil sebagai token grup leader
    const active = selIds.includes(it.id)
    const common = {
      className: `strat-token tok-${it.kind} ${active ? 'is-sel' : ''} ${canEdit ? 'editable' : ''}`,
      style: { left: `${it.x}%`, top: `${it.y}%`, ...(it.color ? { '--note': it.color } : {}) },
      onPointerDown: (e) => onPointerDown(e, it),
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    }
    if (it.kind === 'party') {
      const p = Number(it.ref)
      const ms = membersOf(p)
      const ld = leaderOf(p)
      return (
        <div key={it.id} {...common} title={`${partyName(p)} · ${ms.length}/${size}`}>
          <div className={`tok-solo ${map === 'sub' ? 'unit-sub' : ''} ${ms.length === 0 ? 'unit-empty' : ''}`}>
            <div className={`lg-head notranslate ${ld ? '' : 'no-lead'}`}>
              {ld ? (
                <>
                  <span className="tok-crown">👑</span>
                  {ld.name}
                </>
              ) : (
                partyTag(p) ?? partyName(p)
              )}
            </div>
            <div className="solo-row">
              <div className="tok-shield sm">
                <span className="tok-num">{p - (sec?.from ?? 1) + 1}</span>
              </div>
              <div className="tok-roles">
                {Array.from({ length: size }, (_, i) => {
                  const m = ms[i]
                  return <span key={i} className={`tok-pip ${m ? `role-${(m.role || 'dps').toLowerCase()}` : 'pip-empty'}`} />
                })}
              </div>
            </div>
          </div>
        </div>
      )
    }
    if (it.kind === 'member') {
      const m = memberById.get(Number(it.ref))
      if (!m) return null
      return (
        <div key={it.id} {...common} title={`${m.name} · ${m.class ?? ''}`}>
          <JobIcon m={m} size={28} />
          <div className="tok-label notranslate">{m.name}</div>
        </div>
      )
    }
    return (
      <div key={it.id} {...common} onDoubleClick={() => canEdit && editNote(it)}>
        <div className="tok-note notranslate">{it.text}</div>
      </div>
    )
  }

  return (
    <div className={`strat ${ghost ? 'is-dragging' : ''}`}>
      {ghost && (
        <div className={`strat-ghost notranslate ${ghost.over ? 'over' : ''}`} style={{ left: ghost.x, top: ghost.y }}>
          {ghost.label}
        </div>
      )}
      <div className="strat-bar">
        <div className="tabs strat-tabs">
          {Object.entries(MAPS).map(([k, m]) => (
            <button key={k} className={map === k ? 'active' : ''} onClick={() => { setMap(k); setSel(null) }}>
              {m.label}
              <span className="tab-count">{(items[k] || []).length}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className={`small strat-state st-${state}`}>
          {state === 'saving' ? 'Menyimpan…' : state === 'saved' ? '✓ Tersimpan' : state === 'err' ? 'Gagal menyimpan' : canEdit ? '' : '👁 Hanya lihat'}
        </span>
      </div>

      <div className="strat-layout">
        <div className="strat-map-wrap">
          <div
            ref={mapRef}
            className={`strat-map ${ghost?.over ? 'drop-over' : ''}`}
            onPointerDown={mapDown}
            onPointerMove={mapMove}
            onPointerUp={mapUp}
            onPointerCancel={mapUp}
          >
            <img src={MAPS[map].img} alt="" draggable={false} />
            {leaderGroups.map((g) => {
              // satu token ringkas: nama leader di atas, perisai nomor party di bawah
              const x = g.ts.reduce((a, t) => a + t.x, 0) / g.ts.length
              const y = g.ts.reduce((a, t) => a + t.y, 0) / g.ts.length
              const sorted = [...g.ts].sort((a, b) => a.ref - b.ref)
              const active = g.ts.some((t) => selIds.includes(t.id))
              return (
                <div
                  key={g.key}
                  className={`strat-token tok-lgroup ${active ? 'is-sel' : ''} ${canEdit ? 'editable' : ''} ${map === 'sub' ? 'unit-sub' : ''}`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  onPointerDown={(e) => onPointerDown(e, sorted[0])}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  title={sorted.map((t) => partyName(Number(t.ref))).join(', ')}
                >
                  <div className="lg-head notranslate">
                    <span className="tok-crown">👑</span>
                    {g.leader?.name}
                  </div>
                  <div className="lg-shields">
                    {sorted.map((t) => (
                      <div key={t.id} className="tok-shield sm">
                        <span className="tok-num">{t.ref - (sec?.from ?? 1) + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {list.map(renderToken)}
            {box && (
              <div
                className="strat-box"
                style={{
                  left: `${Math.min(box.x0, box.x1)}%`,
                  top: `${Math.min(box.y0, box.y1)}%`,
                  width: `${Math.abs(box.x1 - box.x0)}%`,
                  height: `${Math.abs(box.y1 - box.y0)}%`,
                }}
              />
            )}
            {list.length === 0 && (
              <div className="strat-empty small">
                {canEdit ? 'Pilih party / anggota di samping untuk menaruhnya di peta, lalu geser ke posisinya.' : 'Belum ada strategi untuk peta ini.'}
              </div>
            )}
          </div>
          <p className="small muted strat-tip">
            Tips: seret di area kosong peta untuk memilih beberapa sekaligus (kotak), lalu geser salah satunya untuk memindahkan
            semuanya. Shift + klik = hapus dari peta · Ctrl + klik = tambah/kurangi pilihan · Delete = hapus pilihan · Esc =
            batal pilih.
          </p>
          {canEdit && (
            <div className="row gap-sm wrap strat-actions">
              <span className="grow" />
              {list.length > 0 && (
                <button className="btn btn-ghost btn-sm text-red" onClick={clearAll}>
                  Hapus semua
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="strat-side card">
          {selIds.length > 1 ? (
            <div className="strat-detail">
              <div className="row gap-sm">
                <b className="grow">{`${selIds.length} dipilih`}</b>
                <button className="icon-btn" onClick={() => setSelIds([])} title="Tutup">
                  ✕
                </button>
              </div>
              <ul className="strat-members">
                {list
                  .filter((t) => selIds.includes(t.id))
                  .map((t) =>
                    t.kind === 'party' ? (
                      <li key={t.id} className="strat-multi-party">
                        <b className="notranslate">{`${t.ref - (sec?.from ?? 1) + 1} · ${partyName(Number(t.ref))}`}</b>
                        <span className="small muted notranslate">
                          {membersOf(Number(t.ref)).map((m) => m.name).join(', ') || '—'}
                        </span>
                      </li>
                    ) : (
                      <li key={t.id} className="notranslate">
                        {t.kind === 'member' ? memberById.get(Number(t.ref))?.name : `📝 ${t.text}`}
                      </li>
                    ),
                  )}
              </ul>
              <p className="small muted">Seret salah satu di peta untuk memindahkan semuanya.</p>
              {canEdit && (
                <button className="btn btn-ghost btn-sm text-red" onClick={removeSelected}>
                  {`Hapus ${selIds.length} dari peta`}
                </button>
              )}
            </div>
          ) : selItem ? (
            <div className="strat-detail">
              <div className="row gap-sm">
                <b className="grow">
                  {selItem.kind === 'party'
                    ? partyName(Number(selItem.ref))
                    : selItem.kind === 'member'
                      ? memberById.get(Number(selItem.ref))?.name
                      : 'Penanda'}
                </b>
                <button className="icon-btn" onClick={() => setSel(null)} title="Tutup">
                  ✕
                </button>
              </div>
              {selItem.kind === 'party' && (
                <ul className="strat-members">
                  {membersOf(Number(selItem.ref)).map((m) => (
                    <li key={m.id}>
                      <JobIcon m={m} size={24} />
                      <span className="notranslate grow">
                        {leaderOf(Number(selItem.ref))?.id === m.id && '👑 '}
                        {m.name}
                      </span>
                      <span className="small muted">{m.class}</span>
                    </li>
                  ))}
                  {membersOf(Number(selItem.ref)).length === 0 && <li className="muted small">Party ini masih kosong.</li>}
                </ul>
              )}
              {selItem.kind === 'note' && <p className="notranslate">{selItem.text}</p>}
              {canEdit && (
                <div className="row gap-sm">
                  {selItem.kind === 'note' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => editNote(selItem)}>
                      Ubah teks
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm text-red" onClick={() => remove(selItem.id)}>
                    Hapus dari peta
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="tabs strat-pal-tabs">
                <button className={palette === 'party' ? 'active' : ''} onClick={() => setPalette('party')}>
                  Party
                </button>
                <button className={palette === 'member' ? 'active' : ''} onClick={() => setPalette('member')}>
                  Anggota
                </button>
              </div>
              {!sec ? (
                <p className="muted small">Papan ini tidak punya bagian untuk peta ini.</p>
              ) : palette === 'party' ? (
                <ul className="strat-pal">
                  {partyNos.map((p) => {
                    const ms = membersOf(p)
                    const on = placed('party', p)
                    return (
                      <li key={p}>
                        <button
                          className={`strat-pal-item ${on ? 'on' : ''} ${canEdit && !on ? 'draggable' : ''}`}
                          disabled={!canEdit && !on}
                          onPointerDown={(e) => palDown(e, 'party', p, `${p - sec.from + 1} · ${partyTag(p) ?? partyName(p)}`, on)}
                          onClick={() => palClick(on, 'party', p)}
                          title={canEdit && !on ? 'Klik atau seret ke peta' : undefined}
                        >
                          <span className="tok-badge sm">
                            <span className="tok-num">{p - sec.from + 1}</span>
                          </span>
                          <span className="grow">
                            <b className="notranslate">{partyName(p)}</b>
                            <span className="small muted notranslate">
                              {` ${ms.length}/${size}`}
                              {partyTag(p) ? ` · ${partyTag(p)}` : ''}
                            </span>
                          </span>
                          <span className="small">{on ? '📍' : canEdit ? '+' : ''}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <>
                  <input placeholder="Cari anggota…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <ul className="strat-pal">
                    {partyNos.map((p) => {
                      const ms = membersOf(p).filter((m) => !q || m.name.toLowerCase().includes(q) || (m.class || '').toLowerCase().includes(q))
                      if (!ms.length) return null
                      return (
                        <li key={p}>
                          <div className="strat-pal-group small muted notranslate">{partyName(p)}</div>
                          {ms.map((m) => {
                            const on = placed('member', m.id)
                            return (
                              <button
                                key={m.id}
                                className={`strat-pal-item ${on ? 'on' : ''} ${canEdit && !on ? 'draggable' : ''}`}
                                disabled={!canEdit && !on}
                                onPointerDown={(e) => palDown(e, 'member', m.id, m.name, on)}
                                onClick={() => palClick(on, 'member', m.id)}
                                title={canEdit && !on ? 'Klik atau seret ke peta' : undefined}
                              >
                                <JobIcon m={m} size={24} />
                                <span className="grow notranslate">{m.name}</span>
                                <span className="small">{on ? '📍' : canEdit ? '+' : ''}</span>
                              </button>
                            )
                          })}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
