import { useMemo, useState } from 'react'
import { useApp } from '../context.jsx'
import GroupChip from './GroupChip.jsx'
import { ROLES, fmtNum, isOnline } from '../lib/util.js'
import JobIcon from './JobIcon.jsx'

/** Modal untuk admin memilih member yang dimasukkan ke slot */
/**
 * priorityGroupIds: party fix yang anggotanya sudah ada di party ini -> sisa anggotanya tampil paling atas,
 * dan bisa dimasukkan sekaligus (onPickGroup) lewat nama grup.
 */
export default function MemberPicker({ title, excludeIds, onPick, onClose, priorityGroupIds, onPickGroup }) {
  const { members, groupByMember, groups } = useApp()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [tab, setTab] = useState('players') // players | groups

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return members
      .filter((m) => m.active && !excludeIds.has(m.id))
      .filter((m) => !role || m.role === role)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (m.class || '').toLowerCase().includes(s))
      .sort((a, b) => (b.gear_score || 0) - (a.gear_score || 0))
  }, [members, excludeIds, search, role])

  // sisa anggota party fix yang sudah mulai mengisi party ini
  const prio = useMemo(() => {
    if (!priorityGroupIds?.size) return []
    const by = new Map()
    for (const m of list) {
      const g = groupByMember.get(m.id)
      if (!g || !priorityGroupIds.has(g.id)) continue
      ;(by.get(g.id) ?? by.set(g.id, { g, items: [] }).get(g.id)).items.push(m)
    }
    return [...by.values()]
  }, [list, priorityGroupIds, groupByMember])
  // semua party fix yang masih punya anggota belum masuk party
  const groupBlocks = useMemo(() => {
    const avail = new Map(members.filter((m) => m.active && !excludeIds.has(m.id)).map((m) => [m.id, m]))
    return (groups || [])
      .map((g) => ({ g, items: (g.group_members || []).map((x) => avail.get(x.member_id)).filter(Boolean), total: g.group_members?.length ?? 0 }))
      .filter((b) => b.items.length)
      .filter((b) => !search.trim() || b.g.name.toLowerCase().includes(search.trim().toLowerCase()) || b.items.some((m) => m.name.toLowerCase().includes(search.trim().toLowerCase())))
      .sort((a, b) => (priorityGroupIds?.has(b.g.id) ? 1 : 0) - (priorityGroupIds?.has(a.g.id) ? 1 : 0) || b.items.length - a.items.length)
  }, [groups, members, excludeIds, search, priorityGroupIds])
  const prioIds = new Set(prio.flatMap((b) => b.items.map((m) => m.id)))
  const rest = list.filter((m) => !prioIds.has(m.id))

  const item = (m) => (
    <button key={m.id} className="picker-item" onClick={() => onPick(m.id)}>
      <JobIcon m={m} />
      <span className="grow">
        <b>{m.name}</b>
        <span className="small muted">
          {' '}
          · {m.class} · {m.role}
        </span>
      </span>
      <GroupChip g={groupByMember.get(m.id)} />
      <span className="small muted">GS {fmtNum(m.gear_score)}</span>
      {isOnline(m.online_status) && <span className="online-dot" title="Online saat import terakhir" />}
    </button>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="row gap-sm">
          <input autoFocus placeholder="Cari nama / class…" value={search} onChange={(e) => setSearch(e.target.value)} className="grow" />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Semua role</option>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        {onPickGroup && (
          <div className="tabs picker-tabs">
            <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
              Pemain
            </button>
            <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
              {`Party fix (${groupBlocks.length})`}
            </button>
          </div>
        )}
        {tab === 'groups' && onPickGroup ? (
          <div className="picker-list">
            {groupBlocks.length === 0 && <p className="muted small pad">Semua anggota party fix sudah masuk party.</p>}
            {groupBlocks.map((b) => (
              <div key={b.g.id} className="picker-prio picker-group">
                <div className="picker-prio-head">
                  <b className="notranslate">{b.g.name}</b>
                  <span className="small muted">{`${b.items.length}/${b.total} belum masuk party`}</span>
                  <div className="grow" />
                  <button className="btn btn-sm btn-gold" onClick={() => onPickGroup(b.items.map((m) => m.id))}>
                    {`+ Masukkan semua (${b.items.length})`}
                  </button>
                </div>
                {b.items.map(item)}
              </div>
            ))}
          </div>
        ) : (
        <div className="picker-list">
          {list.length === 0 && <p className="muted small pad">Tidak ada member yang cocok (atau semua sudah masuk party).</p>}
          {prio.map((b) => (
            <div key={b.g.id} className="picker-prio">
              <div className="picker-prio-head">
                <span className="small muted">Party fix yang sudah mengisi party ini</span>
                <div className="grow" />
                {onPickGroup && (
                  <button className="btn btn-sm btn-gold" onClick={() => onPickGroup(b.items.map((m) => m.id))}>
                    {`+ Semua ${b.g.name} (${b.items.length})`}
                  </button>
                )}
              </div>
              {b.items.map(item)}
            </div>
          ))}
          {prio.length > 0 && rest.length > 0 && <div className="picker-sep small muted">Lainnya</div>}
          {rest.map(item)}
        </div>
        )}
      </div>
    </div>
  )
}
