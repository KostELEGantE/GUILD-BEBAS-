import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, q, rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { ATTEND_LABEL, nameKey } from '../lib/util.js'
import { readSheet, extractNames } from '../lib/sheet.js'

/** Tab kehadiran di halaman event */
export default function Attendance({ ev, signups, onChanged }) {
  const { members, isAdmin, toast } = useApp()
  const [att, setAtt] = useState([])
  const [run, busy] = useAction()
  const [names, setNames] = useState([])
  const [paste, setPaste] = useState('')
  const [fileName, setFileName] = useState(null)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    try {
      setAtt(await q(supabase.from('attendance').select('*').eq('event_id', ev.id)))
    } catch (e) {
      toast(e.message, 'err')
    }
  }, [ev.id, toast])

  useEffect(() => {
    load()
  }, [load])

  const byKey = useMemo(() => new Map(members.map((m) => [m.name_key ?? nameKey(m.name), m])), [members])
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const attBy = useMemo(() => new Map(att.map((a) => [a.member_id, a])), [att])
  const signedIds = new Set(signups.map((s) => s.member_id))

  // daftar gabungan: semua yang daftar + yang hadir tanpa daftar
  const rows = useMemo(() => {
    const ids = new Set([...signups.map((s) => s.member_id), ...att.map((a) => a.member_id)])
    return [...ids]
      .map((id) => ({ m: byId.get(id), a: attBy.get(id), signed: signedIds.has(id) }))
      .filter((r) => r.m)
      .sort((x, y) => x.m.name.localeCompare(y.m.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signups, att, byId, attBy])

  const count = (st) => att.filter((a) => a.status === st).length
  const noShow = att.filter((a) => a.status === 'absent' && signedIds.has(a.member_id)).length
  const walkIn = att.filter((a) => a.status === 'present' && !signedIds.has(a.member_id)).length

  // ---- import ----
  const preview = useMemo(() => {
    const uniq = [...new Map(names.map((n) => [nameKey(n), n])).values()]
    const matched = uniq.filter((n) => byKey.has(nameKey(n)))
    const unmatched = uniq.filter((n) => !byKey.has(nameKey(n)))
    const matchedIds = new Set(matched.map((n) => byKey.get(nameKey(n)).id))
    const willAbsent = signups.filter((s) => !matchedIds.has(s.member_id)).map((s) => byId.get(s.member_id)?.name)
    return { total: uniq.length, matched, unmatched, willAbsent }
  }, [names, byKey, signups, byId])

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const raw = await readSheet(file)
      const list = extractNames(raw)
      setNames(list)
      setFileName(file.name)
      setPaste('')
      setResult(null)
      if (!list.length) toast('Tidak ada nama yang terbaca di file', 'err')
    } catch (err) {
      toast('Gagal membaca file: ' + err.message, 'err')
    }
    e.target.value = ''
  }

  function onPaste(v) {
    setPaste(v)
    setFileName(null)
    setResult(null)
    setNames(
      v
        .split(/\r?\n|,|;|\t/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }

  async function submit() {
    const r = await run(
      () => rpc('import_attendance', { p_event_id: ev.id, p_names: names, p_filename: fileName ?? 'tempel manual' }),
      'Kehadiran disimpan',
    )
    if (r) {
      setResult(r)
      setNames([])
      setPaste('')
      await load()
      onChanged?.()
    }
  }

  async function setStatus(memberId, status) {
    await run(async () => {
      await rpc('set_attendance', { p_event_id: ev.id, p_member_id: memberId, p_status: status || null })
      await load()
    })
  }

  return (
    <div className="stack">
      <div className="stat-row">
        <Stat label="Hadir" value={count('present')} tone="green" />
        <Stat label="Tidak hadir" value={count('absent')} tone="red" />
        <Stat label="Izin" value={count('excused')} tone="gold" />
        <Stat label="No-show (daftar tapi tidak datang)" value={noShow} tone="red" />
        <Stat label="Hadir tanpa daftar" value={walkIn} />
      </div>

      {isAdmin && (
        <div className="card">
          <h3>Import kehadiran dari hasil game</h3>
          <p className="muted small">
            Upload file Excel/CSV daftar peserta event (kolom <code>Player</code>/<code>Name</code>, atau kolom pertama), atau
            tempel daftar nama (satu nama per baris). Nama yang ada = <b>hadir</b>. Yang daftar party tapi tidak ada di daftar ={' '}
            <b>tidak hadir</b>. Status <b>Izin</b> yang diisi manual tidak ditimpa. Setelah disimpan, event otomatis berstatus
            “Selesai” dan masuk ke statistik.
          </p>
          <div className="import-grid">
            <label className="dropzone">
              <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={onFile} hidden />
              <span>📄 Pilih file .xlsx / .csv</span>
              {fileName && <span className="small muted">{fileName}</span>}
            </label>
            <textarea
              rows={5}
              placeholder={'atau tempel nama di sini\nriicokucing\nLaoban\n…'}
              value={paste}
              onChange={(e) => onPaste(e.target.value)}
            />
          </div>

          {names.length > 0 && (
            <div className="preview">
              <div className="row gap wrap">
                <span className="pill pill-green">{preview.matched.length} cocok dengan roster</span>
                {preview.unmatched.length > 0 && (
                  <span className="pill pill-red">{preview.unmatched.length} tidak dikenal</span>
                )}
                {preview.willAbsent.length > 0 && (
                  <span className="pill pill-gold">{preview.willAbsent.length} pendaftar akan ditandai tidak hadir</span>
                )}
              </div>
              {preview.unmatched.length > 0 && (
                <p className="small">
                  <b>Tidak dikenal:</b> {preview.unmatched.join(', ')}{' '}
                  <span className="muted">— nama berbeda dari roster, atau member baru yang belum di-import.</span>
                </p>
              )}
              {preview.willAbsent.length > 0 && (
                <p className="small">
                  <b>Akan ditandai tidak hadir:</b> {preview.willAbsent.join(', ')}
                </p>
              )}
              <button className="btn btn-gold" disabled={busy || !preview.matched.length} onClick={submit}>
                Simpan kehadiran
              </button>
            </div>
          )}

          {result && (
            <div className="notice notice-ok">
              Tersimpan: {result.present} hadir, {result.absent} tidak hadir.
              {result.unmatched?.length ? ` ${result.unmatched.length} nama tidak dikenal dilewati.` : ''}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3>Daftar kehadiran</h3>
        {rows.length === 0 ? (
          <p className="muted small">Belum ada pendaftar maupun data kehadiran.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Karakter</th>
                  <th>Class</th>
                  <th>Daftar party</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, a, signed }) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="muted">{m.class}</td>
                    <td>{signed ? 'Ya' : <span className="muted">Tidak</span>}</td>
                    <td>
                      {isAdmin ? (
                        <select value={a?.status ?? ''} disabled={busy} onChange={(e) => setStatus(m.id, e.target.value)}>
                          <option value="">— belum —</option>
                          {Object.entries(ATTEND_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : a ? (
                        <span className={`att att-${a.status}`}>{ATTEND_LABEL[a.status]}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {a?.source === 'manual' && <span className="small muted"> (manual)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
