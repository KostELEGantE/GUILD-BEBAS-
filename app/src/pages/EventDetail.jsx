import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, q, rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import {
  modeOf, ROLES, STATUS_LABEL, fmtDate, fmtNum, isOnline, navigate, groupColor, toLocalInput, sectionsOf, defaultPartyName, debounce,
} from '../lib/util.js'
import { EventForm } from './Events.jsx'
import Attendance from './Attendance.jsx'
import MemberPicker from '../components/MemberPicker.jsx'
import GroupChip from '../components/GroupChip.jsx'
import JobIcon from '../components/JobIcon.jsx'
import ScreenshotFill from '../components/ScreenshotFill.jsx'

export default function EventDetail({ id }) {
  const { members, myMembers, isAdmin: isMod, toast, groupByMember, groups, user } = useApp()
  const [ev, setEv] = useState(null)
  const [parties, setParties] = useState([])
  const [signups, setSignups] = useState([])
  const [tab, setTab] = useState('party')
  const [editing, setEditing] = useState(false)
  const [myChar, setMyChar] = useState(null)
  const [picked, setPicked] = useState(null) // member_id yang sedang dipindah
  const [pickedGroup, setPickedGroup] = useState(null) // party fix yang sedang dipindah (klik)
  const [fillParty, setFillParty] = useState(null) // party yang baru diklaim leader -> jendela isi party
  const [leaderPick, setLeaderPick] = useState(null) // moderator menunjuk leader untuk party ini
  const [pickerSlot, setPickerSlot] = useState(null) // {party_no, slot_no}
  const [shotOpen, setShotOpen] = useState(false) // isi party dari screenshot game
  const [groupAsk, setGroupAsk] = useState(null) // {memberId, g, party_no, slot_no}: seluruh party fix atau satu orang?
  const [dragId, setDragId] = useState(null) // member_id yang sedang diseret
  const [over, setOver] = useState(null) // 'p' | 'p-s' | 'side' yang sedang disorot
  const [run, busy] = useAction()

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const loadSignups = useCallback(async () => {
    setSignups(await q(supabase.from('event_signups').select('*').eq('event_id', id)))
  }, [id])

  const loadParties = useCallback(async () => {
    setParties(await q(supabase.from('event_parties').select('*').eq('event_id', id)))
  }, [id])

  const load = useCallback(async () => {
    try {
      const [e] = await Promise.all([
        q(supabase.from('events').select('*').eq('id', id).maybeSingle()),
        loadParties(),
        loadSignups(),
      ])
      setEv(e ?? false)
    } catch (err) {
      toast(err.message, 'err')
    }
  }, [id, loadParties, loadSignups, toast])

  useEffect(() => {
    setTab('party')
    setPicked(null)
    load()
  }, [load])

  // Realtime: semua perubahan (masuk, pindah, keluar slot, nama party, pengaturan papan)
  // langsung terlihat oleh semua yang membuka halaman ini, tanpa refresh.
  const [live, setLive] = useState(false)
  useEffect(() => {
    const reSignups = debounce(() => loadSignups().catch(() => {}), 120)
    const reParties = debounce(() => loadParties().catch(() => {}), 120)
    const isMine = (p) => (p.new?.event_id ?? p.old?.event_id) === id
    const ch = supabase
      .channel(`event-${id}`)
      // event DELETE tidak bisa difilter oleh Supabase, jadi dicek di sini
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_signups' }, (p) => {
        if (isMine(p) || (p.eventType === 'DELETE' && p.old?.event_id == null)) reSignups()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_parties' }, (p) => {
        if (isMine(p) || (p.eventType === 'DELETE' && p.old?.event_id == null)) reParties()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${id}` }, (payload) =>
        setEv((old) => ({ ...old, ...payload.new })),
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    // kembali ke tab / koneksi pulih: ambil data terbaru sekali
    const resync = () => {
      if (document.visibilityState === 'visible') {
        reSignups()
        reParties()
      }
    }
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('online', resync)
    return () => {
      reSignups.cancel()
      reParties.cancel()
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('online', resync)
      supabase.removeChannel(ch)
    }
  }, [id, loadSignups, loadParties])

  useEffect(() => {
    if (!myChar && myMembers.length) setMyChar(myMembers[0].id)
  }, [myMembers, myChar])

  if (ev === null) return <div className="muted pad">Memuat…</div>
  if (ev === false)
    return (
      <div className="empty">
        Event tidak ditemukan. <a href="#/events">Kembali</a>
      </div>
    )

  const mode = modeOf(ev)
  const isCustom = ev.mode === 'custom'
  // pembuat party custom mengatur event-nya sendiri seperti moderator
  const isOwner = isCustom && ev.created_by === user.id
  const isAdmin = isMod || isOwner
  const isBoard = ev.is_permanent
  // booking slot hanya untuk event biasa / party custom, tidak di papan GL & PZ
  const canReserve = isAdmin && !isBoard
  // isi dari screenshot: hanya papan Guild League & Polarity Zone, untuk moderator
  const canShot = isMod && isBoard && (ev.mode === 'guild_league' || ev.mode === 'polarity_zone')
  const isOpen = ev.status === 'open'
  const size = ev.party_size
  const secs = sectionsOf(ev)
  const myIds = new Set(myMembers.map((m) => m.id))

  const slotMap = new Map()
  const loose = [] // terdaftar tapi belum dapat party
  for (const s of signups) {
    if (s.party_no && s.party_no <= ev.party_count && s.slot_no <= size) slotMap.set(`${s.party_no}-${s.slot_no}`, s)
    else loose.push(s)
  }
  const countIn = (from, to) => {
    let n = 0
    for (const s of slotMap.values()) if (s.party_no >= from && s.party_no <= to) n++
    return n
  }
  for (const sec of secs) sec.count = countIn(sec.from, sec.to)
  const attendCount = secs.filter((x) => x.attend).reduce((a, x) => a + x.count, 0)
  const attendNames = secs.filter((x) => x.attend).map((x) => x.name).join(' + ')
  const signedIds = new Set(signups.map((s) => s.member_id))
  const mainIds = new Set([...slotMap.values()].map((s) => s.member_id))
  const notJoined = members.filter((m) => m.active && !signedIds.has(m.id))
  const myPartyNos = new Set([...slotMap.values()].filter((s) => myIds.has(s.member_id)).map((s) => s.party_no))
  // ---------- leader party ----------
  const MAX_LEAD = 8
  const leaderOf = (p) => {
    const lid = parties.find((x) => x.party_no === p)?.leader_member_id
    return lid ? memberById.get(lid) ?? null : null
  }
  const iLead = (p) => !!p && leaderOf(p)?.user_id === user.id
  const myLeadCount = parties.filter((x) => x.leader_member_id && memberById.get(x.leader_member_id)?.user_id === user.id).length
  // boleh mengatur isi party: moderator, leader-nya, atau anggota party tanpa leader
  const canManageParty = (p) => isAdmin || (isOpen && (iLead(p) || (!leaderOf(p) && myPartyNos.has(p))))
  const canEdit = (memberId, partyNo) => isAdmin || (isOpen && (myIds.has(memberId) || (partyNo && canManageParty(partyNo))))

  // slot yang ditutup/dibooking (mis. untuk pemain guild lain): { "<slot>": "<nama>" }
  const reservedOf = (p) => parties.find((x) => x.party_no === p)?.reserved || {}
  const partyName = (p) => parties.find((x) => x.party_no === p)?.name || defaultPartyName(secs, p)
  const mySignup = myChar ? signups.find((s) => s.member_id === myChar) : null
  const myGroup = myChar ? groupByMember.get(myChar) : null

  function firstEmpty(from, to) {
    for (let p = from; p <= to; p++) {
      const rs = reservedOf(p)
      for (let s = 1; s <= size; s++) if (!slotMap.has(`${p}-${s}`) && !rs[s]) return { p, s }
    }
    return null
  }

  /** karakter lain milik akun yang sama yang sudah ada di event ini (aturan 1 akun = 1 karakter) */
  function sameAccountIn(memberId) {
    const owner = memberById.get(memberId)?.user_id
    if (!ev.one_per_account || !owner) return null
    const other = signups.find((x) => x.member_id !== memberId && memberById.get(x.member_id)?.user_id === owner)
    return other ? memberById.get(other.member_id) : null
  }

  async function join(memberId, party_no, slot_no, okMsg) {
    const other = sameAccountIn(memberId)
    if (other) {
      toast(`Event ini 1 akun = 1 karakter: ${memberById.get(memberId)?.name} satu akun dengan ${other.name} yang sudah ikut`, 'err')
      return false
    }
    const ok = await run(async () => {
      await rpc('join_slot', { p_event_id: id, p_member_id: memberId, p_party_no: party_no, p_slot_no: slot_no })
      await loadSignups()
      return true
    }, okMsg)
    if (ok) setPicked(null)
    return ok
  }

  async function placeGroup(g, startParty) {
    const r = await run(async () => {
      const res = await rpc('place_group', { p_event_id: id, p_group_id: g.id, p_start_party: startParty ?? null })
      await loadSignups()
      return res
    })
    if (r) {
      setPicked(null)
      toast(`Party fix "${g.name}": ${r.placed} orang masuk party${r.sub ? `, ${r.sub} belum dapat slot` : ''}`)
      if (r.skipped) toast(`${r.skipped} karakter dilewati: event ini 1 akun = 1 karakter`, 'err')
    }
  }

  /** Masuk otomatis satu karakter saja (seluruh party fix lewat nama grup): Main dulu, lalu party Sub */
  function autoJoin(memberId) {
    const name = memberById.get(memberId)?.name
    const e = firstEmpty(1, ev.party_count)
    if (e) return join(memberId, e.p, e.s, `${name} masuk ${partyName(e.p)}`)
    return join(memberId, null, null, `Semua party penuh, ${name} masuk daftar tunggu`)
  }

  function pickInto(memberId, party_no, slot_no) {
    // pilih satu pemain = hanya pemain itu; seluruh party fix dipilih lewat nama grupnya
    return join(memberId, party_no, slot_no)
  }

  async function leave(memberId) {
    await run(async () => {
      await rpc('leave_event', { p_event_id: id, p_member_id: memberId })
      await loadSignups()
    }, 'Dikeluarkan dari party')
    if (picked === memberId) setPicked(null)
  }

  // ---------- drag & drop ----------
  // payload: member_id (angka) atau 'g:<id>' untuk seluruh party fix
  const dragProps = (payload) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation()
      e.dataTransfer.setData('text/plain', String(payload))
      e.dataTransfer.effectAllowed = 'move'
      setDragId(payload)
    },
    onDragEnd: () => {
      setDragId(null)
      setOver(null)
    },
  })

  const dropProps = (key, onDropId) => ({
    onDragOver: (e) => {
      if (!dragId) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (over !== key) setOver(key)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget) && over === key) setOver(null)
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      const raw = e.dataTransfer.getData('text/plain') || String(dragId ?? '')
      setDragId(null)
      setOver(null)
      if (!raw) return
      if (raw.startsWith('g:')) {
        const g = groups.find((x) => String(x.id) === raw.slice(2))
        if (g) onDropId(null, g)
      } else if (Number(raw)) onDropId(Number(raw), null)
    },
  })

  /** Karakter (atau seluruh party fix) dijatuhkan ke party p (slot s, atau slot kosong pertama) */
  function dropInto(memberId, p, s, group) {
    if (group) return placeGroup(group, p)
    const cur = signups.find((x) => x.member_id === memberId)
    if (cur && cur.party_no === p && (!s || cur.slot_no === s)) return
    if (!s) {
      const e = firstEmpty(p, p)
      if (!e) return toast(`${partyName(p)} sudah penuh`, 'err')
      s = e.s
    }
    return join(memberId, p, s)
  }

  async function dropOut(memberId, group) {
    if (group) {
      const ids = (group.group_members || []).map((gm) => gm.member_id).filter((x) => signedIds.has(x))
      for (const x of ids) await leave(x)
      return
    }
    if (signedIds.has(memberId)) leave(memberId)
  }

  // anggota/admin yang boleh memindah seluruh party fix
  const canMoveGroup = (g) => isAdmin || (isOpen && (g.group_members || []).some((gm) => myIds.has(gm.member_id)))

  function onEmptySlot(party_no, slot_no) {
    if (pickedGroup) {
      const g = pickedGroup
      setPickedGroup(null)
      return placeGroup(g, party_no)
    }
    if (picked) return join(picked, party_no, slot_no)
    if (canManageParty(party_no)) return setPickerSlot({ party_no, slot_no })
    if (!isOpen) return toast('Party sudah dikunci oleh admin', 'err')
    if (leaderOf(party_no)) return toast(`${partyName(party_no)} dipimpin ${leaderOf(party_no).name}. Minta leader memasukkan Anda.`, 'err')
    if (!myChar) return toast('Klaim karakter Anda dulu di halaman Roster', 'err')
    if (myGroup) return placeGroup(myGroup, party_no)
    return join(myChar, party_no, slot_no)
  }

  async function claimLeader(p, memberId) {
    const ok = await run(async () => {
      await rpc('claim_party_leader', { p_event_id: id, p_party_no: p, p_member_id: memberId })
      await loadParties()
      return true
    }, `${memberById.get(memberId)?.name} sekarang leader ${partyName(p)}`)
    if (ok) setFillParty(p)
  }

  async function releaseLeader(p) {
    if (!confirm(`Lepas leader ${partyName(p)}? Anggota party tetap di tempatnya.`)) return
    await run(async () => {
      await rpc('release_party_leader', { p_event_id: id, p_party_no: p })
      await loadParties()
    }, 'Leader dilepas')
  }

  async function reserve(p, s) {
    const label = prompt(`Tutup slot ${s} di ${partyName(p)} untuk siapa?\n(mis. nama pemain dari guild lain)`, '')
    if (!label?.trim()) return
    await run(async () => {
      await rpc('reserve_slot', { p_event_id: id, p_party_no: p, p_slot_no: s, p_label: label.trim() })
      await loadParties()
    }, 'Slot ditutup')
  }

  async function unreserve(p, s) {
    await run(async () => {
      await rpc('reserve_slot', { p_event_id: id, p_party_no: p, p_slot_no: s, p_label: null })
      await loadParties()
    }, 'Slot dibuka lagi')
  }

  async function setStatus(status) {
    await run(async () => {
      await q(supabase.from('events').update({ status }).eq('id', id))
      setEv((o) => ({ ...o, status }))
    }, `Status: ${STATUS_LABEL[status]}`)
  }

  async function renameParty(party_no, name) {
    await run(async () => {
      await rpc('rename_party', { p_event_id: id, p_party_no: party_no, p_name: name })
      await loadParties()
    })
  }

  async function addParty() {
    await run(async () => {
      const n = await rpc('add_party', { p_event_id: id })
      setEv((o) => ({ ...o, party_count: n }))
    }, 'Party baru ditambahkan')
  }

  async function confirmWar() {
    if (!confirm(`Konfirmasi war sekarang?\n\n${attendCount} orang di ${attendNames} akan tercatat HADIR untuk war ${fmtDate(new Date().toISOString())}.\nSusunan party saat ini disimpan ke riwayat.`))
      return
    const sid = await run(() => rpc('confirm_war', { p_board_id: id, p_played_at: new Date().toISOString() }), `War dikonfirmasi: ${attendCount} orang hadir`)
    if (sid) setTab('history')
  }

  async function del() {
    if (
      !confirm(
        isBoard
          ? 'Hapus papan tetap ini beserta susunan party-nya?\n\nRiwayat war yang sudah dikonfirmasi tetap tersimpan di daftar event.'
          : 'Hapus event ini beserta semua data party dan kehadirannya?',
      )
    )
      return
    const ok = await run(async () => {
      await q(supabase.from('events').delete().eq('id', id))
      return true
    }, 'Event dihapus')
    if (ok) navigate('#/events')
  }

  function copyText() {
    const line = (p) => {
      const names = []
      for (let s = 1; s <= size; s++) {
        const su = slotMap.get(`${p}-${s}`)
        const m = su && memberById.get(su.member_id)
        if (m) names.push(m.name)
        else if (reservedOf(p)[s]) names.push(`🔒 ${reservedOf(p)[s]}`)
      }
      const ld = leaderOf(p)
      return names.length || ld ? `**${partyName(p)}**${ld ? ` (👑 ${ld.name})` : ''}: ${names.join(', ') || '—'}` : null
    }
    const lines = [`**${ev.title}**${isBoard ? '' : ` — ${fmtDate(ev.starts_at)}`}`]
    for (const sec of secs) {
      lines.push('', `__${sec.name.toUpperCase()}__ (${sec.count}/${sec.parties * size})`)
      for (let p = sec.from; p <= sec.to; p++) lines.push(line(p))
    }
    if (loose.length) lines.push('', `**Belum dapat party**: ${loose.map((s) => memberById.get(s.member_id)?.name ?? '?').join(', ')}`)
    navigator.clipboard.writeText(lines.filter((l) => l !== null).join('\n')).then(
      () => toast('Susunan party disalin — tinggal paste di Discord'),
      () => toast('Gagal menyalin', 'err'),
    )
  }

  /** jumlah party berisi orang tapi tanpa Healer dalam satu bagian */
  const noHealerIn = (sec) => {
    let n = 0
    for (let p = sec.from; p <= sec.to; p++) {
      const ms = []
      for (let k = 1; k <= size; k++) {
        const su = slotMap.get(`${p}-${k}`)
        const m = su && memberById.get(su.member_id)
        if (m) ms.push(m)
      }
      if (ms.length && !ms.some((m) => m.role === 'Healer')) n++
    }
    return n
  }

  /** party fix yang anggotanya ada di slot-slot ini: [[group, jumlah], ...] */
  const groupsIn = (slots) => {
    const cnt = new Map()
    for (const s of slots) {
      const g = s && groupByMember.get(s.member_id)
      if (g) cnt.set(g.id, [g, (cnt.get(g.id)?.[1] ?? 0) + 1])
    }
    return [...cnt.values()]
  }

  const partyCard = (p) => {
    const slots = Array.from({ length: size }, (_, j) => slotMap.get(`${p}-${j + 1}`))
    const ms = slots.filter(Boolean).map((s) => memberById.get(s.member_id)).filter(Boolean)
    const roleCount = ROLES.map((r) => [r[0], ms.filter((m) => m.role === r).length]).filter(([, n]) => n)
    const mine = myPartyNos.has(p)
    const rsv = reservedOf(p)
    const nRsv = Object.keys(rsv).filter((k) => Number(k) <= size && !slots[Number(k) - 1]).length
    const noHealer = ms.length > 0 && !ms.some((m) => m.role === 'Healer')
    return (
      <div
        className={`party-card ${mine || iLead(p) ? 'party-mine' : ''} ${leaderOf(p) ? 'party-led' : ''} ${noHealer ? 'party-warn' : ''} ${over === `${p}` ? 'drop-over' : ''}`}
        key={p}
        {...dropProps(`${p}`, (mid, g) => dropInto(mid, p, null, g))}
        onClick={pickedGroup ? (e) => {
          if (e.target.closest('.group-handle')) return
          const g = pickedGroup
          setPickedGroup(null)
          placeGroup(g, p)
        } : undefined}
      >
        <div className="party-head">
          {canManageParty(p) ? (
            <input
              key={partyName(p)}
              className="party-name-input"
              defaultValue={partyName(p)}
              title="Klik untuk ganti nama party"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== partyName(p)) renameParty(p, v)
              }}
            />
          ) : (
            <span className="party-name">{partyName(p)}</span>
          )}
          <span className="small muted">
            {ms.length + nRsv}/{size}
          </span>
        </div>
        <LeaderLine
          leader={leaderOf(p)}
          mine={iLead(p)}
          canClaim={isOpen && myChar && myLeadCount < MAX_LEAD && !leaderOf(p)}
          isAdmin={isAdmin}
          busy={busy}
          onClaim={() => claimLeader(p, myChar)}
          onAssign={() => setLeaderPick(p)}
          onFill={() => setFillParty(p)}
          onRelease={() => releaseLeader(p)}
        />
        <div className="party-meta">{roleCount.length ? roleCount.map(([r, n]) => `${n}${r}`).join(' ') : ' '}</div>
        {noHealer && (
          <div className="party-alert" title="Party ini belum punya Healer (mis. High Priest)">
            ⚠ Tidak ada healer
          </div>
        )}
        {groupsIn(slots).map(([g, n]) => {
          const movable = canMoveGroup(g)
          const active = pickedGroup?.id === g.id
          return (
            <button
              key={g.id}
              type="button"
              className={`group-handle ${movable ? 'draggable' : ''} ${active ? 'is-picked' : ''} ${dragId === `g:${g.id}` ? 'is-dragging' : ''}`}
              style={{ '--g': groupColor(g.id) }}
              disabled={!movable}
              title={movable ? 'Seret, atau klik lalu klik party tujuan, untuk memindah seluruh party fix' : `Party fix: ${g.name}`}
              onClick={() => {
                setPicked(null)
                setPickedGroup(active ? null : g)
              }}
              {...(movable ? dragProps(`g:${g.id}`) : {})}
            >
              <span className="grip">⠿</span>
              {g.name}
              <span className="group-chip-n">
                {n}
                {(g.group_members?.length ?? n) > n ? `/${g.group_members.length}` : ''}
              </span>
            </button>
          )
        })}
        <ul className="slots">
          {slots.map((s, j) => {
            const slotNo = j + 1
            if (!s && rsv[slotNo])
              return (
                <li key={slotNo}>
                  <div className="slot slot-reserved" title={`🔒 ${rsv[slotNo]}`}>
                    <span className="lock">🔒</span>
                    <span className="slot-info">
                      <span className="slot-name notranslate">{rsv[slotNo]}</span>
                      <span className="small muted reserved-tag">booking</span>
                    </span>
                    {canReserve && (
                      <button className="icon-btn" title="Buka slot" disabled={busy} onClick={() => unreserve(p, slotNo)}>
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              )
            if (!s)
              return (
                <li key={slotNo} className={canReserve ? 'slot-row' : undefined}>
                  <button
                    className={`slot slot-empty ${picked || pickedGroup || dragId ? 'slot-target' : ''} ${over === `${p}-${slotNo}` ? 'drop-over' : ''}`}
                    disabled={busy || (!isAdmin && !isOpen)}
                    onClick={() => onEmptySlot(p, slotNo)}
                    {...dropProps(`${p}-${slotNo}`, (mid, g) => dropInto(mid, p, slotNo, g))}
                  >
                    {dragId ? 'Lepas di sini' : picked || pickedGroup ? 'Pindah ke sini' : canManageParty(p) ? '+ Isi' : isOpen ? '+ Gabung' : '—'}
                  </button>
                  {canReserve && !dragId && !picked && !pickedGroup && (
                    <button className="slot-lock" title="Tutup slot (booking untuk pemain lain)" disabled={busy} onClick={() => reserve(p, slotNo)}>
                      🔒
                    </button>
                  )}
                </li>
              )
            return (
              <li key={slotNo}>
                <SlotFilled
                  m={memberById.get(s.member_id)}
                  group={groupByMember.get(s.member_id)}
                  mine={myIds.has(s.member_id)}
                  picked={picked === s.member_id}
                  dragging={dragId === s.member_id}
                  drag={canEdit(s.member_id, p) ? dragProps(s.member_id) : null}
                  editable={canEdit(s.member_id, p)}
                  onPick={() => setPicked(picked === s.member_id ? null : s.member_id)}
                  onRemove={() => leave(s.member_id)}
                />
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div style={{ '--mode': mode.color }}>
      {ev.parent_id ? (
        <a href={`#/event/${ev.parent_id}`} className="back">
          ← Papan {mode.label}
        </a>
      ) : (
        <a href="#/events" className="back">
          ← Semua event
        </a>
      )}
      <div className="page-head event-head">
        <div>
          <div className="row gap-sm">
            <span className={`mode-tag ${mode.custom ? 'notranslate' : ''}`}>{mode.label}</span>
            {isBoard ? (
              <span className="pill pill-gold">Papan tetap</span>
            ) : (
              <span className={`status status-${ev.status}`}>{ev.parent_id ? 'Riwayat war' : STATUS_LABEL[ev.status]}</span>
            )}
            {isBoard && !isOpen && <span className={`status status-${ev.status}`}>{STATUS_LABEL[ev.status]}</span>}
            {ev.one_per_account && <span className="pill">1 akun = 1 karakter</span>}
            {isOwner && <span className="pill pill-gold">Party buatan Anda</span>}
          </div>
          <h1>
            {ev.title}
            <span className={`live-dot ${live ? 'on' : ''}`} title={live ? 'Live: perubahan orang lain langsung muncul' : 'Menyambungkan…'}>
              {live ? 'LIVE' : '…'}
            </span>
          </h1>
          {!isBoard && <p className="muted">{fmtDate(ev.starts_at)}</p>}
          {isOwner && (
            <p className="muted small">
              Anda pembuat party ini: Anda bisa mengatur semua slot, menutup slot (🔒) untuk pemain dari guild lain, mengunci,
              mengubah, atau menghapusnya.
            </p>
          )}
          {isBoard && (
            <p className="muted">Susunan tetap yang dipakai setiap war. Setelah war selesai, admin cukup klik Konfirmasi war.</p>
          )}
          {ev.notes && <p className="note">📌 {ev.notes}</p>}
        </div>
        <div className="row gap-sm wrap">
          {isBoard && isAdmin && (
            <button className="btn btn-gold" disabled={busy} onClick={confirmWar}>
              ✓ Konfirmasi war
            </button>
          )}
          {canShot && (
            <button className="btn btn-ghost" onClick={() => setShotOpen(true)} title="Baca nama dari screenshot layar party di game">
              📷 Isi dari screenshot
            </button>
          )}
          <button className="btn btn-ghost" onClick={copyText}>
            Salin untuk Discord
          </button>
          {isAdmin && (
            <>
              <select value={ev.status} onChange={(e) => setStatus(e.target.value)} className="select-sm" title="Status">
                {Object.entries(STATUS_LABEL)
                  .filter(([k]) => !isBoard || k !== 'done')
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
              <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)}>
                Ubah
              </button>
              {(!isBoard || isMod) && (
                <button className="btn btn-danger" onClick={del}>
                  Hapus
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <EventForm
          initial={ev}
          onDone={() => {
            setEditing(false)
            load()
          }}
        />
      )}

      <div className="stat-row">
        {secs.map((sec, i) => (
          <div key={sec.from} className={`stat ${i === 0 ? 'stat-green' : 'stat-gold'}`}>
            <div className="stat-value">
              {sec.count}
              <span className="stat-of">/{sec.parties * size}</span>
            </div>
            <div className="stat-label">
              {`${sec.name} (${sec.parties} party)`}
            </div>
            <div className="meter">
              <div className="meter-fill" style={{ width: `${Math.min(100, (sec.count / (sec.parties * size || 1)) * 100)}%` }} />
            </div>
          </div>
        ))}
        {loose.length > 0 && (
          <div className="stat">
            <div className="stat-value">{loose.length}</div>
            <div className="stat-label">Belum dapat party</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-value">{notJoined.length}</div>
          <div className="stat-label">Belum bergabung</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'party' ? 'active' : ''} onClick={() => setTab('party')}>
          Susunan party
        </button>
        {isBoard ? (
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            Riwayat war & kehadiran
          </button>
        ) : isCustom ? null : (
          <button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}>
            Kehadiran
          </button>
        )}
      </div>

      {tab === 'attendance' && <Attendance ev={ev} signups={signups} onChanged={load} />}
      {tab === 'history' && <WarHistory board={ev} />}

      {tab === 'party' && (
        <>
          <div className="toolbar card">
            {myMembers.length > 0 ? (
              <>
                <label className="row gap-sm">
                  <span className="muted small">Karakter saya</span>
                  <select value={myChar ?? ''} onChange={(e) => setMyChar(Number(e.target.value))}>
                    {myMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.class}
                      </option>
                    ))}
                  </select>
                </label>
                {myGroup && <GroupChip g={myGroup} count={myGroup.group_members?.length} />}
                {myLeadCount > 0 && (
                  <span className="pill pill-gold" title="Party yang Anda pimpin di papan ini">
                    👑 Memimpin {myLeadCount}/{MAX_LEAD}
                  </span>
                )}
                <span className="small muted">
                  {mySignup
                    ? mySignup.party_no && mySignup.party_no <= ev.party_count
                      ? `Anda di ${partyName(mySignup.party_no)}. Anda bisa mengatur party ini.`
                      : 'Anda belum dapat party. Klik slot kosong.'
                    : !isOpen
                      ? 'Party dikunci admin.'
                      : myGroup
                        ? 'Klik slot kosong: seluruh party fix akan masuk bersama.'
                        : 'Klik slot kosong, atau gabung otomatis.'}
                </span>
                <div className="grow" />
                {isOpen && (!mySignup || myGroup) && (
                  <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => autoJoin(myChar)}>
                    {myGroup ? (mySignup ? 'Rapikan party fix' : 'Gabung bersama party fix') : 'Gabung otomatis'}
                  </button>
                )}
                {mySignup && canEdit(myChar) && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => leave(myChar)}>
                    Batal ikut
                  </button>
                )}
              </>
            ) : (
              <span className="small">
                Anda belum punya karakter. <a href="#/roster">Klaim karakter di Roster</a>.
              </span>
            )}
          </div>

          {pickedGroup && (
            <div className="banner banner-gold">
              Memindahkan seluruh party fix <b>{pickedGroup.name}</b> ({pickedGroup.group_members?.length} orang): klik party tujuan.
              Lebih dari 5 orang akan dipecah ke party berikutnya.
              <button className="btn btn-ghost btn-sm" onClick={() => setPickedGroup(null)}>
                Batal
              </button>
            </div>
          )}

          {picked && (
            <div className="banner banner-gold">
              Memindahkan <b>{memberById.get(picked)?.name}</b>: klik slot kosong tujuan.
              <button className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
                Batal
              </button>
            </div>
          )}

          <div className="event-layout">
            <div className="event-main">
              {secs.map((sec, i) => (
                <section key={sec.from}>
                  <h2 className="section-title">
                    {`${sec.name} · ${sec.count}/${sec.parties * size}`}
                    {isBoard && sec.attend && <span className="section-tag">dihitung hadir</span>}
                    {noHealerIn(sec) > 0 && <span className="section-tag warn">⚠ {noHealerIn(sec)} party tanpa healer</span>}
                  </h2>
                  <div className={`party-grid compact ${i > 0 ? 'sub-grid' : ''}`}>
                    {Array.from({ length: sec.parties }, (_, j) => partyCard(sec.from + j))}
                  </div>
                </section>
              ))}

              {(isAdmin || (isOpen && myMembers.length > 0)) && ev.party_count < 60 && (
                <button className="btn btn-ghost add-party" disabled={busy} onClick={addParty}>
                  {isCustom ? '+ Tambah party' : `+ Tambah party di ${secs[secs.length - 1]?.name} (mau memimpin party sendiri?)`}
                </button>
              )}

              {loose.length > 0 && (
                <div className="card">
                  <h3>Belum dapat party · {loose.length}</h3>
                  <p className="muted small">Sudah mendaftar tapi semua party penuh. Tambah party atau pindahkan ke slot kosong.</p>
                  <ul className="bench">
                    {loose.map((s) => (
                      <li key={s.id}>
                        <SlotFilled
                          m={memberById.get(s.member_id)}
                          group={groupByMember.get(s.member_id)}
                          mine={myIds.has(s.member_id)}
                          picked={picked === s.member_id}
                          drag={canEdit(s.member_id) ? dragProps(s.member_id) : null}
                          editable={canEdit(s.member_id)}
                          onPick={() => setPicked(picked === s.member_id ? null : s.member_id)}
                          onRemove={() => leave(s.member_id)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <NotJoined
              list={notJoined}
              isAdmin={isAdmin}
              busy={busy}
              full={!firstEmpty(1, ev.party_count)}
              onAdd={(mid) => autoJoin(mid)}
              onAddGroup={(g) => placeGroup(g, null)}
              canDrag={(m) => isAdmin || (isOpen && (myIds.has(m.id) || myPartyNos.size > 0))}
              dragProps={dragProps}
              dropProps={dropProps('side', dropOut)}
              dropActive={over === 'side'}
              dragging={dragId}
            />
          </div>
        </>
      )}

      {fillParty && (
        <FillPartyModal
          title={partyName(fillParty)}
          free={size - [...slotMap.values()].filter((x) => x.party_no === fillParty).length}
          groups={groups}
          myIds={myIds}
          isAdmin={isAdmin}
          memberById={memberById}
          onGroup={(g) => {
            const p = fillParty
            setFillParty(null)
            placeGroup(g, p)
          }}
          onManual={() => {
            const p = fillParty
            setFillParty(null)
            const e = firstEmpty(p, p)
            if (e) setPickerSlot({ party_no: p, slot_no: e.s })
            else toast(`${partyName(p)} sudah penuh`, 'err')
          }}
          onClose={() => setFillParty(null)}
        />
      )}

      {leaderPick && (
        <MemberPicker
          title={`Tunjuk leader ${partyName(leaderPick)}`}
          excludeIds={new Set()}
          onClose={() => setLeaderPick(null)}
          onPick={(memberId) => {
            const p = leaderPick
            setLeaderPick(null)
            claimLeader(p, memberId)
          }}
        />
      )}

      {shotOpen && (
        <ScreenshotFill
          ev={ev}
          secs={secs}
          size={size}
          partyName={partyName}
          members={members}
          memberById={memberById}
          signups={signups}
          leaderOf={(p) => parties.find((x) => x.party_no === p)?.leader_member_id ?? null}
          toast={toast}
          onDone={() => Promise.all([loadSignups(), loadParties()]).catch(() => {})}
          onClose={() => setShotOpen(false)}
        />
      )}

      {groupAsk && (
        <GroupChoiceModal
          ask={groupAsk}
          partyName={partyName(groupAsk.party_no)}
          memberById={memberById}
          onePerAccount={ev.one_per_account}
          onWhole={() => {
            const a = groupAsk
            setGroupAsk(null)
            placeGroup(a.g, a.party_no)
          }}
          onOne={() => {
            const a = groupAsk
            setGroupAsk(null)
            join(a.memberId, a.party_no, a.slot_no)
          }}
          onClose={() => setGroupAsk(null)}
        />
      )}

      {pickerSlot && (
        <MemberPicker
          title={`Isi ${partyName(pickerSlot.party_no)} – slot ${pickerSlot.slot_no}`}
          excludeIds={mainIds}
          onClose={() => setPickerSlot(null)}
          onPick={(memberId) => {
            const sl = pickerSlot
            setPickerSlot(null)
            pickInto(memberId, sl.party_no, sl.slot_no)
          }}
        />
      )}
    </div>
  )
}

/** Riwayat war (sesi yang sudah dikonfirmasi) dari sebuah papan tetap */
function WarHistory({ board }) {
  const { isAdmin, toast } = useApp()
  const [run, busy] = useAction()
  const [rows, setRows] = useState(null)
  const [at, setAt] = useState(toLocalInput(new Date()))

  const load = useCallback(async () => {
    try {
      const sessions = await q(
        supabase.from('events').select('id, title, starts_at, status').eq('parent_id', board.id).order('starts_at', { ascending: false }).limit(100),
      )
      const ids = sessions.map((s) => s.id)
      const att = ids.length ? await q(supabase.from('attendance').select('event_id, status').in('event_id', ids)) : []
      const cnt = {}
      for (const a of att) {
        cnt[a.event_id] ??= { present: 0, absent: 0, excused: 0 }
        cnt[a.event_id][a.status]++
      }
      setRows(sessions.map((s) => ({ ...s, ...(cnt[s.id] || { present: 0, absent: 0, excused: 0 }) })))
    } catch (e) {
      toast(e.message, 'err')
      setRows([])
    }
  }, [board.id, toast])

  useEffect(() => {
    load()
  }, [load])

  async function confirmAt() {
    const sid = await run(() => rpc('confirm_war', { p_board_id: board.id, p_played_at: new Date(at).toISOString() }), 'War dikonfirmasi')
    if (sid) load()
  }

  return (
    <div className="stack">
      {isAdmin && (
        <div className="card">
          <h3>Konfirmasi war</h3>
          <p className="muted small">
            Semua orang di bagian yang ditandai <b>dihitung hadir</b> saat ini tercatat <b>hadir</b>, dan susunan party disimpan ke riwayat. Kalau ada
            yang ternyata tidak ikut, buka sesinya lalu ubah statusnya (Tidak hadir / Izin) di tab Kehadiran.
          </p>
          <div className="row gap-sm wrap">
            <label className="row gap-sm small">
              Waktu war
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
            <button className="btn btn-gold" disabled={busy} onClick={confirmAt}>
              ✓ Konfirmasi war
            </button>
          </div>
        </div>
      )}

      <div className="card flush">
        {rows === null ? (
          <p className="muted pad">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="muted pad">Belum ada war yang dikonfirmasi.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>War</th>
                  <th className="num">Hadir</th>
                  <th className="num">Tidak hadir</th>
                  <th className="num">Izin</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.starts_at)}</td>
                    <td className="num text-green">{r.present}</td>
                    <td className="num">{r.absent}</td>
                    <td className="num">{r.excused}</td>
                    <td className="actions">
                      <a className="btn btn-ghost btn-sm" href={`#/event/${r.id}`}>
                        Lihat / koreksi
                      </a>
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

/** Daftar member aktif yang belum masuk party mana pun */
function NotJoined({ list, isAdmin, busy, full, onAdd, onAddGroup, canDrag, dragProps, dropProps, dropActive, dragging }) {
  const { toast, groupByMember, myMembers } = useApp()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [sort, setSort] = useState('gs')

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase()
    return list
      .filter((m) => !role || m.role === role)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (m.class || '').toLowerCase().includes(s))
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : sort === 'online'
            ? Number(isOnline(b.online_status)) - Number(isOnline(a.online_status)) || (b.gear_score || 0) - (a.gear_score || 0)
            : (b.gear_score || 0) - (a.gear_score || 0),
      )
  }, [list, search, role, sort])

  const roleCount = ROLES.map((r) => [r, list.filter((m) => m.role === r).length])

  // kelompokkan per party fix, sisanya "tanpa party fix"
  const blocks = useMemo(() => {
    const byG = new Map()
    const solo = []
    for (const m of shown) {
      const g = groupByMember.get(m.id)
      if (!g) solo.push(m)
      else {
        if (!byG.has(g.id)) byG.set(g.id, { g, total: g.group_members?.length ?? 0, items: [] })
        byG.get(g.id).items.push(m)
      }
    }
    const gs = [...byG.values()].sort((a, b) => a.g.name.localeCompare(b.g.name))
    return solo.length ? [...gs, { g: null, items: solo }] : gs
  }, [shown, groupByMember])

  const myIdSet = new Set(myMembers.map((m) => m.id))
  // satu pemain bisa dimasukkan sendiri oleh admin, atau oleh pemiliknya
  const canAdd = (m) => isAdmin || myIdSet.has(m.id)
  const canDragGroup = (g) => isAdmin || (g.group_members || []).some((gm) => myIdSet.has(gm.member_id))

  const item = (m) => (
    <li
      key={m.id}
      className={`side-item ${canDrag(m) ? 'draggable' : ''} ${canAdd(m) ? 'clickable' : ''} ${dragging === m.id ? 'is-dragging' : ''}`}
      {...(canDrag(m) ? dragProps(m.id) : {})}
      onClick={canAdd(m) && !busy ? () => onAdd(m.id) : undefined}
      title={canAdd(m) ? 'Klik untuk memasukkan pemain ini saja' : undefined}
    >
      <JobIcon m={m} />
      <div className="slot-info">
        <div className="slot-name">
          <span className={isOnline(m.online_status) ? 'online-dot' : 'offline-dot'} title={m.online_status || ''} />
          {m.name}
        </div>
        <div className="small muted">
          {m.class ?? '–'} · GS {fmtNum(m.gear_score)}
          {!m.user_id && ' · belum klaim'}
        </div>
      </div>
      {canAdd(m) && (
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onAdd(m.id)
          }}
          title={full ? 'Semua party penuh: masuk daftar tunggu' : 'Masuk slot kosong pertama'}
        >
          + Party
        </button>
      )}
    </li>
  )

  function copyNames() {
    navigator.clipboard.writeText(shown.map((m) => m.name).join(', ')).then(
      () => toast(`${shown.length} nama disalin`),
      () => toast('Gagal menyalin', 'err'),
    )
  }

  return (
    <aside className={`card side-panel ${dropActive ? 'drop-over' : ''}`} {...dropProps}>
      <div className="row gap-sm">
        <h3 className="grow">Belum bergabung · {list.length}</h3>
        <button className="btn btn-ghost btn-sm" onClick={copyNames} disabled={!shown.length}>
          Salin nama
        </button>
      </div>
      <p className="muted small">
        {dragging ? 'Lepas di sini untuk mengeluarkan dari party' : `${roleCount.map(([r, n]) => `${n} ${r}`).join(' · ')} · seret ke party`}
      </p>
      <input placeholder="Cari nama / class…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="row gap-sm">
        <select className="grow select-sm" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Semua role</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select className="grow select-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="gs">Gear Score</option>
          <option value="online">Online dulu</option>
          <option value="name">Nama</option>
        </select>
      </div>
      {list.length === 0 ? (
        <p className="muted small">Semua member aktif sudah masuk party. 🎉</p>
      ) : (
        <ul className="side-list">
          {blocks.map((blk) =>
            blk.g ? (
              <li key={`g${blk.g.id}`} className="side-group" style={{ '--g': groupColor(blk.g.id) }}>
                <div
                  className={`side-group-head ${canDragGroup(blk.g) ? 'draggable' : ''} ${dragging === `g:${blk.g.id}` ? 'is-dragging' : ''}`}
                  {...(canDragGroup(blk.g) ? dragProps(`g:${blk.g.id}`) : {})}
                  title="Seret untuk memasukkan seluruh party fix"
                >
                  {isAdmin || canDragGroup(blk.g) ? (
                    <button
                      type="button"
                      className="side-group-name side-group-btn notranslate"
                      disabled={busy}
                      onClick={() => onAddGroup(blk.g)}
                      title="Klik untuk memasukkan seluruh party fix"
                    >
                      {blk.g.name}
                    </button>
                  ) : (
                    <span className="side-group-name notranslate">{blk.g.name}</span>
                  )}
                  <span className="small muted">
                    {blk.items.length}
                    {blk.total > blk.items.length ? `/${blk.total}` : ''} orang
                  </span>
                  <div className="grow" />
                  {(isAdmin || canDragGroup(blk.g)) && (
                    <button className="btn btn-sm" disabled={busy} onClick={() => onAddGroup(blk.g)}>
                      + Grup
                    </button>
                  )}
                </div>
                <ul className="side-group-list">{blk.items.map(item)}</ul>
              </li>
            ) : (
              <li key="solo" className="side-solo">
                {blocks.length > 1 && <div className="side-solo-head small muted">Tanpa party fix · {blk.items.length}</div>}
                <ul className="side-group-list">{blk.items.map(item)}</ul>
              </li>
            ),
          )}
          {shown.length === 0 && <li className="muted small pad">Tidak ada yang cocok.</li>}
        </ul>
      )}
    </aside>
  )
}

function SlotFilled({ m, group, mine, picked, dragging, drag, editable, onPick, onRemove }) {
  if (!m) return <div className="slot">?</div>
  return (
    <div
      className={`slot slot-filled ${mine ? 'slot-mine' : ''} ${picked ? 'slot-picked' : ''} ${group ? 'slot-group' : ''} ${drag ? 'draggable' : ''} ${dragging ? 'is-dragging' : ''}`}
      {...(drag || {})}
      style={group ? { '--g': groupColor(group.id) } : undefined}
      title={`${m.name} · ${m.class ?? '–'} · ${m.role ?? '–'} · GS ${fmtNum(m.gear_score)}${group ? ` · Party fix: ${group.name}` : ''}`}
    >
      <JobIcon m={m} />
      <div className="slot-info">
        <div className="slot-name notranslate">{m.name}</div>
        <div className="slot-sub">
          {m.class ?? '–'} · {fmtNum(m.gear_score)}
        </div>
      </div>
      {editable && (
        <div className="slot-actions">
          <button className="icon-btn" title="Pindahkan" onClick={onPick}>
            ⇄
          </button>
          <button className="icon-btn" title="Keluarkan" onClick={onRemove}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

/** Baris leader di kartu party: 👑 nama leader, atau tombol untuk menjadi leader */
function LeaderLine({ leader, mine, canClaim, isAdmin, busy, onClaim, onAssign, onFill, onRelease }) {
  if (leader)
    return (
      <div className={`leader-line ${mine ? 'leader-mine' : ''}`} onClick={(e) => e.stopPropagation()}>
        <span className="crown">👑</span>
        <span className="leader-name notranslate" title={`Leader: ${leader.name}`}>
          {leader.name}
        </span>
        {(mine || isAdmin) && (
          <>
            <button className="mini-btn" disabled={busy} title="Isi party (pilih party fix / anggota)" onClick={onFill}>
              + Isi
            </button>
            <button className="mini-btn" disabled={busy} title="Lepas leader" onClick={onRelease}>
              ✕
            </button>
          </>
        )}
      </div>
    )
  if (!canClaim && !isAdmin) return null
  return (
    <div className="leader-line leader-empty" onClick={(e) => e.stopPropagation()}>
      {canClaim && (
        <button className="mini-btn claim" disabled={busy} onClick={onClaim} title="Jadi leader party ini (maks 8 party)">
          👑 Jadi leader
        </button>
      )}
      {isAdmin && (
        <button className="mini-btn" disabled={busy} onClick={onAssign} title="Tunjuk leader untuk party ini">
          Tunjuk
        </button>
      )}
    </div>
  )
}

/** Jendela setelah klaim leader: isi party dengan party fix, atau pilih anggota satu per satu */
function FillPartyModal({ title, free, groups, myIds, isAdmin, memberById, onGroup, onManual, onClose }) {
  const [search, setSearch] = useState('')
  const mine = (g) => (g.group_members || []).some((gm) => myIds.has(gm.member_id))
  const list = groups
    .filter((g) => !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(mine(b)) - Number(mine(a)) || a.name.localeCompare(b.name))
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>👑 Isi {title}</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">
          Sisa {free} slot. Pilih party fix untuk dimasukkan sekaligus (lebih dari {free} orang akan lanjut ke party lain yang Anda
          pimpin), atau pilih anggota satu per satu.
        </p>
        <button className="btn btn-gold" onClick={onManual} disabled={free <= 0}>
          Pilih anggota satu per satu
        </button>
        <input placeholder="Cari party fix…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="picker-list">
          {list.length === 0 && <p className="muted small pad">Belum ada party fix.</p>}
          {list.map((g) => {
            const ms = (g.group_members || []).map((gm) => memberById.get(gm.member_id)).filter(Boolean)
            return (
              <button key={g.id} className="picker-item" onClick={() => onGroup(g)} style={{ '--g': groupColor(g.id) }}>
                <span className="grow">
                  <b style={{ color: 'var(--g)' }}>{g.name}</b>
                  {mine(g) && <span className="pill pill-green"> grup Anda</span>}
                  <div className="small muted">{ms.map((m) => m.name).join(', ')}</div>
                </span>
                <span className="small muted">{ms.length} orang</span>
              </button>
            )
          })}
        </div>
        {!isAdmin && <p className="small muted">Party fix dimasukkan ke party yang Anda pimpin.</p>}
      </div>
    </div>
  )
}

/** Jendela pilihan: masukkan seluruh party fix, atau hanya karakter yang dipilih */
function GroupChoiceModal({ ask, partyName, memberById, onePerAccount, onWhole, onOne, onClose }) {
  const { g, memberId } = ask
  const name = memberById.get(memberId)?.name
  const ms = (g.group_members || []).map((gm) => memberById.get(gm.member_id)).filter((m) => m && m.active)
  const accounts = new Set(ms.map((m) => m.user_id || `m${m.id}`)).size
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal choice-modal" onClick={(e) => e.stopPropagation()} style={{ '--g': groupColor(g.id) }}>
        <div className="modal-head">
          <h3>{`Masukkan ke ${partyName}`}</h3>
          <button className="icon-btn" onClick={onClose} title="Tutup">
            ✕
          </button>
        </div>
        <p className="small muted">
          <b className="notranslate">{name}</b> anggota party fix <b className="notranslate" style={{ color: 'var(--g)' }}>{g.name}</b>:
        </p>
        <div className="choice-members">
          {ms.map((m) => (
            <span key={m.id} className={`choice-member ${m.id === memberId ? 'is-me' : ''}`}>
              <JobIcon m={m} size={22} />
              <span className="notranslate">{m.name}</span>
            </span>
          ))}
        </div>
        <button className="choice-btn choice-primary" onClick={onWhole}>
          <span className="choice-icon">👥</span>
          <span className="grow">
            <b>{`Seluruh party fix (${ms.length} orang)`}</b>
            <span className="small muted">Tetap bersama; jika party penuh, sisanya lanjut ke party berikutnya.</span>
            {onePerAccount && accounts < ms.length && (
              <span className="small text-gold">{`Event 1 akun = 1 karakter: hanya ${accounts} karakter yang bisa ikut.`}</span>
            )}
          </span>
        </button>
        <button className="choice-btn" onClick={onOne}>
          <span className="choice-icon">👤</span>
          <span className="grow">
            <b>
              Hanya <span className="notranslate">{name}</span>
            </b>
            <span className="small muted">Anggota party fix lainnya tidak ikut dipindah.</span>
          </span>
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Batal
        </button>
      </div>
    </div>
  )
}
