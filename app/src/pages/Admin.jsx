import UsagePanel from '../components/UsagePanel.jsx'
import GuildList from '../components/GuildList.jsx'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, q, rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { fmtDate, fmtNum, nameKey } from '../lib/util.js'
import { readSheet, toMemberRows } from '../lib/sheet.js'

const FIELDS = [
  ['level', 'Lv'],
  ['class', 'Class'],
  ['gear_score', 'GS'],
  ['position', 'Jabatan'],
  ['weekly_contribution', 'Kontribusi mingguan'],
  ['title', 'Title'],
]

export default function Admin() {
  // panel kuota hanya untuk Super Moderator
  const { isSuper } = useApp()
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="muted">Lihat data akun tiap member, cek daftar guild hasil import, dan atur moderator.</p>
        </div>
      </div>
      {isSuper && <UsagePanel />}
      <GuildSettings />
      <ImportMembers />
      <ImportHistory />
      <AdminUsers />
      <GuildList />
    </div>
  )
}

/** Pengaturan siapa yang boleh membuka papan Guild League */
function GuildSettings() {
  const { glAccess, reloadSettings } = useApp()
  const [run, busy] = useAction()
  const opts = [
    ['import', 'Hanya member hasil import', 'Akun harus punya karakter yang ada di import member terakhir. Ex-member dan karakter buatan sendiri yang belum diimport tidak bisa melihat roster.'],
    ['char', 'Semua yang punya karakter', 'Akun cukup mendaftarkan karakter sendiri di Akun saya (belum perlu ada di import).'],
    ['all', 'Semua akun yang login', 'Tidak wajib karakter: siapa pun yang login bisa melihat papan Guild League (masuk party tetap perlu karakter).'],
  ]
  return (
    <div className="card">
      <h2>
        Akses papan Guild League <span className="mod-pill">🛡 Khusus moderator</span>
      </h2>
      <p className="muted small">Siapa yang boleh melihat roster, susunan party, dan strategi perang Guild League. Moderator selalu bisa melihat.</p>
      <div className="access-opts">
        {opts.map(([k, label, desc]) => (
          <label key={k} className={`access-opt ${glAccess === k ? 'is-on' : ''}`}>
            <input
              type="radio"
              name="gl_access"
              checked={glAccess === k}
              disabled={busy}
              onChange={() => run(() => rpc('set_gl_access', { p: k }), 'Pengaturan disimpan').then(reloadSettings)}
            />
            <span>
              <b>{label}</b>
              <span className="small muted">{desc}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function ImportMembers() {
  const { members, reloadMembers } = useApp()
  const [run, busy] = useAction()
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const deactivate = true // setiap import: karakter yang tidak ada di file otomatis jadi "Bukan member"
  const [result, setResult] = useState(null)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [renames, setRenames] = useState({}) // member_id lama -> nama baru di file

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setResult(null)
    await run(async () => {
      const raw = await readSheet(f)
      const p = toMemberRows(raw)
      if (!p.hasName) throw new Error('Kolom nama tidak ditemukan. Pastikan ada kolom "Player" atau "Name".')
      setFile(f)
      setParsed(p)
    })
  }

  const base = useMemo(() => {
    if (!parsed) return null
    const existing = new Map(members.map((m) => [m.name_key ?? nameKey(m.name), m]))
    const inFile = new Set()
    const added = []
    const changed = []
    const same = []
    const reactivated = []
    for (const r of parsed.rows) {
      const k = nameKey(r.name)
      if (inFile.has(k)) continue
      inFile.add(k)
      const m = existing.get(k)
      if (!m) {
        added.push(r)
        continue
      }
      const ch = FIELDS.filter(([f]) => r[f] !== undefined && String(r[f] ?? '') !== String(m[f] ?? '')).map(([f, l]) => ({
        label: l,
        from: m[f],
        to: r[f],
      }))
      if (!m.active) reactivated.push(r)
      if (ch.length) changed.push({ r, ch })
      else same.push(r)
    }
    const missing = members.filter((m) => m.active && !inFile.has(m.name_key ?? nameKey(m.name)))
    return { added, changed, same, missing, reactivated, total: inFile.size }
  }, [parsed, members])

  // Tebak ganti nama: karakter lama yang hilang dari file vs nama baru di file
  useEffect(() => {
    setRenames(base ? guessRenames(base.missing, base.added) : {})
  }, [base])

  const diff = useMemo(() => {
    if (!base) return null
    const newNames = new Set(Object.values(renames).filter(Boolean).map(nameKey))
    const renamedIds = new Set(Object.keys(renames).filter((k) => renames[k]).map(Number))
    return {
      ...base,
      added: base.added.filter((r) => !newNames.has(nameKey(r.name))),
      missing: base.missing.filter((m) => !renamedIds.has(m.id)),
      renamed: base.missing.filter((m) => renamedIds.has(m.id)).map((m) => ({ m, to: renames[m.id] })),
      // ganti job: nama sama tapi class beda, atau ganti nama sekaligus ganti job
      jobs: [
        ...base.changed
          .filter(({ ch }) => ch.some((c) => c.label === 'Class' && c.from && c.to))
          .map(({ r, ch }) => ({ name: r.name, from: ch.find((c) => c.label === 'Class').from, to: r.class })),
        ...base.missing
          .filter((m) => renamedIds.has(m.id))
          .map((m) => ({ m, r: base.added.find((x) => x.name === renames[m.id]) }))
          .filter(({ m, r }) => r && m.class && r.class && m.class !== r.class)
          .map(({ m, r }) => ({ name: r.name, prev: m.name, from: m.class, to: r.class })),
      ],
    }
  }, [base, renames])

  async function submit() {
    const r = await run(async () => {
      const res = await rpc('import_members', {
        p_rows: parsed.rows,
        p_filename: file.name,
        p_deactivate_missing: deactivate,
        p_renames: diff.renamed.map(({ m, to }) => ({ id: m.id, name: to })),
      })
      await reloadMembers()
      return res
    }, 'Data member berhasil di-import')
    if (r) {
      setResult(r)
      setParsed(null)
      setFile(null)
    }
  }

  return (
    <div className="card">
      <h3>Import / update data member</h3>
      <p className="muted small">
        Upload file export member dari game (.csv atau .xlsx). Kolom yang dikenali: Player, Lv., Class, Title, Gender,
        Position, Gear Score, Weekly, Weekly Contribution, Total Contribution, Online Status. Member dicocokkan berdasarkan{' '}
        <b>nama karakter</b> (huruf besar/kecil diabaikan). Klaim akun dan role yang sudah diatur tidak akan hilang.
      </p>

      <label className="dropzone">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} hidden />
        <span>📄 {file ? 'Ganti file' : 'Pilih file export member'}</span>
        {file && <span className="small muted">{file.name}</span>}
      </label>

      {parsed?.unknownHeaders.length > 0 && (
        <p className="small muted">Kolom yang diabaikan: {parsed.unknownHeaders.join(', ')}</p>
      )}

      {diff && (
        <div className="preview">
          <div className="stat-row">
            <div className="stat stat-green">
              <div className="stat-value">{diff.added.length}</div>
              <div className="stat-label">Member baru</div>
            </div>
            <div className="stat stat-gold">
              <div className="stat-value">{diff.changed.length}</div>
              <div className="stat-label">Data berubah</div>
            </div>
            <div className="stat">
              <div className="stat-value">{diff.same.length}</div>
              <div className="stat-label">Tidak berubah</div>
            </div>
            <div className="stat">
              <div className="stat-value">{diff.renamed.length}</div>
              <div className="stat-label">Ganti nama</div>
            </div>
            <div className={`stat ${diff.jobs.length ? 'stat-gold' : ''}`}>
              <div className="stat-value">{diff.jobs.length}</div>
              <div className="stat-label">Ganti job</div>
            </div>
            <div className="stat stat-red">
              <div className="stat-value">{diff.missing.length}</div>
              <div className="stat-label">Tidak ada di file</div>
            </div>
          </div>

          {diff.jobs.length > 0 && (
            <div className="notice notice-job">
              <p className="small">
                <b>{`🔄 Ganti job (${diff.jobs.length}):`}</b>{' '}
                <span className="notranslate">
                  {diff.jobs.map((j) => `${j.name}${j.prev ? ` (dulu ${j.prev})` : ''}: ${j.from} → ${j.to}`).join(', ')}
                </span>
              </p>
              <p className="small muted">Peran mereka (DPS/Tank/Healer) ikut disesuaikan dengan job baru. Cek susunan party kalau perlu.</p>
            </div>
          )}

          {base.missing.length > 0 && base.added.length > 0 && (
            <div className="notice">
              <p className="small">
                <b>Ganti nama?</b> Karakter di bawah tidak ada di file. Nama baru dicocokkan dari kontribusi (tidak di-reset saat
                ganti nama, mulai dari 0 kalau baru masuk guild), aktivitas mingguan, level, dan CP; job dan gender boleh berubah.
                Kalau benar orang yang sama, pilih nama barunya: karakter lama akan <b>diganti nama</b>, dan klaim akun, party fix,
                posisi party, serta riwayat kehadirannya tetap tersimpan.
              </p>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Nama lama</th>
                      <th>Class</th>
                      <th className="num">Kontribusi total</th>
                      <th>Nama baru di file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {base.missing.map((m) => {
                      const taken = new Set(Object.entries(renames).filter(([k, v]) => v && Number(k) !== m.id).map(([, v]) => v))
                      const sc = (r) => renameEvidence(m, r)?.score ?? Infinity
                      const opts = base.added.filter((r) => !taken.has(r.name)).sort((a, b) => sc(a) - sc(b) || a.name.localeCompare(b.name))
                      const sel = base.added.find((r) => r.name === renames[m.id])
                      const ev = sel ? renameEvidence(m, sel) : null
                      return (
                        <tr key={m.id} className={renames[m.id] ? 'row-mine' : ''}>
                          <td>
                            <b>{m.name}</b>
                            {m.owner && <div className="small muted">{m.owner.display_name}</div>}
                          </td>
                          <td className="muted">{m.class}</td>
                          <td className="num">
                            {fmtNum(m.total_contribution)}
                            {sel && <span className="muted"> → {fmtNum(sel.total_contribution)}</span>}
                            {ev?.exact && <div><span className="pill pill-green" title="Kenaikan kontribusi total = kenaikan kontribusi mingguan">✓ kontribusi cocok</span></div>}
                            {ev?.jobChanged && <div><span className="pill pill-gold">{`job berubah: ${m.class} → ${sel.class}`}</span></div>}
                            {ev?.genderChanged && <div><span className="pill pill-gold">gender berubah</span></div>}
                            {sel && !ev && <div><span className="pill pill-red" title="Kontribusi/level tidak cocok untuk ganti nama">data tidak cocok</span></div>}
                          </td>
                          <td>
                            <select
                              value={renames[m.id] || ''}
                              onChange={(e) => setRenames((o) => ({ ...o, [m.id]: e.target.value }))}
                            >
                              <option value="">— bukan ganti nama —</option>
                              {opts.map((r) => (
                                <option key={r.name} value={r.name}>
                                  {`${r.name} · ${r.class} · Lv ${r.level}${renameEvidence(m, r) ? '' : ' · (tidak cocok)'}`}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {diff.added.length > 0 && (
            <details open={diff.added.length <= 20}>
              <summary>Member baru ({diff.added.length})</summary>
              <p className="small">
                {diff.added.map((r) => `${r.name} (${r.class || '?'}, GS ${fmtNum(r.gear_score)})`).join(' · ')}
              </p>
            </details>
          )}
          {diff.reactivated.length > 0 && (
            <p className="small">
              <b>Aktif kembali:</b> {diff.reactivated.map((r) => r.name).join(', ')}
            </p>
          )}
          {diff.changed.length > 0 && (
            <details open>
              <summary>Data berubah ({diff.changed.length})</summary>
              <div className="table-wrap">
                <table className="table compact">
                  <tbody>
                    {diff.changed.slice(0, 200).map(({ r, ch }) => (
                      <tr key={r.name}>
                        <td>
                          <b>{r.name}</b>
                        </td>
                        <td className="small">
                          {ch.map((c) => (
                            <span key={c.label} className="change">
                              {c.label}: <s className="muted">{c.from ?? '–'}</s> → {c.to || '–'}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {diff.same.length > 0 && (
            <button className="link-btn" onClick={() => setShowUnchanged((v) => !v)}>
              {showUnchanged ? 'Sembunyikan' : 'Lihat'} {diff.same.length} member tidak berubah
            </button>
          )}
          {showUnchanged && <p className="small muted">{diff.same.map((r) => r.name).join(', ')}</p>}

          {diff.missing.length > 0 && (
            <div className="notice">
              <p className="small">
                <b>{diff.missing.length} member aktif tidak ada di file ini:</b> {diff.missing.map((m) => m.name).join(', ')}
              </p>
              <p className="small muted">
                Setelah import, mereka otomatis berstatus <b>Bukan member</b>. Data dan riwayatnya tetap tersimpan, dan statusnya kembali jadi member
                kalau namanya muncul lagi di import berikutnya.
              </p>
            </div>
          )}

          <div className="row gap-sm">
            <button className="btn btn-gold" disabled={busy} onClick={submit}>
              Import {diff.total} member
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setParsed(null)
                setFile(null)
              }}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="notice notice-ok">
          Selesai: {result.new} member baru, {result.updated} diperbarui
          {result.renamed ? `, ${result.renamed} ganti nama` : ''}
          {result.deactivated ? `, ${result.deactivated} dinonaktifkan` : ''}.
        </div>
      )}
    </div>
  )
}

function ImportHistory() {
  const { members } = useApp()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState({ k: 'time', dir: -1 })
  useEffect(() => {
    q(supabase.from('imports').select('*, by:profiles(display_name)').order('created_at', { ascending: false }).limit(100))
      .then(setRows)
      .catch(() => {})
  }, [members])
  if (!rows.length) return null
  const KIND = { members: 'Data member', attendance: 'Kehadiran', war: 'Hasil war' }
  const counts = rows.reduce((c, r) => ({ ...c, [r.kind]: (c[r.kind] || 0) + 1 }), {})
  const val = {
    time: (r) => new Date(r.created_at).getTime(),
    kind: (r) => KIND[r.kind] || r.kind,
    file: (r) => (r.filename || '').toLowerCase(),
    rows: (r) => r.row_count ?? 0,
    by: (r) => (r.by?.display_name || '').toLowerCase(),
  }
  const shown = rows
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => {
      const x = val[sort.k](a), y = val[sort.k](b)
      return x === y ? 0 : (x < y ? -1 : 1) * sort.dir
    })
  const Th = ({ k, num, children }) => (
    <th
      className={`sortable ${num ? 'num' : ''} ${sort.k === k ? 'is-sorted' : ''}`}
      onClick={() => setSort(sort.k === k ? { k, dir: -sort.dir } : { k, dir: k === 'time' || k === 'rows' ? -1 : 1 })}
    >
      {children}
      <span className="sort-ind">{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ' ↕'}</span>
    </th>
  )
  return (
    <div className="card">
      <h3>Riwayat import</h3>
      <div className="act-gldetail-chips import-filter">
        <button className={!kind ? 'is-on' : ''} onClick={() => setKind('')}>{`Semua ${rows.length}`}</button>
        {Object.keys(KIND)
          .filter((k) => counts[k])
          .map((k) => (
            <button key={k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(kind === k ? '' : k)}>
              {`${KIND[k]} ${counts[k]}`}
            </button>
          ))}
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <Th k="time">Waktu</Th>
              <Th k="kind">Jenis</Th>
              <Th k="file">File</Th>
              <Th k="rows" num>
                Baris
              </Th>
              <Th k="by">Oleh</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const c = r.changes
              const nNew = c?.new?.length ?? 0
              const nLeft = c?.left?.length ?? 0
              const nRen = c?.renamed?.length ?? 0
              const nJob = c?.jobs?.length ?? 0
              const has = nNew + nLeft + nRen + nJob > 0
              return (
                <Fragment key={r.id}>
                  <tr className={has ? 'import-row clickable' : 'import-row'} onClick={() => has && setOpen(open === r.id ? null : r.id)}>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>
                      <span className={`import-kind import-${r.kind}`}>{KIND[r.kind] || r.kind}</span>
                    </td>
                    <td className="muted">{r.filename}</td>
                    <td className="num">{r.row_count}</td>
                    <td>
                      {r.by?.display_name ?? '–'}{' '}
                      {has && (
                        <span className="import-badges">
                          {nNew > 0 && <span className="pill pill-green">{`+${nNew} baru`}</span>}
                          {nLeft > 0 && <span className="pill pill-red">{`−${nLeft} keluar`}</span>}
                          {nRen > 0 && <span className="pill pill-gold">{`${nRen} ganti nama`}</span>}
                          {nJob > 0 && <span className="pill pill-blue">{`${nJob} ganti job`}</span>}
                          <span className="muted small">{open === r.id ? '▲' : '▼'}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="import-detail">
                      <td colSpan={5}>
                        <div className="imp-changes">
                          {nNew > 0 && (
                            <section className="imp-grp imp-new">
                              <h4>{`➕ Member baru · ${nNew}`}</h4>
                              <div className="imp-chips notranslate">
                                {c.new.map((n) => (
                                  <span key={n} className="imp-chip">{n}</span>
                                ))}
                              </div>
                            </section>
                          )}
                          {nLeft > 0 && (
                            <section className="imp-grp imp-left">
                              <h4>{`➖ Keluar / tidak ada di file · ${nLeft}`}</h4>
                              <div className="imp-chips notranslate">
                                {c.left.map((n) => (
                                  <span key={n} className="imp-chip">{n}</span>
                                ))}
                              </div>
                            </section>
                          )}
                          {nRen > 0 && (
                            <section className="imp-grp imp-ren">
                              <h4>{`✏️ Ganti nama · ${nRen}`}</h4>
                              <div className="imp-chips notranslate">
                                {c.renamed.map((x) => (
                                  <span key={x.from + x.to} className="imp-chip">
                                    <span className="muted">{x.from}</span> → <b>{x.to}</b>
                                  </span>
                                ))}
                              </div>
                            </section>
                          )}
                          {nJob > 0 && (
                            <section className="imp-grp imp-job">
                              <h4>{`🔄 Ganti job · ${nJob}`}</h4>
                              <div className="imp-chips notranslate">
                                {c.jobs.map((x) => (
                                  <span key={x.name} className="imp-chip">
                                    <b>{x.name}</b> <span className="muted">{x.from}</span> → {x.to}
                                  </span>
                                ))}
                              </div>
                            </section>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ROLE_LABEL = { member: 'Member biasa', sub: 'Sub Moderator', monitor: 'Moderator Monitoring', super: 'Super Moderator' }
const ROLE_HELP = {
  sub: 'Sub Moderator bisa import data, mengatur semua party dan event, konfirmasi war, serta mengangkat/mencabut sesama Sub Moderator.',
  monitor: 'Moderator Monitoring punya hak Sub Moderator, tapi hanya untuk mengelola: tidak punya karakter dan tidak bisa dimasukkan ke party. Karakter yang sudah diklaim akun ini akan dilepas.',
  super: 'Super Moderator punya akses penuh, termasuk mengangkat dan mencabut Super Moderator lain.',
}

function AdminUsers() {
  const { user, members, reloadMembers, isSuper } = useApp()
  const [run, busy] = useAction()
  const [profiles, setProfiles] = useState([])
  const [view, setView] = useState('all') // all | multi | none | admin
  const [search, setSearch] = useState('')
  const load = useCallback(() => q(supabase.from('profiles').select('*').order('display_name')).then(setProfiles), [])
  // email & cara login: hanya Super Moderator (untuk mengenali akun asing)
  const [accts, setAccts] = useState(new Map())
  useEffect(() => {
    load().catch(() => {})
    if (isSuper)
      rpc('admin_accounts')
        .then((rows) => setAccts(new Map((rows || []).map((r) => [r.id, r]))))
        .catch(() => {})
  }, [load, isSuper])

  // karakter yang diklaim per akun
  const claims = useMemo(() => {
    const map = new Map()
    for (const m of members) if (m.user_id) map.set(m.user_id, [...(map.get(m.user_id) || []), m])
    return map
  }, [members])

  const multi = profiles.filter((p) => (claims.get(p.id)?.length ?? 0) > 1)
  const none = profiles.filter((p) => !claims.get(p.id)?.length)
  const admins = profiles.filter((p) => p.is_admin && !p.banned_at)
  const banned = profiles.filter((p) => p.banned_at)
  const nameOf = (id) => profiles.find((x) => x.id === id)?.display_name ?? '–'

  const list = (view === 'multi' ? multi : view === 'none' ? none : view === 'admin' ? admins : view === 'banned' ? banned : profiles)
    .filter((p) => {
      const s = search.trim().toLowerCase()
      if (!s) return true
      return (
        (p.display_name || '').toLowerCase().includes(s) ||
        (accts.get(p.id)?.email || '').toLowerCase().includes(s) ||
        (claims.get(p.id) || []).some((m) => m.name.toLowerCase().includes(s))
      )
    })
    .sort((a, b) => (claims.get(b.id)?.length ?? 0) - (claims.get(a.id)?.length ?? 0) || (a.display_name || '').localeCompare(b.display_name || ''))

  const roleOf = (p) => (p.is_super ? 'super' : p.is_monitor ? 'monitor' : p.is_admin ? 'sub' : 'member')
  const setRole = (p, role) => {
    const label = ROLE_LABEL[role]
    if (role !== 'member' && !confirm(`Jadikan ${p.display_name} ${label}?\n\n${ROLE_HELP[role]}`)) return
    if (role === 'member' && !confirm(`Cabut peran moderator ${p.display_name}?`)) return
    run(async () => {
      // Super Moderator yang sudah monitoring tetap monitoring
      const monitor = role === 'monitor' || (role === 'super' && !!p.is_monitor)
      await q(supabase.from('profiles').update({ is_admin: role !== 'member', is_super: role === 'super', is_monitor: monitor }).eq('id', p.id))
      await load()
    }, `${p.display_name} sekarang ${label}`)
  }

  const ban = (p) => {
    const reason = prompt(`Blokir akun ${p.display_name}?\n\nAkun ini akan langsung keluar dan tidak bisa membuka website lagi sampai blokirnya dibuka.\n\nAlasan (boleh dikosongkan):`, '')
    if (reason === null) return
    const cs = claims.get(p.id) || []
    const release = cs.length > 0 && confirm(`Lepas juga klaim karakternya (${cs.map((m) => m.name).join(', ')})?\n\nOK = lepas klaim, Batal = biarkan tetap diklaim`)
    run(async () => {
      await rpc('ban_user', { p_user_id: p.id, p_reason: reason, p_release_claims: release })
      await Promise.all([load(), reloadMembers()])
    }, `${p.display_name} diblokir`)
  }
  const unban = (p) => {
    if (!confirm(`Buka blokir akun ${p.display_name}? Akun ini bisa login lagi.`)) return
    run(async () => {
      await rpc('unban_user', { p_user_id: p.id })
      await load()
    }, `Blokir ${p.display_name} dibuka`)
  }

  const unclaim = (p, m) => {
    if (!confirm(`Lepas klaim ${m.name} dari akun ${p.display_name}?`)) return
    run(async () => {
      await rpc('unclaim_member', { p_member_id: m.id })
      await reloadMembers()
    }, `Klaim ${m.name} dilepas`)
  }

  return (
    <div className="card">
      <h3>Akun terdaftar ({profiles.length})</h3>
      <p className="muted small">
        <b>Super Moderator</b> mengatur semua peran. <b>Sub Moderator</b> mengelola guild (party, event, import, konfirmasi war)
        dan bisa mengangkat atau mencabut sesama Sub Moderator, tapi tidak bisa mengubah Super Moderator.
      </p>
      <p className="muted small">
        Semua yang pernah login, beserta karakter yang mereka daftarkan sendiri (class, level, Gear Score, nama lama). Akun dengan lebih dari 1 karakter ditandai{' '}
        <span className="pill pill-gold">2+ karakter</span>; periksa apakah itu memang alt miliknya, atau lepas karakternya.
      </p>
      <p className="muted small">
        <b>Blokir</b> membuat akun langsung keluar dan tidak bisa membuka website lagi. Super Moderator tidak bisa diblokir.
        Blokir bisa dibuka kapan saja dari tab <b>Diblokir</b>.
      </p>

      <div className="tabs">
        {[
          ['all', `Semua (${profiles.length})`],
          ['multi', `Lebih dari 1 karakter (${multi.length})`],
          ['none', `Belum daftar karakter (${none.length})`],
          ['admin', `Moderator (${admins.length})`],
          ['banned', `Diblokir (${banned.length})`],
        ].map(([k, l]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="filters">
        <input placeholder="Cari nama akun / karakter…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Akun login (Discord/Google)</th>
              <th>Karakter terdaftar</th>
              <th>Bergabung</th>
              <th>Peran</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const cs = claims.get(p.id) || []
              return (
                <tr key={p.id} className={p.banned_at ? 'row-banned' : cs.length > 1 ? 'row-warn' : ''}>
                  <td>
                    <div className="row gap-sm">
                      {p.avatar_url && <img src={p.avatar_url} alt="" className="avatar avatar-sm" />}
                      <b>{p.display_name}</b>
                      {p.id === user.id && <span className="small muted">(Anda)</span>}
                      {p.banned_at && <span className="pill pill-red">Diblokir</span>}
                    </div>
                    {isSuper && accts.get(p.id) && (
                      <div className="acct-line small">
                        {accts
                          .get(p.id)
                          .providers.split(',')
                          .filter(Boolean)
                          .map((pv) => (
                            <span key={pv} className={`prov prov-${pv}`}>
                              {pv === 'discord' ? 'Discord' : pv === 'google' ? 'Google' : 'Email'}
                            </span>
                          ))}
                        <span className="notranslate acct-email">{accts.get(p.id).email || '—'}</span>
                        {accts.get(p.id).providers === 'email' && !accts.get(p.id).email_confirmed && (
                          <span className="pill pill-red">email belum dikonfirmasi</span>
                        )}
                      </div>
                    )}
                    {p.banned_at && (
                      <div className="small muted">
                        {fmtDate(p.banned_at)} · oleh <span className="notranslate">{nameOf(p.banned_by)}</span>
                        {p.ban_reason && (
                          <>
                            {' · '}
                            <span className="notranslate">“{p.ban_reason}”</span>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="wrap-cell">
                    {cs.length === 0 ? (
                      <span className="muted small">belum daftar karakter</span>
                    ) : (
                      <div className="claim-list">
                        {cs.length > 1 && <span className="pill pill-gold">{cs.length} karakter</span>}
                        {cs.map((m) => (
                          <span key={m.id} className="claim-chip" title={`${m.class} · GS ${fmtNum(m.gear_score)}`}>
                            <b className="notranslate">{m.name}</b>
                            <span className="muted">{` · ${m.class || '–'} · ${m.role || '–'} · Lv ${m.level ?? '–'} · GS ${fmtNum(m.gear_score)}`}</span>
                            {!m.last_import_at && <span className="pill">tidak ada di daftar guild</span>}
                            {m.prev_names?.length > 0 && <span className="muted notranslate">{` ↩ ${m.prev_names.join(', ')}`}</span>}
                            {!m.active && <span className="pill pill-grey">Bukan member</span>}
                            <button title="Lepas klaim" disabled={busy} onClick={() => unclaim(p, m)}>
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="muted">{fmtDate(p.created_at, false)}</td>
                  <td>
                    {p.id === user.id || (p.is_super && !isSuper) ? (
                      <span className={`pill ${p.is_super ? 'pill-gold' : p.is_admin ? 'pill-green' : ''}`}>{`${ROLE_LABEL[roleOf(p)]}${p.is_super && p.is_monitor ? ' · Monitoring' : ''}`}</span>
                    ) : (
                      <select className="select-sm" value={roleOf(p)} disabled={busy} onChange={(e) => setRole(p, e.target.value)}>
                        <option value="member">Member biasa</option>
                        <option value="sub">Sub Moderator</option>
                        <option value="monitor">Moderator Monitoring</option>
                        {isSuper && <option value="super">Super Moderator</option>}
                      </select>
                    )}
                  </td>
                  <td className="actions">
                    {p.banned_at ? (
                      <button className="btn btn-sm" disabled={busy} onClick={() => unban(p)}>
                        Buka blokir
                      </button>
                    ) : (
                      p.id !== user.id &&
                      !p.is_super && (
                        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => ban(p)}>
                          Blokir
                        </button>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="muted small">
                  Tidak ada akun di kategori ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Pasangkan karakter yang hilang dengan nama baru di file.
 * Syarat: class sama, gender sama (jika ada), level & kontribusi total tidak turun.
 * Pasangan dengan selisih kontribusi terkecil dipilih lebih dulu.
 */
/** Minggu (Senin 00:00 WIB) dari sebuah waktu, untuk membandingkan kontribusi/aktivitas mingguan */
const weekKeyWIB = (t) => {
  if (!t) return null
  const d = new Date(new Date(t).getTime() + 7 * 3600e3) // geser ke WIB
  const dow = (d.getUTCDay() + 6) % 7 // Senin = 0
  return Math.floor((d.getTime() - dow * 86400e3) / 86400e3)
}

/**
 * Bukti ganti nama antara karakter lama (hilang dari file) dan nama baru di file.
 * Aturan:
 *  1. Total kontribusi = kontribusi mingguan  -> orang baru masuk guild (kontribusi mulai dari 0), bukan ganti nama.
 *  2. Minggu sama: kenaikan total = kenaikan mingguan (dan aktivitas mingguan tidak turun) -> pasti ganti nama.
 *  3. Beda minggu: kenaikan total harus >= kontribusi mingguan baru.
 *  Nilai = kenaikan total + selisih CP / 5 (/ 10 kalau job berubah). Job & gender boleh berubah (hanya ditandai).
 * Hasil null = tidak mungkin orang yang sama.
 */
export function renameEvidence(m, r, now = Date.now()) {
  const num = (v) => (v === '' || v == null ? null : Number(v))
  const t1 = num(r.total_contribution), w1 = num(r.weekly_contribution), a1 = num(r.weekly)
  if (t1 != null && w1 != null && t1 <= w1) return null // baru masuk guild
  const lv0 = num(m.level), lv1 = num(r.level)
  if (lv0 != null && lv1 != null && lv1 < lv0) return null
  const t0 = num(m.total_contribution), w0 = num(m.weekly_contribution), a0 = num(m.weekly)
  if (t0 != null && t1 != null && t1 < t0) return null
  const sameWeek = m.last_import_at && weekKeyWIB(m.last_import_at) === weekKeyWIB(now)
  let exact = false
  if (sameWeek) {
    if (a0 != null && a1 != null && a1 < a0) return null // aktivitas mingguan tidak mungkin turun di minggu yang sama
    if (w0 != null && w1 != null && w1 < w0) return null
    exact = t0 != null && t1 != null && w0 != null && w1 != null && t1 - t0 === w1 - w0
  } else if (t0 != null && t1 != null && w1 != null && t1 - t0 < w1) return null
  const jobChanged = !!(m.class && r.class && m.class !== r.class)
  const genderChanged = !!(m.gender && r.gender && m.gender !== r.gender)
  const g0 = num(m.gear_score), g1 = num(r.gear_score)
  const cp = g0 != null && g1 != null ? Math.abs(g1 - g0) / (jobChanged ? 10 : 5) : 1000
  const score = exact ? 0 : (t0 != null && t1 != null ? t1 - t0 : 5000) + cp
  if (score > 20000) return null
  return { score, exact, jobChanged, genderChanged }
}

export function guessRenames(missing, added, now = Date.now()) {
  const pairs = []
  for (const m of missing)
    for (const r of added) {
      const ev = renameEvidence(m, r, now)
      if (ev) pairs.push({ m, r, score: ev.score })
    }
  pairs.sort((a, b) => a.score - b.score)
  const out = {}
  const used = new Set()
  for (const { m, r } of pairs) {
    if (out[m.id] || used.has(r.name)) continue
    out[m.id] = r.name
    used.add(r.name)
  }
  return out
}
