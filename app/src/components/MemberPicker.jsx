import { useMemo, useState } from 'react'
import { useApp } from '../context.jsx'
import GroupChip from './GroupChip.jsx'
import { ROLES, fmtNum, isOnline } from '../lib/util.js'
import JobIcon from './JobIcon.jsx'

/** Modal untuk admin memilih member yang dimasukkan ke slot */
export default function MemberPicker({ title, excludeIds, onPick, onClose }) {
  const { members, groupByMember } = useApp()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return members
      .filter((m) => m.active && !excludeIds.has(m.id))
      .filter((m) => !role || m.role === role)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (m.class || '').toLowerCase().includes(s))
      .sort((a, b) => (b.gear_score || 0) - (a.gear_score || 0))
  }, [members, excludeIds, search, role])

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
        <div className="picker-list">
          {list.length === 0 && <p className="muted small pad">Tidak ada member yang cocok (atau semua sudah masuk party).</p>}
          {list.map((m) => (
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
          ))}
        </div>
      </div>
    </div>
  )
}
