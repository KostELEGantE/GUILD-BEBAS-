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
    const scale = img.width < 2400 ? 2 : 1
    const c = document.createElement('canvas')
    c.width = img.width * scale
    c.height = img.height * scale
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const d = ctx.getImageData(0, 0, c.width, c.height)
    const p = d.data
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.min(p[i], p[i + 1], p[i + 2]) > 205 ? 0 : 255
      p[i] = p[i + 1] = p[i + 2] = v
    }
    ctx.putImageData(d, 0, 0)
    return { canvas: c, preview: url && img.src }
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

  // kata nama (bukan LV / angka / judul), digabung per baris dalam satu sel
  const names = ws.filter((w) => !NOISE.test(w.t) && norm(w.t).length >= 2 && w.y0 > top)
  const cells = new Map()
  for (const w of names) {
    const party = colOf((w.x0 + w.x1) / 2)
    const slot = Math.max(1, Math.floor((w.y0 - top) / rowH) + 1)
    const k = `${party}-${slot}`
    const c = cells.get(k) ?? { party, slot, parts: [] }
    c.parts.push(w)
    cells.set(k, c)
  }
  return [...cells.values()]
    .map((c) => {
      // pakai baris teks paling atas di sel (nama), abaikan teks lain yang menimpa
      c.parts.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      const first = c.parts[0]
      const line = c.parts.filter((w) => Math.abs(w.y0 - first.y0) < (first.y1 - first.y0) * 0.6)
      return { party: c.party, slot: c.slot, text: line.map((w) => w.t).join(' ') }
    })
    .sort((a, b) => a.party - b.party || a.slot - b.slot)
}

/** cocokkan teks ke member aktif; satu member hanya dipakai sekali (skor tertinggi dulu) */
export function matchAll(cells, members) {
  // nama tanpa huruf/angka latin tidak bisa dicocokkan dari OCR
  const pool = members.filter((m) => m.active).map((m) => ({ m, k: norm(m.name) })).filter((x) => x.k.length >= 2)
  const cands = []
  cells.forEach((c, i) => {
    const t = norm(c.text)
    if (t.length < 2) return
    for (const { m, k } of pool) {
      let s = sim(t, k)
      // nama terpotong / ada teks tambahan: cocok jika salah satu memuat yang lain (min. 4 huruf)
      if (Math.min(t.length, k.length) >= 4 && (k.includes(t) || t.includes(k))) s = Math.max(s, 0.8)
      if (s >= 0.6) cands.push({ i, m, s })
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

export default function ScreenshotFill({ ev, size, partyName, members, memberById, signups, reservedOf, onClose, onDone, toast }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState(null) // teks progres
  const [rows, setRows] = useState(null)
  const [offset, setOffset] = useState(0) // Party 1 di screenshot = party (1 + offset) di papan
  const [clearOthers, setClearOthers] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  // tempel (Ctrl+V) screenshot langsung
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
    setPreview(URL.createObjectURL(f))
    try {
      setStatus('Menyiapkan gambar…')
      const { canvas } = await prepare(f)
      setStatus('Memuat pembaca gambar…')
      const T = await loadTesseract()
      const worker = await T.createWorker('eng', 1, {
        logger: (m) => m.status === 'recognizing text' && setStatus(`Membaca nama… ${Math.round(m.progress * 100)}%`),
      })
      await worker.setParameters({ tessedit_pageseg_mode: '11' })
      const { data } = await worker.recognize(canvas)
      await worker.terminate()
      const cells = layout(data.words || [], canvas.height, Math.min(size, 8))
      setRows(matchAll(cells, members))
      setStatus(null)
    } catch (e) {
      setStatus(null)
      toast(e.message || String(e), 'err')
    }
  }

  const sorted = useMemo(
    () => [...members].filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  )
  const target = (r) => r.party + offset
  const valid = (rows || []).filter((r) => target(r) >= 1 && target(r) <= ev.party_count && r.slot <= size)
  const ready = valid.filter((r) => r.memberId)
  const parties = [...new Set(valid.map(target))]

  const setRow = (i, memberId) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, memberId, score: memberId ? 1 : 0 } : r)))

  async function apply() {
    setBusy(true)
    let ok = 0
    const fails = []
    try {
      const wanted = new Set(ready.map((r) => r.memberId))
      if (clearOthers) {
        for (const s of signups) {
          if (parties.includes(s.party_no) && !wanted.has(s.member_id)) {
            try {
              await rpc('leave_event', { p_event_id: ev.id, p_member_id: s.member_id })
            } catch (e) {
              fails.push(`${memberById.get(s.member_id)?.name}: ${e.message}`)
            }
          }
        }
      }
      // slot yang sudah terisi orang lain -> pakai slot kosong lain di party yang sama
      const taken = new Map() // "p-s" -> member_id
      for (const s of signups) if (s.party_no && !(clearOthers && parties.includes(s.party_no) && !wanted.has(s.member_id))) taken.set(`${s.party_no}-${s.slot_no}`, s.member_id)
      for (const r of ready) for (const [k, v] of taken) if (v === r.memberId) taken.delete(k)
      for (const r of ready) {
        const p = target(r)
        let slot = r.slot
        const rs = reservedOf(p)
        const free = (s) => !taken.has(`${p}-${s}`) && !rs[s]
        if (!free(slot)) slot = Array.from({ length: size }, (_, j) => j + 1).find(free)
        const name = memberById.get(r.memberId)?.name
        if (!slot) {
          fails.push(`${name}: ${partyName(p)} penuh`)
          continue
        }
        try {
          await rpc('join_slot', { p_event_id: ev.id, p_member_id: r.memberId, p_party_no: p, p_slot_no: slot })
          taken.set(`${p}-${slot}`, r.memberId)
          ok++
        } catch (e) {
          fails.push(`${name}: ${e.message}`)
        }
      }
    } finally {
      setBusy(false)
    }
    await onDone()
    toast(`${ok} karakter dimasukkan dari screenshot`)
    if (fails.length) toast(fails.slice(0, 4).join(' · '), 'err')
    if (!fails.length) onClose()
  }

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
            Ctrl+V. Nama dibaca otomatis dan dicocokkan dengan roster; Anda bisa memeriksa dulu sebelum disimpan.
          </p>
        )}

        <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]) }}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          {preview ? <img src={preview} alt="" className="shot-preview" /> : <span>🖼 Pilih / seret / tempel screenshot</span>}
          {file && <span className="small muted">Klik untuk ganti gambar</span>}
        </label>

        {status && (
          <div className="notice">
            <span className="spinner" /> {status}
          </div>
        )}

        {rows && (
          <>
            <div className="row gap-sm wrap">
              <label className="row gap-sm small">
                <span className="muted">“Party 1” di screenshot =</span>
                <select className="select-sm" value={offset} onChange={(e) => setOffset(Number(e.target.value))}>
                  {Array.from({ length: Math.max(1, ev.party_count) }, (_, i) => (
                    <option key={i} value={i}>
                      {partyName(i + 1)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="grow" />
              <span className="small muted">{`${ready.length} cocok · ${valid.length - ready.length} perlu dipilih`}</span>
            </div>

            {valid.length === 0 ? (
              <p className="notice notice-err small">
                Tidak ada nama yang terbaca. Pastikan screenshot memperlihatkan judul “Party …” dan nama karakter dengan jelas.
              </p>
            ) : (
              <div className="shot-list">
                {parties.map((p) => (
                  <div key={p} className="shot-party">
                    <div className="shot-party-name">{partyName(p)}</div>
                    {(rows || []).map((r, i) =>
                      target(r) !== p || r.slot > size ? null : (
                        <div key={i} className={`shot-row ${r.memberId ? (r.score >= 0.8 ? 'ok' : 'maybe') : 'miss'}`}>
                          <span className="shot-slot">{r.slot}</span>
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
                        </div>
                      ),
                    )}
                  </div>
                ))}
              </div>
            )}

            <label className="check-label small">
              <input type="checkbox" checked={clearOthers} onChange={(e) => setClearOthers(e.target.checked)} />
              <span>Keluarkan anggota lain dari party ini yang tidak ada di screenshot</span>
            </label>
            <p className="small muted">
              Nama yang tertutup (mis. oleh notifikasi item) tidak terbaca. Pilih manual di daftar di atas.
            </p>
            <div className="row gap-sm">
              <button className="btn btn-ghost" onClick={onClose}>
                Batal
              </button>
              <span className="grow" />
              <button className="btn btn-gold" disabled={busy || !ready.length} onClick={apply}>
                {busy ? 'Menyimpan…' : `Masukkan ${ready.length} karakter`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
