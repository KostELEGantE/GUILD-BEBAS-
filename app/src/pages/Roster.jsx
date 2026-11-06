import { useMemo, useState } from 'react'
import { rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { ROLES, fmtNum, isOnline } from '../lib/util.js'
import JobIcon from '../components/JobIcon.jsx'

const SORTS = {
  gear_score: (a, b) => (b.gear_score || 0) - (a.gear_score || 0),
  name: (a, b) => a.name.localeCompare(b.name),
  weekly_contribution: (a, b) => (b.weekly_contribution || 0) - (a.weekly_contribution || 0),
  class: (a, b) => (a.class || '').localeCompare(b.class || '') || (b.gear_score || 0) - (a.gear_score || 0),
}

export default function Roster() {
  const { members, user, isAdmin, reloadMembers } = useApp()
  const [run, busy] = useAction()
  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('')
  const [role, setRole] = useState('')
  const [view, setView] = useState('all') // all | mine | unclaimed | inactive
  const [sort, setSort] = useState('gear_score')

  const classes = useMemo(() => [...new Set(members.map((m) => m.class).filter(Boolean))].sort(), [members])

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return members
      .filter((m) => (view === 'inactive' ? !m.active : m.active))
      .filter((m) => view !== 'mine' || m.user_id === user.id)
      .filter((m) => view !== 'unclaimed' || !m.user_id)
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
      mine: act.filter((m) => m.user_id === user.id).length,
      inactive: members.length - act.length,
      roles: ROLES.map((r) => [r, act.filter((m) => m.role === r).length]),
    }
  }, [members, user.id])

  const claim = (id) =>
    run(async () => {
      await rpc('claim_member', { p_member_id: id })
      await reloadMembers()
    }, 'Karakter diklaim — sekarang Anda bisa memasukkannya ke party')
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
    <div>
      <div className="page-head">
        <div>
          <h1>Roster guild</h1>
          <p className="muted">
            {counts.total} member aktif · {counts.claimed} sudah terhubung ke akun ·{' '}
            {counts.roles.map(([r, n]) => `${n} ${r}`).join(' · ')}
          </p>
        </div>
      </div>

      {members.length === 0 && (
        <div className="empty">
          Roster masih kosong.{' '}
          {isAdmin ? (
            <>
              Buka <a href="#/admin">Admin</a> lalu import file export member dari game.
            </>
          ) : (
            'Tunggu admin meng-import data member.'
          )}
        </div>
      )}

      <div className="tabs">
        {[
          ['all', `Semua (${counts.total})`],
          ['mine', `Karakter saya (${counts.mine})`],
          ['unclaimed', `Belum diklaim (${counts.total - counts.claimed})`],
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

      <div className="table-wrap card flush">
        <table className="table">
          <thead>
            <tr>
              <th>Karakter</th>
              <th className="num hide-sm">Lv</th>
              <th className="hide-xs">Class</th>
              <th>Role</th>
              <th className="num">Gear Score</th>
              <th className="num hide-sm">Kontribusi minggu ini</th>
              <th className="hide-sm">Jabatan</th>
              <th>{isAdmin ? 'Akun login' : 'Status'}</th>
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
                  <td className="num hide-sm">{m.level ?? '–'}</td>
                  <td className="hide-xs">{m.class ?? '–'}</td>
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
                  <td className="num">{fmtNum(m.gear_score)}</td>
                  <td className="num hide-sm">{fmtNum(m.weekly_contribution)}</td>
                  <td className="muted hide-sm notranslate">{m.position ?? '–'}</td>
                  <td>
                    {!m.user_id ? (
                      <span className="muted">belum diklaim</span>
                    ) : isAdmin ? (
                      m.owner?.display_name ?? 'diklaim'
                    ) : mine ? (
                      <span className="text-green">milik Anda</span>
                    ) : (
                      <span className="muted">diklaim</span>
                    )}
                  </td>
                  <td className="actions">
                    {!m.user_id && m.active && (
                      <button className="btn btn-sm" disabled={busy} onClick={() => claim(m.id)}>
                        Klaim
                      </button>
                    )}
                    {m.user_id && (mine || isAdmin) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => {
                          if (mine || confirm(`Lepas klaim ${m.name}${m.owner?.display_name ? ` dari akun ${m.owner.display_name}` : ''}?`)) unclaim(m.id)
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
