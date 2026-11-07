import { useEffect, useMemo, useRef, useState } from 'react'
import { rpc } from '../lib/supabase.js'
import JobIcon from './JobIcon.jsx'
import { tr } from '../lib/i18n.js'

// Isi party dari screenshot layar party di game.
// Gambar dibaca di browser (Tesseract OCR), nama dicocokkan ke roster, lalu dicek dulu sebelum disimpan.
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'

let tessPromise
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract)
  tessPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = TESS_URL
    s.onload = () => resolve(window.Tesseract)
    s.onerror = () => {
      tessPromise = null
      reject(new Error('Gagal memuat pembaca gambar. Periksa koneksi internet.'))
    }
    document.head.appendChild(s)
  })
  return tessPromise
}

/** gambar -> kanvas hitam-putih 2x: teks putih di game jadi hitam, sisanya putih */
async function prepare(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('File bukan gambar'))
      i.src = url
    })
    // screenshot kecil (potongan) diperbesar lebih banyak supaya huruf terbaca
    const scale = img.width < 800 ? 4 : img.width < 2400 ? 2 : 1
    const c = document.createElement('canvas')
    c.width = img.width * scale
    c.height = img.height * scale
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const d = ctx.getImageData(0, 0, c.width, c.height)
    const color = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height) // salinan berwarna (untuk ikon leader)
    const p = d.data
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.min(p[i], p[i + 1], p[i + 2]) > 205 ? 0 : 255
      p[i] = p[i + 1] = p[i + 2] = v
    }
    ctx.putImageData(d, 0, 0)
    return { canvas: c, color }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
function lev(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
const sim = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0)

const NOISE = /^(lv\.?\d*|lv|party|\d+|\+|x)$/i

/** kata-kata OCR -> [{party (1..), slot (1..), text}] berdasarkan posisi judul "Party N" */
export function layout(words, imgH, rowsGuess) {
  const ws = words
    .map((w) => ({ t: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, conf: w.confidence }))
    .filter((w) => w.t)
  // judul kolom: "Party" diikuti angka di kanannya
  const heads = []
  for (const w of ws) {
    if (!/^party$/i.test(w.t)) continue
    const num = ws.find((o) => /^\d{1,2}$/.test(o.t) && o.x0 > w.x1 - 5 && o.x0 - w.x1 < (w.x1 - w.x0) && Math.abs(o.y0 - w.y0) < (w.y1 - w.y0))
    heads.push({ n: num ? Number(num.t) : heads.length + 1, cx: num ? (w.x0 + num.x1) / 2 : (w.x0 + w.x1) / 2, bottom: w.y1 })
  }
  heads.sort((a, b) => a.cx - b.cx)
  const top = heads.length ? Math.max(...heads.map((h) => h.bottom)) : 0
  const colOf = (cx) => {
    if (!heads.length) return 1
    let best = heads[0]
    for (const h of heads) if (Math.abs(h.cx - cx) < Math.abs(best.cx - cx)) best = h
    return best.n
  }
  // tinggi baris: jarak antar label "LV" di kolom yang sama
  const lvs = ws.filter((w) => /^lv/i.test(w.t))
  const gaps = []
  for (const a of lvs)
    for (const b of lvs) if (b.y0 > a.y0 + 10 && Math.abs(b.x0 - a.x0) < 40) gaps.push(b.y0 - a.y0)
  gaps.sort((a, b) => a - b)
  const rowH = gaps.length ? gaps[0] : (imgH - top) / rowsGuess

  // kata nama (bukan LV / angka / judul / ikon), digabung per baris dalam satu sel.
  // Ikon kelas (kiri) dan lencana merah (kanan atas) sering terbaca sebagai "10)", "1G]", "Ys," dsb:
  // kata seperti itu punya < 2 huruf atau keyakinan OCR rendah, jadi dibuang.
  const letters = (s) => (norm(s).match(/[a-z]/g) || []).length
  const names = ws.filter((w) => !NOISE.test(w.t) && !/^[l1i|]v\.?\d*$/i.test(w.t) && letters(w.t) >= 2 && w.y0 > top && !(w.conf < 45 && w.t.length <= 3))
  const cells = new Map()
  for (const w of names) {
    const party = colOf((w.x0 + w.x1) / 2)
    const slot = Math.max(1, Math.floor((w.y0 - top) / rowH) + 1)
    const k = `${party}-${slot}`
    const c = cells.get(k) ?? { party, slot, parts: [] }
    c.parts.push(w)
    cells.set(k, c)
  }
  const xs = heads.map((h) => h.cx)
  const colW = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : null
  const cellList = [...cells.values()]
    .map((c) => {
      // kelompokkan kata per baris teks di sel; nama = baris dengan keyakinan OCR tertinggi
      c.parts.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      const lines = []
      for (const w of c.parts) {
        const ln = lines.find((l) => Math.abs(l[0].y0 - w.y0) < (l[0].y1 - l[0].y0) * 0.6)
        if (ln) ln.push(w)
        else lines.push([w])
      }
      const scored = lines
        .map((l) => ({ text: l.map((w) => w.t).join(' '), conf: l.reduce((s, w) => s + (w.conf ?? 0), 0) / l.length, len: letters(l.map((w) => w.t).join('')) }))
        .sort((a, b) => b.conf - a.conf || b.len - a.len)
      return { party: c.party, slot: c.slot, text: scored[0].text, alts: scored.map((s) => s.text) }
    })
    .sort((a, b) => a.party - b.party || a.slot - b.slot)
  return { cells: cellList, geo: { heads, colW, top, rowH } }
}

/**
 * Ikon leader party di game: mahkota kuning-oranye di pojok kiri atas sel karakter.
 * Hasil: Set "party-slot" yang punya mahkota.
 */
export function detectLeaders(img, geo) {
  const out = new Set()
  if (!img || !geo.heads.length || !geo.rowH) return out
  const { width: W, height: H, data } = img
  const cs = 4
  const gw = Math.floor(W / cs), gh = Math.floor(H / cs)
  const grid = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let n = 0
      for (let dy = 0; dy < cs; dy++)
        for (let dx = 0; dx < cs; dx++) {
          const i = ((gy * cs + dy) * W + gx * cs + dx) * 4
          const r = data[i], g = data[i + 1], b = data[i + 2]
          if (r >= 240 && g >= 180 && g <= 235 && b <= 170) n++
        }
      if (n >= (cs * cs) / 3) grid[gy * gw + gx] = 1
    }
  const colW = geo.colW || W / Math.max(1, geo.heads.length)
  const minPts = Math.max(6, ((geo.rowH * 0.12) / cs) ** 2)
  const seen = new Uint8Array(gw * gh)
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || seen[start]) continue
    const st = [start]
    seen[start] = 1
    let n = 0, sx = 0, sy = 0
    while (st.length) {
      const k = st.pop()
      const x = k % gw, y = (k - x) / gw
      n++
      sx += x
      sy += y
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const j = ny * gw + nx
        if (grid[j] && !seen[j]) {
          seen[j] = 1
          st.push(j)
        }
      }
    }
    if (n < minPts) continue
    const bx = (sx / n) * cs, by = (sy / n) * cs
    // kolom: tepi kiri kolom terdekat
    let best = null
    for (const h of geo.heads) {
      const d = Math.abs(h.cx - colW / 2 - bx)
      if (!best || d < best.d) best = { d, n: h.n }
    }
    if (!best || best.d > colW * 0.35 || by < geo.top - geo.rowH * 0.4) continue
    const slot = Math.max(1, Math.round((by - geo.top) / geo.rowH) + 1)
    out.add(`${best.n}-${slot}`)
  }
  return out
}

/** cocokkan teks ke member aktif; satu member hanya dipakai sekali (skor tertinggi dulu) */
export function matchAll(cells, members) {
  // nama tanpa huruf/angka latin tidak bisa dicocokkan dari OCR
  const pool = members.filter((m) => m.active).map((m) => ({ m, k: norm(m.name) })).filter((x) => x.k.length >= 2)
  const cands = []
  cells.forEach((c, i) => {
    // coba setiap baris teks di sel (nama bisa bukan baris pertama), pakai skor terbaik
    const texts = [...new Set([c.text, ...(c.alts || [])].map(norm))].filter((t) => t.length >= 2)
    for (const { m, k } of pool) {
      let best = 0
      for (const t of texts) {
        let s = sim(t, k)
        // nama terpotong / ada teks tambahan: cocok jika salah satu memuat yang lain (min. 4 huruf)
        if (Math.min(t.length, k.length) >= 4 && (k.includes(t) || t.includes(k))) s = Math.max(s, 0.8)
        best = Math.max(best, s)
      }
      if (best >= 0.6) cands.push({ i, m, s: best })
    }
  })
  cands.sort((a, b) => b.s - a.s)
  const usedM = new Set()
  const out = cells.map((c) => ({ ...c, memberId: null, score: 0 }))
  for (const c of cands) {
    if (out[c.i].memberId || usedM.has(c.m.id)) continue
    out[c.i].memberId = c.m.id
    out[c.i].score = c.s
    usedM.add(c.m.id)
  }
  return out
}


/** tim (party di game) -> party website: utamakan party tempat anggotanya sudah berada, lalu party kosong */
export function autoTargets(teams, sec, signups) {
  const cur = new Map(signups.map((s) => [s.member_id, s.party_no]))
  const used = new Set()
  const out = {}
  for (const t of teams) {
    if (!t.ids.length) continue
    const ids = new Set(t.ids)
    let best = null
    for (let p = sec.from; p <= sec.to; p++) {
      if (used.has(p)) continue
      const here = t.ids.filter((id) => cur.get(id) === p).length
      const others = signups.filter((s) => s.party_no === p && !ids.has(s.member_id)).length
      const score = here * 10 - others
      if (!best || score > best.score) best = { p, score }
    }
    if (best) {
      out[t.n] = best.p
      used.add(best.p)
    }
  }
  return out
}

/**
 * Rencana: setiap tim mengganti isi party tujuannya (screenshot = data asli).
 * Hasil: places [{id, team, party, slot}], removed [{id, party}] (keluar ke daftar tunggu).
 */
export function makePlan({ teams, targets, signups, size }) {
  const places = []
  const removed = []
  const inTeams = new Set(teams.flatMap((t) => t.ids))
  for (const t of teams) {
    const p = targets[t.n]
    if (!p) continue
    const used = new Set()
    t.rows.forEach((r) => {
      if (!r.memberId) return
      let slot = r.slot <= size && !used.has(r.slot) ? r.slot : null
      if (!slot) slot = Array.from({ length: size }, (_, j) => j + 1).find((x) => !used.has(x))
      if (!slot) return
      used.add(slot)
      places.push({ id: r.memberId, team: t.n, party: p, slot })
    })
    for (const s of signups) if (s.party_no === p && !inTeams.has(s.member_id)) removed.push({ id: s.member_id, party: p })
  }
  return { places, removed }
}

export default function ScreenshotFill({ ev, secs, size, partyName, members, memberById, signups, leaderOf, onClose, onDone, toast }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState(null)
  const [rows, setRows] = useState(null)
  const [secIdx, setSecIdx] = useState(0) // bagian tujuan: Main / Sub / STAR / ND…
  const [targets, setTargets] = useState({}) // tim game -> nomor party website
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onPaste = (e) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'))
      if (f) pick(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  async function pick(f) {
    if (!f || !f.type.startsWith('image/')) return
    setFile(f)
    setRows(null)
    setChecked(false)
    setPreview(URL.createObjectURL(f))
    try {
      setStatus('Menyiapkan gambar…')
      const { canvas, color } = await prepare(f)
      setStatus('Memuat pembaca gambar…')
      const T = await loadTesseract()
      const worker = await T.createWorker('eng', 1, {
        logger: (m) => m.status === 'recognizing text' && setStatus(`Membaca nama… ${Math.round(m.progress * 100)}%`),
      })
      await worker.setParameters({ tessedit_pageseg_mode: '11' })
      const { data } = await worker.recognize(canvas)
      await worker.terminate()
      const { cells, geo } = layout(data.words || [], canvas.height, Math.min(size, 8))
      const crowns = detectLeaders(color, geo)
      setRows(matchAll(cells, members).map((r) => ({ ...r, leader: crowns.has(`${r.party}-${r.slot}`) })))
      setStatus(null)
    } catch (e) {
      setStatus(null)
      toast(e.message || String(e), 'err')
    }
  }

  const sorted = useMemo(() => [...members].filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name)), [members])
  const sec = secs[secIdx] ?? secs[0]
  const teamNos = [...new Set((rows || []).map((r) => r.party))].sort((a, b) => a - b)
  const teams = teamNos.map((n) => {
    const tr_ = (rows || []).filter((r) => r.party === n).sort((a, b) => a.slot - b.slot)
    return { n, rows: tr_, ids: tr_.filter((r) => r.memberId).map((r) => r.memberId), leader: tr_.find((r) => r.leader && r.memberId)?.memberId ?? null }
  })
  const teamKey = teams.map((t) => `${t.n}:${t.ids.join(',')}`).join('|')

  // tujuan otomatis setiap kali hasil baca / bagian berubah
  useEffect(() => {
    if (rows) setTargets(autoTargets(teams, sec, signups))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey, secIdx, !!rows])

  const plan = makePlan({ teams, targets, signups, size })
  const curOf = new Map(signups.map((s) => [s.member_id, s]))
  const placeOf = new Map(plan.places.map((x) => [x.id, x]))
  const moved = plan.places.filter((x) => {
    const c = curOf.get(x.id)
    return c?.party_no && c.party_no <= ev.party_count && c.party_no !== x.party
  })
  const added = plan.places.filter((x) => !curOf.get(x.id)?.party_no || curOf.get(x.id).party_no > ev.party_count)
  const leaderChanges = teams
    .filter((t) => t.leader && targets[t.n] && leaderOf(targets[t.n]) !== t.leader)
    .map((t) => ({ party: targets[t.n], id: t.leader }))
  const needCheck = moved.length + plan.removed.length > 0
  const unread = (rows || []).filter((r) => !r.memberId).length

  const setRow = (i, memberId) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, memberId, score: memberId ? 1 : 0 } : memberId && r.memberId === memberId ? { ...r, memberId: null, score: 0 } : r)))
  const setLeader = (team, i) => setRows((rs) => rs.map((r, j) => (r.party === team ? { ...r, leader: j === i ? !r.leader : false } : r)))
  const setTarget = (team, p) => {
    setChecked(false)
    setTargets((t) => ({ ...t, [team]: p ? Number(p) : null }))
  }
  const nameOf = (id) => memberById.get(id)?.name ?? '?'

  const note = (id) => {
    const c = curOf.get(id)
    const t = placeOf.get(id)
    if (!t) return null
    if (!c?.party_no || c.party_no > ev.party_count) return { k: 'new', t: 'baru' }
    if (c.party_no === t.party) return { k: 'stay', t: 'tetap' }
    return { k: 'move', t: `dari ${partyName(c.party_no)}` }
  }

  async function apply() {
    setBusy(true)
    let ok = 0
    const fails = []
    const call = async (fn, args, who) => {
      try {
        await rpc(fn, args)
        return true
      } catch (e) {
        fails.push(`${who}: ${e.message}`)
        return false
      }
    }
    try {
      const targetParties = new Set(Object.values(targets).filter(Boolean))
      const exact = new Set(plan.places.map((x) => `${x.id}@${x.party}-${x.slot}`))
      // 1) kosongkan party tujuan: semua yang tidak tepat di slot tujuannya keluar dulu ke daftar tunggu
      for (const s of signups) {
        if (!targetParties.has(s.party_no) || exact.has(`${s.member_id}@${s.party_no}-${s.slot_no}`)) continue
        await call('join_slot', { p_event_id: ev.id, p_member_id: s.member_id, p_party_no: null, p_slot_no: null }, nameOf(s.member_id))
      }
      // 2) masukkan anggota screenshot ke slotnya
      for (const x of plan.places) {
        const c = curOf.get(x.id)
        if (c?.party_no === x.party && c.slot_no === x.slot) {
          ok++
          continue
        }
        if (await call('join_slot', { p_event_id: ev.id, p_member_id: x.id, p_party_no: x.party, p_slot_no: x.slot }, nameOf(x.id))) ok++
      }
      // 3) leader party dari ikon mahkota
      for (const l of leaderChanges)
        await call('claim_party_leader', { p_event_id: ev.id, p_party_no: l.party, p_member_id: l.id }, nameOf(l.id))
    } finally {
      setBusy(false)
    }
    await onDone()
    toast(`${ok} karakter dimasukkan dari screenshot`)
    if (fails.length) toast(fails.slice(0, 4).join(' · '), 'err')
    else onClose()
  }

  const usedBy = (p, self) => teams.find((t) => t.n !== self && targets[t.n] === p)
  const partyOpts = []
  for (let p = sec.from; p <= sec.to; p++) partyOpts.push(p)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📷 Isi party dari screenshot</h3>
          <button className="icon-btn" onClick={onClose} title="Tutup">
            ✕
          </button>
        </div>

        {!file && (
          <p className="small muted">
            Ambil screenshot layar party di game (judul “Party 1, Party 2…” harus terlihat), lalu pilih file atau tempel dengan
            Ctrl+V. Setiap party di screenshot mengganti isi party website yang Anda pilih; ikon mahkota 👑 = leader party.
          </p>
        )}

        <label className="row gap-sm">
          <span className="muted small">Screenshot ini untuk</span>
          <select className="select-sm" value={secIdx} onChange={(e) => setSecIdx(Number(e.target.value))}>
            {secs.map((x, i) => (
              <option key={x.from} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        </label>

        <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]) }}>
          <input type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          {preview ? <img src={preview} alt="" className="shot-preview" /> : <span>🖼 Pilih / seret / tempel screenshot</span>}
          {file && <span className="small muted">Klik untuk ganti gambar</span>}
        </label>

        {status && (
          <div className="notice">
            <span className="spinner" /> {status}
          </div>
        )}

        {rows && rows.length === 0 && (
          <p className="notice notice-err small">
            Tidak ada nama yang terbaca. Pastikan screenshot memperlihatkan judul “Party …” dan nama karakter dengan jelas.
          </p>
        )}

        {rows && rows.length > 0 && (
          <>
            <div className="shot-list">
              {teams.map((t) => {
                const p = targets[t.n]
                const out = plan.removed.filter((x) => x.party === p)
                return (
                  <div key={t.n} className="shot-party">
                    <div className="shot-party-name">
                      <span>{`Party ${t.n} (game)`}</span>
                      <span className="shot-arrow">→</span>
                      <select className="select-sm shot-target" value={p ?? ''} onChange={(e) => setTarget(t.n, e.target.value)}>
                        <option value="">{tr('— lewati —')}</option>
                        {partyOpts.map((x) => {
                          const by = usedBy(x, t.n)
                          const cnt = signups.filter((s) => s.party_no === x).length
                          return (
                            <option key={x} value={x} disabled={!!by}>
                              {`${partyName(x)} (${cnt}/${size})${by ? ` · ${tr('dipakai')} Party ${by.n}` : ''}`}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                    {t.rows.map((r) => {
                      const i = rows.indexOf(r)
                      const n = r.memberId ? note(r.memberId) : null
                      return (
                        <div key={i} className={`shot-row ${r.memberId ? (r.score >= 0.8 ? 'ok' : 'maybe') : 'miss'}`}>
                          <button
                            type="button"
                            className={`shot-crown ${r.leader ? 'on' : ''}`}
                            title={r.leader ? 'Leader party (klik untuk batal)' : 'Jadikan leader party'}
                            onClick={() => setLeader(t.n, i)}
                            disabled={!r.memberId}
                          >
                            👑
                          </button>
                          <span className="shot-read notranslate" title="Teks yang terbaca dari gambar">
                            {r.text}
                          </span>
                          <span className="shot-arrow">→</span>
                          {r.memberId && <JobIcon m={memberById.get(r.memberId)} size={22} />}
                          <select className="select-sm notranslate" value={r.memberId ?? ''} onChange={(e) => setRow(i, e.target.value ? Number(e.target.value) : null)}>
                            <option value="">{tr('— lewati —')}</option>
                            {sorted.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} · {m.class}
                              </option>
                            ))}
                          </select>
                          {n && p && <span className={`shot-note note-${n.k}`}>{n.t}</span>}
                        </div>
                      )
                    })}
                    {p && out.length > 0 && (
                      <div className="shot-out small">
                        <span>{`✖ Keluar dari ${partyName(p)} (ke daftar tunggu):`}</span>{' '}
                        <b className="notranslate">{out.map((x) => nameOf(x.id)).join(', ')}</b>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="shot-summary">
              <div className="shot-summary-title">Ringkasan perubahan</div>
              <ul>
                <li>{`✚ ${added.length} masuk baru`}</li>
                {moved.length > 0 && (
                  <li>
                    {`⇄ ${moved.length} pindah party:`}{' '}
                    <span className="notranslate">{moved.map((x) => `${nameOf(x.id)} (${partyName(curOf.get(x.id).party_no)} → ${partyName(x.party)})`).join(', ')}</span>
                  </li>
                )}
                {plan.removed.length > 0 && (
                  <li className="text-red">
                    {`✖ ${plan.removed.length} dikeluarkan ke daftar tunggu:`}{' '}
                    <span className="notranslate">{plan.removed.map((x) => `${nameOf(x.id)} (${partyName(x.party)})`).join(', ')}</span>
                  </li>
                )}
                {leaderChanges.length > 0 && (
                  <li>
                    {`👑 Leader:`}{' '}
                    <span className="notranslate">{leaderChanges.map((l) => `${nameOf(l.id)} → ${partyName(l.party)}`).join(', ')}</span>
                  </li>
                )}
                {unread > 0 && <li className="muted">{`${unread} nama tidak terbaca (dilewati)`}</li>}
              </ul>
              {needCheck && (
                <label className="check-label small">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <span>Saya sudah memeriksa perpindahan & karakter yang dikeluarkan di atas</span>
                </label>
              )}
            </div>

            <div className="row gap-sm">
              <button className="btn btn-ghost" onClick={onClose}>
                Batal
              </button>
              <span className="grow" />
              <button className="btn btn-gold" disabled={busy || !plan.places.length || (needCheck && !checked)} onClick={apply}>
                {busy ? 'Menyimpan…' : `Terapkan (${plan.places.length} karakter)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
