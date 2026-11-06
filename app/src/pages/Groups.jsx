import { useMemo, useState } from 'react'
import { rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { fmtNum, groupColor } from '../lib/util.js'
import MemberPicker from '../components/MemberPicker.jsx'
import JobIcon from '../components/JobIcon.jsx'

export default function Groups() {
  const { members, myMembers, groups, groupByMember, isAdmin, user, reloadGroups } = useApp()
  const [run, busy] = useAction()
  const [addTo, setAddTo] = useState(null) // group yang sedang ditambah anggota
  const [view, setView] = useState('mine')

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const inGroup = useMemo(() => new Set(groupByMember.keys()), [groupByMember])

  const canManage = (g) =>
    isAdmin || (g.group_members || []).some((gm) => memberById.get(gm.member_id)?.user_id === user.id)

  const mine = groups.filter((g) => (g.group_members || []).some((gm) => memberById.get(gm.member_id)?.user_id === user.id))
  const list = view === 'mine' ? mine : groups

  const removeMember = (g, m) => {
    const self = m.user_id === user.id
    const msg = self ? `Keluar dari party fix "${g.name}"?` : `Keluarkan ${m.name} dari "${g.name}"?`
    if (!confirm(msg + ((g.group_members?.length ?? 0) <= 2 ? '\nParty fix akan dibubarkan karena tersisa kurang dari 2 orang.' : '')))
      return
    run(async () => {
      const dissolved = await rpc('group_remove_member', { p_group_id: g.id, p_member_id: m.id })
      await reloadGroups()
      return dissolved
    }, self ? 'Anda keluar dari party fix' : `${m.name} dikeluarkan`)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Party Fix</h1>
          <p className="muted">
            Grup teman yang selalu main bersama, minimal 2 orang. Saat salah satu anggota bergabung ke papan party, seluruh grup
            ikut masuk bersama (lebih dari 5 orang akan dipecah ke party berikutnya). Setiap anggota bisa mengatur grupnya, dan
            siapa pun bisa keluar kapan saja.
          </p>
        </div>
      </div>

      <CreateGroup inGroup={inGroup} />

      <div className="tabs">
        <button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>
          Party fix saya ({mine.length})
        </button>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
          Semua ({groups.length})
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          {view === 'mine'
            ? myMembers.length
              ? 'Anda belum ada di party fix mana pun. Buat baru di atas.'
              : 'Klaim karakter Anda dulu di Roster.'
            : 'Belum ada party fix.'}
        </div>
      ) : (
        <div className="group-grid">
          {list.map((g) => {
            const ms = (g.group_members || []).map((gm) => memberById.get(gm.member_id)).filter(Boolean)
            const manage = canManage(g)
            const gs = ms.reduce((a, m) => a + (m.gear_score || 0), 0)
            return (
              <div className="card group-card" key={g.id} style={{ '--g': groupColor(g.id) }}>
                <div className="row gap-sm">
                  {manage ? (
                    <input
                      className="party-name-input group-name"
                      defaultValue={g.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== g.name)
                          run(async () => {
                            await rpc('rename_group', { p_group_id: g.id, p_name: v })
                            await reloadGroups()
                          }, 'Nama disimpan')
                      }}
                    />
                  ) : (
                    <span className="group-name grow">{g.name}</span>
                  )}
                  <span className="pill">{ms.length} orang</span>
                </div>
                <div className="small muted">
                  {Math.ceil(ms.length / 5)} party di game · GS total {fmtNum(gs)}
                </div>
                <ul className="side-list group-members">
                  {ms.map((m) => (
                    <li key={m.id} className="side-item">
                      <JobIcon m={m} />
                      <div className="slot-info">
                        <div className="slot-name">
                          {m.name}
                          {m.user_id === user.id && <span className="pill pill-green">Saya</span>}
                        </div>
                        <div className="small muted">
                          {m.class} · {m.role} · GS {fmtNum(m.gear_score)}
                        </div>
                      </div>
                      {manage && (
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeMember(g, m)}>
                          {m.user_id === user.id ? 'Keluar' : 'Keluarkan'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {manage && (
                  <div className="row gap-sm">
                    <button className="btn btn-sm" disabled={busy} onClick={() => setAddTo(g)}>
                      + Tambah anggota
                    </button>
                    <div className="grow" />
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Bubarkan party fix "${g.name}"? Anggota tetap di posisi party masing-masing.`))
                          run(async () => {
                            await rpc('delete_group', { p_group_id: g.id })
                            await reloadGroups()
                          }, 'Party fix dibubarkan')
                      }}
                    >
                      Bubarkan
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {addTo && (
        <MemberPicker
          title={`Tambah anggota ke "${addTo.name}"`}
          excludeIds={inGroup}
          onClose={() => setAddTo(null)}
          onPick={(mid) => {
            const g = addTo
            setAddTo(null)
            run(async () => {
              await rpc('group_add_member', { p_group_id: g.id, p_member_id: mid })
              await reloadGroups()
            }, `${memberById.get(mid)?.name} ditambahkan`)
          }}
        />
      )}
    </div>
  )
}

function CreateGroup({ inGroup }) {
  const { members, myMembers, isAdmin, reloadGroups } = useApp()
  const [run, busy] = useAction()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const [search, setSearch] = useState('')

  const freeMine = myMembers.filter((m) => !inGroup.has(m.id))
  const candidates = useMemo(() => {
    const s = search.trim().toLowerCase()
    return members
      .filter((m) => m.active && !inGroup.has(m.id) && !picked.includes(m.id))
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (m.class || '').toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50)
  }, [members, inGroup, picked, search])

  const byId = new Map(members.map((m) => [m.id, m]))

  function start() {
    setOpen(true)
    setPicked(freeMine.length ? [freeMine[0].id] : [])
  }

  async function submit() {
    const id = await run(() => rpc('create_group', { p_name: name, p_member_ids: picked }), 'Party fix dibuat')
    if (id) {
      await reloadGroups()
      setOpen(false)
      setName('')
      setPicked([])
      setSearch('')
    }
  }

  if (!open)
    return (
      <div className="card row gap wrap">
        <span className="grow muted">
          {freeMine.length || isAdmin
            ? 'Main bareng teman yang sama setiap war? Buat party fix supaya selalu masuk party bersama.'
            : myMembers.length
              ? 'Semua karakter Anda sudah ada di party fix.'
              : 'Klaim karakter Anda di Roster untuk membuat party fix.'}
        </span>
        {(freeMine.length > 0 || isAdmin) && (
          <button className="btn btn-gold" onClick={start}>
            + Buat party fix
          </button>
        )}
      </div>
    )

  return (
    <div className="card stack">
      <h3>Buat party fix</h3>
      <label className="form-grid">
        <span className="small muted">Nama party fix</span>
        <input placeholder="mis. Squad Kopi" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div>
        <div className="small muted">Anggota ({picked.length}) · minimal 2 orang</div>
        <div className="chip-row">
          {picked.map((id) => (
            <span key={id} className="pick-chip">
              {byId.get(id)?.name}
              <button onClick={() => setPicked((p) => p.filter((x) => x !== id))} title="Hapus">
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <input placeholder="Cari teman (nama / class) lalu klik untuk menambah…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="picker-list short">
        {candidates.map((m) => (
          <button key={m.id} className="picker-item" onClick={() => setPicked((p) => [...p, m.id])}>
            <JobIcon m={m} />
            <span className="grow">
              <b>{m.name}</b>
              <span className="small muted">
                {' '}
                · {m.class} · {m.role}
              </span>
            </span>
            <span className="small muted">+ tambah</span>
          </button>
        ))}
        {candidates.length === 0 && <p className="muted small pad">Tidak ada member yang cocok (atau sudah di party fix lain).</p>}
      </div>

      <div className="row gap-sm">
        <button className="btn btn-gold" disabled={busy || picked.length < 2} onClick={submit}>
          Buat party fix ({picked.length} orang)
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Batal
        </button>
      </div>
    </div>
  )
}
