import { useMemo, useState } from 'react'
import { rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { ROLES, fmtNum, isOnline } from '../lib/util.js'
import JobIcon from './JobIcon.jsx'

const SORTS = {
  gear_score: (a, b) => (b.gear_score || 0) - (a.gear_score || 0),
  name: (a, b) => a.name.localeCompare(b.name),
  weekly_contribution: (a, b) => (b.weekly_contribution || 0) - (a.weekly_contribution || 0),
  class: (a, b) => (a.class || '').localeCompare(b.class || '') || (b.gear_score || 0) - (a.gear_score || 0),
}

/** Khusus moderator: daftar guild dari import, untuk mengecek siapa pemilik tiap karakter. */
export default function GuildList() {
  const { members, user, isAdmin, reloadMembers } = useApp()
  const [run, busy] = useAction()
  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('')
  const [role, setRole] = useState('')
  const [view, setView] = useState('all') // all | owned | unclaimed | notguild | inactive
  const [sort, setSort] = useState('gear_score')

  const classes = useMemo(() => [...new Set(members.map((m) => m.class).filter(Boolean))].sort(), [members])

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return members
      .filter((m) => (view === 'inactive' ? !m.active : m.active))
      .filter((m) => view !== 'owned' || m.user_id)
      .filter((m) => view !== 'unclaimed' || !m.user_id)
      .filter((m) => view !== 'notguild' || !m.last_import_at)
      .filter((m) => !cls || m.class === cls)
      .filter((m) => !role || m.role === role)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (isAdmin && (m.owner?.display_name || '').toLowerCase().includes(s)))
      .sort(SORTS[sort])
  }, [members, view, user.id, cls, role, search, sort])

  const counts = useMemo(() => {
    const act = members.filter((m) => m.active)
    return {
      total: act.length,
      claimed: act.filter((m) => m.user_id).length,
      notguild: act.filter((m) => !m.last_import_at).length,
      inactive: members.length - act.length,
      roles: ROLES.map((r) => [r, act.filter((m) => m.role === r).length]),
    }
  }, [members, user.id])

  const unclaim = (id) =>
    run(async () => {
      await rpc('unclaim_member', { p_member_id: id })
      await reloadMembers()
    }, 'Klaim dilepas')
  const renameOf = (m) => {
    const name = prompt(`Nama baru untuk "${m.name}" (sesuai nama di game):`, m.name)
    if (!name || name.trim() === m.name) return
    run(async () => {
      await rpc('rename_member', { p_member_id: m.id, p_name: name.trim() })
      await reloadMembers()
    }, `Nama diganti menjadi ${name.trim()}`)
  }
  const setRoleOf = (id, r) =>
    run(async () => {
      await rpc('set_member_role', { p_member_id: id, p_role: r })
      await reloadMembers()
    })

  return (
    <div className="card">
      <h3>Daftar guild &amp; pemilik akun</h3>
      <div>
        <div>
          <p className="muted small">
            Data dari import file member game. Karakter didaftarkan sendiri oleh pemiliknya di <b>Akun saya</b>; kalau IGN-nya
            sama, karakter di sini otomatis tersambung ke akunnya.
          </p>
          <p className="muted">
            {counts.total} member aktif · {counts.claimed} sudah terhubung ke akun ·{' '}
            {counts.roles.map(([r, n]) => `${n} ${r}`).join(' · ')}
          </p>
        </div>
      </div>


      <div className="tabs">
        {[
          ['all', `Semua (${counts.total})`],
          ['owned', `Punya akun (${counts.claimed})`],
          ['unclaimed', `Belum punya akun (${counts.total - counts.claimed})`],
          ['notguild', `Tidak ada di daftar guild (${counts.notguild})`],
          ['inactive', `Tidak aktif (${counts.inactive})`],
        ].map(([k, l]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="filters">
        <input placeholder="Cari nama karakter / pemilik…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="">Semua class</option>
          {classes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Semua role</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="gear_score">Urut: Gear Score</option>
          <option value="weekly_contribution">Urut: Kontribusi mingguan</option>
          <option value="class">Urut: Class</option>
          <option value="name">Urut: Nama</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table table-cards">
          <thead>
            <tr>
              <th>Karakter</th>
              <th className="num hide-sm">Lv</th>
              <th className="hide-xs">Class</th>
              <th>Role</th>
              <th className="num">Gear Score</th>
              <th className="num hide-sm">Kontribusi minggu ini</th>
              <th className="hide-sm">Jabatan</th>
              <th>Akun login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const mine = m.user_id === user.id
              const canRole = mine || isAdmin
              return (
                <tr key={m.id} className={mine ? 'row-mine' : ''}>
                  <td>
                    <span className={isOnline(m.online_status) ? 'online-dot' : 'offline-dot'} title={m.online_status || ''} />
                    <JobIcon m={m} size={32} />
                    <b>{m.name}</b>
                    {(mine || isAdmin) && (
                      <button className="icon-btn inline-edit" title="Ganti nama (jika nama di game berubah)" onClick={() => renameOf(m)}>
                        ✎
                      </button>
                    )}
                  </td>
                  <td className="num hide-sm" data-label="Lv">{m.level ?? '–'}</td>
                  <td className="hide-xs tc-class">{m.class ?? '–'}</td>
                  <td>
                    {canRole ? (
                      <select className="select-sm" value={m.role ?? ''} disabled={busy} onChange={(e) => setRoleOf(m.id, e.target.value)}>
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`role-tag role-${(m.role || 'dps').toLowerCase()}`}>{m.role ?? '–'}</span>
                    )}
                  </td>
                  <td className="num" data-label="GS">{fmtNum(m.gear_score)}</td>
                  <td className="num hide-sm" data-label="Kontribusi minggu ini">{fmtNum(m.weekly_contribution)}</td>
                  <td className="muted hide-sm notranslate">{m.position ?? '–'}</td>
                  <td>
                    {!m.user_id ? <span className="muted">belum punya akun</span> : <span className="notranslate">{m.owner?.display_name ?? 'diklaim'}</span>}
                    {!m.last_import_at && <span className="pill">tidak ada di daftar guild</span>}
                    {m.prev_names?.length > 0 && <div className="muted small notranslate">{`↩ ${m.prev_names.join(', ')}`}</div>}
                  </td>
                  <td className="actions">
                    {m.user_id && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Lepas ${m.name}${m.owner?.display_name ? ` dari akun ${m.owner.display_name}` : ''}?`)) unclaim(m.id)
                        }}
                      >
                        Lepas
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {list.length === 0 && members.length > 0 && <p className="muted pad">Tidak ada member yang cocok dengan filter.</p>}
      </div>
    </div>
  )
}
