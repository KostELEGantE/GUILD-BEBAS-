import { useCallback, useEffect, useState } from 'react'
import { rpc } from '../lib/supabase.js'
import { fmtNum } from '../lib/util.js'

// Batas paket GRATIS (dicek Nov 2026):
//   Supabase  : database 500 MB, file storage 1 GB, egress 5 GB/bulan, 50.000 MAU,
//               realtime 200 koneksi bersamaan & 2 juta pesan/bulan, dijeda setelah 1 minggu tanpa aktivitas.
//   Cloudflare Pages: 500 build/bulan, 25 MiB per file, 20.000 file, bandwidth tidak dibatasi.
const MB = 1024 * 1024
const SUPA_USAGE_URL = 'https://supabase.com/dashboard/org/ftuecmsuadhfexdjbemb/usage'
const CF_URL = 'https://dash.cloudflare.com/?to=/:account/pages/view/guild-bebas'
const GH_REPO = 'KostELEGantE/GUILD-BEBAS-'
const REFRESH_MS = 60_000

function fmtBytes(b) {
  if (b == null) return '–'
  if (b < 1024) return `${b} B`
  if (b < MB) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * MB) return `${(b / MB).toFixed(1)} MB`
  return `${(b / 1024 / MB).toFixed(2)} GB`
}

/** jumlah push ke main bulan ini = jumlah build Cloudflare Pages (API GitHub publik) */
async function buildsThisMonth() {
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  let n = 0
  for (let page = 1; page <= 6; page++) {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/commits?sha=main&per_page=100&page=${page}&since=${since}`)
    if (!r.ok) throw new Error(`GitHub ${r.status}`)
    const arr = await r.json()
    n += arr.length
    if (arr.length < 100) break
  }
  return n
}

function Meter({ label, used, limit, show, note }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const tone = pct >= 85 ? 'red' : pct >= 60 ? 'gold' : 'green'
  return (
    <div className="usage-item">
      <div className="usage-top">
        <span className="usage-label">{label}</span>
        <span className="usage-val">
          <b className="notranslate">{show(used)}</b> <span className="muted notranslate">/ {show(limit)}</span>
        </span>
      </div>
      <div className="meter">
        <div className={`meter-fill fill-${tone}`} style={{ width: `${Math.max(pct, used ? 1 : 0)}%` }} />
      </div>
      <div className="usage-foot small muted">
        <span className="notranslate">{pct < 0.1 && used ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}%</span>
        {note && <span>{note}</span>}
      </div>
    </div>
  )
}

export default function UsagePanel() {
  const [u, setU] = useState(null)
  const [builds, setBuilds] = useState(null) // angka, atau 'err'
  const [err, setErr] = useState(null)
  const [showTables, setShowTables] = useState(false)
  const [loading, setLoading] = useState(false)

  // ukuran file website yang sedang dibuka (index.html)
  const nav = typeof performance !== 'undefined' ? performance.getEntriesByType?.('navigation')?.[0] : null
  const [siteBytes, setSiteBytes] = useState(nav?.decodedBodySize || null)
  useEffect(() => {
    if (siteBytes || location.protocol === 'file:') return
    // dari cache browser: ukur ulang file halaman ini
    fetch(location.pathname, { cache: 'force-cache' })
      .then((r) => r.blob())
      .then((b) => setSiteBytes(b.size))
      .catch(() => {})
  }, [siteBytes])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setU(await rpc('admin_usage'))
      setErr(null)
    } catch (e) {
      setErr(e.message)
    }
    try {
      setBuilds(await buildsThisMonth())
    } catch {
      setBuilds('err')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  return (
    <section className="card usage-card">
      <div className="row gap-sm wrap">
        <h3 className="grow">📈 Kuota gratis (live)</h3>
        <span className="small muted">
          {u?.checked_at ? `Diperbarui ${new Date(u.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · otomatis tiap 1 menit` : ''}
        </span>
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={load}>
          {loading ? '…' : '↻ Perbarui'}
        </button>
      </div>
      {err && <p className="notice notice-err small">{err}</p>}

      <h4 className="usage-head">
        <span className="usage-logo supa">⚡</span> Supabase <span className="small muted">(database & login)</span>
      </h4>
      <div className="usage-grid">
        <Meter label="Ukuran database" used={u?.db_bytes ?? 0} limit={500 * MB} show={fmtBytes} />
        <Meter label="File storage" used={u?.storage_bytes ?? 0} limit={1024 * MB} show={fmtBytes} />
        <Meter
          label="Pengguna aktif bulan ini (MAU)"
          used={u?.mau ?? 0}
          limit={50000}
          show={(n) => fmtNum(n)}
          note={u ? `${fmtNum(u.users)} akun · ${fmtNum(u.active_7d)} aktif 7 hari` : null}
        />
      </div>
      <ul className="usage-notes small muted">
        <li>
          Egress (data keluar) 5 GB/bulan dan realtime (200 koneksi bersamaan, 2 juta pesan/bulan) tidak bisa dibaca dari
          database. Cek di{' '}
          <a href={SUPA_USAGE_URL} target="_blank" rel="noopener noreferrer">
            dashboard Supabase → Usage
          </a>
          .
        </li>
        <li>Proyek gratis dijeda jika 1 minggu tidak ada aktivitas. Selama website dibuka setiap minggu, aman.</li>
      </ul>
      {u?.tables?.length > 0 && (
        <>
          <button className="link-btn small usage-toggle" onClick={() => setShowTables((v) => !v)}>
            {showTables ? '▾ Sembunyikan rincian tabel' : '▸ Rincian per tabel'}
          </button>
          {showTables && (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Tabel</th>
                    <th className="num">Baris</th>
                    <th className="num">Ukuran</th>
                  </tr>
                </thead>
                <tbody>
                  {u.tables.map((t) => (
                    <tr key={t.name}>
                      <td className="notranslate">{t.name}</td>
                      <td className="num">{fmtNum(t.rows)}</td>
                      <td className="num notranslate">{fmtBytes(t.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h4 className="usage-head">
        <span className="usage-logo cf">☁</span> Cloudflare Pages <span className="small muted">(hosting website)</span>
      </h4>
      <div className="usage-grid">
        {typeof builds === 'number' ? (
          <Meter label="Build / deploy bulan ini" used={builds} limit={500} show={(n) => fmtNum(n)} note="1 update website = 1 build" />
        ) : (
          <div className="usage-item">
            <div className="usage-top">
              <span className="usage-label">Build / deploy bulan ini</span>
              <span className="usage-val muted">{builds === 'err' ? 'tidak bisa dicek' : '…'}</span>
            </div>
            <div className="small muted">batas 500 / bulan</div>
          </div>
        )}
        <Meter label="Ukuran file website" used={siteBytes ?? 0} limit={25 * MB} show={fmtBytes} note="batas per file" />
        <div className="usage-item">
          <div className="usage-top">
            <span className="usage-label">Bandwidth & kunjungan</span>
            <span className="usage-val text-green">∞</span>
          </div>
          <div className="small muted">Tidak dibatasi untuk website statis</div>
        </div>
      </div>
      <p className="small muted">
        Rincian lengkap:{' '}
        <a href={CF_URL} target="_blank" rel="noopener noreferrer">
          dashboard Cloudflare
        </a>
      </p>
    </section>
  )
}
