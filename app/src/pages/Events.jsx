import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, q } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { MODES, STATUS_LABEL, CUSTOM_COLOR, modeOf, fmtDate, toLocalInput, navigate, sectionsOf } from '../lib/util.js'

export default function Events() {
  const { isAdmin, myMembers, toast } = useApp()
  const [events, setEvents] = useState(null)
  const [signups, setSignups] = useState([])
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const [ev, su] = await Promise.all([
        q(supabase.from('events').select('*').order('starts_at', { ascending: false }).limit(200)),
        q(supabase.from('event_signups').select('event_id, member_id, party_no')),
      ])
      setEvents(ev)
      setSignups(su)
    } catch (e) {
      toast(e.message, 'err')
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const myIds = useMemo(() => new Set(myMembers.map((m) => m.id)), [myMembers])
  const customModes = useMemo(
    () => [...new Set((events || []).filter((e) => e.mode === 'custom' && e.custom_mode).map((e) => e.custom_mode.trim()))].sort(),
    [events],
  )
  const canCreate = isAdmin || myMembers.length > 0

  const stats = useMemo(() => {
    const s = {}
    for (const x of signups) {
      s[x.event_id] ??= { parties: [], mine: false }
      s[x.event_id].parties.push(x.party_no)
      if (myIds.has(x.member_id)) s[x.event_id].mine = true
    }
    return s
  }, [signups, myIds])

  if (!events) return <div className="muted pad">Memuat event…</div>

  const boards = events.filter((e) => e.is_permanent)
  // riwayat war (sesi papan tetap) tampil di halaman papannya, bukan di sini
  const list = events.filter((e) => !e.is_permanent && !e.parent_id && (filter === 'all' || e.mode === filter))
  const now = Date.now() - 3 * 3600 * 1000 // event yang baru mulai <3 jam lalu masih dianggap "mendatang"
  const upcoming = list.filter((e) => new Date(e.starts_at).getTime() >= now && e.status !== 'done').reverse()
  const past = list.filter((e) => !upcoming.includes(e))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Event &amp; Party</h1>
          <p className="muted">
            Guild League dan Polarity Zone memakai papan tetap. Siege dan event lain dibuat per tanggal. Semua member bisa membuat
            party sendiri untuk mode apa pun (mis. Valkyrie).
          </p>
        </div>
        {canCreate && (
          <button className="btn btn-gold" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Tutup' : isAdmin ? '+ Buat event' : '+ Buat party'}
          </button>
        )}
      </div>

      {showForm && (
        <EventForm
          customModes={customModes}
          onDone={() => {
            setShowForm(false)
            load()
          }}
        />
      )}

      {boards.length > 0 && (
        <>
          <h2 className="section-title">Papan tetap</h2>
          <div className="event-grid">
            {boards.map((e) => (
              <EventCard key={e.id} e={e} s={stats[e.id]} />
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">Event lain</h2>
      <div className="tabs">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          Semua
        </button>
        {Object.entries(MODES).map(([k, m]) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
            <span className="dot" style={{ background: m.color }} />
            {m.label}
          </button>
        ))}
        <button className={filter === 'custom' ? 'active' : ''} onClick={() => setFilter('custom')}>
          <span className="dot" style={{ background: CUSTOM_COLOR }} />
          Lainnya
        </button>
      </div>

      {upcoming.length === 0 && !canCreate ? (
        <div className="empty">Belum ada event mendatang.</div>
      ) : (
        <div className="event-grid">
          {upcoming.map((e) => (
            <EventCard key={e.id} e={e} s={stats[e.id]} />
          ))}
          {canCreate && (
            <button
              type="button"
              className="event-card event-card-add"
              title={isAdmin ? 'Buat event' : 'Buat party'}
              aria-label={isAdmin ? 'Buat event' : 'Buat party'}
              onClick={() => {
                setShowForm(true)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              <span className="add-plus">+</span>
            </button>
          )}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h2 className="section-title">Sebelumnya</h2>
          <div className="event-grid">
            {past.map((e) => (
              <EventCard key={e.id} e={e} s={stats[e.id]} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EventCard({ e, s }) {
  const { user } = useApp()
  const m = modeOf(e)
  const secs = sectionsOf(e)
  const ps = s?.parties ?? []
  const first = secs[0]
  const cap = first.parties * e.party_size
  const filled = ps.filter((p) => p >= first.from && p <= first.to).length
  const rest = secs.slice(1).map((x) => `${x.name} ${ps.filter((p) => p >= x.from && p <= x.to).length}`)
  const pct = Math.min(100, Math.round((filled / cap) * 100))
  return (
    <a className="event-card" href={`#/event/${e.id}`} style={{ '--mode': m.color }}>
      <div className="event-card-top">
        <span className={`mode-tag ${m.custom ? 'notranslate' : ''}`}>{m.label}</span>
        {e.is_permanent ? (
          <span className="pill pill-gold">Papan tetap</span>
        ) : (
          <span className={`status status-${e.status}`}>{STATUS_LABEL[e.status]}</span>
        )}
      </div>
      <div className="event-title">{e.title}</div>
      <div className="muted small">{e.is_permanent ? 'Dipakai setiap war' : fmtDate(e.starts_at)}</div>
      <div className="meter">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="event-card-foot small">
        <span>
          {m.custom ? `${filled}/${cap}` : `${first.name} ${filled}/${cap}`}
          {rest.length ? ` · ${rest.length > 2 ? `+${rest.length} bagian` : rest.join(' · ')}` : ''}
        </span>
        {e.mode === 'custom' && e.created_by === user?.id && <span className="pill pill-gold">Buatan Anda</span>}
        {s?.mine && <span className="pill pill-green">Anda ikut</span>}
      </div>
    </a>
  )
}

// Susunan bawaan per mode (bisa diubah per event lewat form)
const sec = (name, prefix, parties, attend = true) => ({ name, prefix, parties, attend })
const DEFAULT_SECTIONS = {
  guild_league: [sec('Main', 'Party', 12), sec('Sub', 'Sub', 18, false)],
  polarity_zone: [
    sec('STAR', 'STAR', 10),
    sec('Normal Dungeon 1', 'ND1-', 10),
    sec('Normal Dungeon 2', 'ND2-', 10),
    sec('Normal Dungeon 3', 'ND3-', 10),
    sec('Normal Dungeon 4', 'ND4-', 10),
  ],
  siege: [sec('Main', 'Party', 12)],
}

// event custom: satu bagian "Party" yang tidak dihitung hadir
const CUSTOM_SECTIONS = (n) => [sec('Party', 'Party', Math.max(1, Math.min(20, Number(n) || 1)), false)]

export function EventForm({ initial, onDone, customModes = [] }) {
  const { user, isAdmin } = useApp()
  const [run, busy] = useAction()
  const start = new Date()
  start.setHours(20, 0, 0, 0)
  if (start < new Date()) start.setDate(start.getDate() + 1)

  const [f, setF] = useState(
    initial
      ? {
          ...initial,
          starts_at: toLocalInput(new Date(initial.starts_at)),
          sections: sectionsOf(initial).map(({ name, prefix, parties, attend }) => ({ name, prefix, parties, attend })),
        }
      : {
          mode: isAdmin ? 'siege' : 'custom',
          custom_mode: '',
          one_per_account: false,
          title: '',
          starts_at: toLocalInput(start),
          party_size: 5,
          sections: isAdmin ? DEFAULT_SECTIONS.siege : CUSTOM_SECTIONS(1),
          notes: '',
        },
  )
  const isCustom = f.mode === 'custom'
  const customParties = isCustom ? Number(f.sections?.[0]?.parties) || 1 : 1
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }))

  function setMode(mode) {
    setF((o) => ({
      ...o,
      mode,
      ...(mode === 'custom' ? { sections: CUSTOM_SECTIONS(1) } : initial ? {} : { sections: DEFAULT_SECTIONS[mode] }),
    }))
  }

  async function submit(ev) {
    ev.preventDefault()
    const customMode = (f.custom_mode || '').trim()
    if (isCustom && !customMode) return alert('Isi nama mode, mis. Valkyrie')
    const title =
      f.title.trim() ||
      `${isCustom ? customMode : MODES[f.mode].label} – ${new Date(f.starts_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`
    const sections = f.sections
      .map((x) => ({ ...x, name: x.name.trim() || 'Bagian', prefix: (x.prefix ?? '').trim() || x.name.trim() || 'Party', parties: Number(x.parties) || 0 }))
      .filter((x) => x.parties > 0)
    const total = sections.reduce((a, x) => a + x.parties, 0)
    if (!sections.length) return alert('Minimal 1 bagian dengan 1 party')
    if (total > 60) return alert('Total party maksimal 60')
    const row = {
      mode: f.mode,
      title,
      starts_at: new Date(f.starts_at).toISOString(),
      party_count: total,
      main_count: sections[0].parties,
      sections,
      party_size: Number(f.party_size),
      notes: f.notes || null,
      custom_mode: isCustom ? customMode : null,
      one_per_account: isCustom ? !!f.one_per_account : false,
    }
    const r = await run(async () => {
      if (initial) {
        await q(supabase.from('events').update(row).eq('id', initial.id))
        return initial.id
      }
      const created = await q(
        supabase
          .from('events')
          .insert({ ...row, created_by: user.id })
          .select('id')
          .single(),
      )
      return created.id
    }, initial ? 'Event diperbarui' : 'Event dibuat')
    if (r) {
      onDone?.(r)
      if (!initial) navigate(`#/event/${r}`)
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      {isAdmin && (
        <label>
          Mode
          <select value={f.mode} disabled={!!initial?.is_permanent || initial?.mode === 'custom'} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODES).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
            <option value="custom">Lainnya (ketik sendiri)</option>
          </select>
        </label>
      )}
      {isCustom && (
        <label>
          Nama mode
          <input
            required
            maxLength={30}
            list="custom-modes"
            value={f.custom_mode ?? ''}
            onChange={(e) => set('custom_mode', e.target.value)}
            placeholder="mis. Valkyrie"
          />
          <datalist id="custom-modes">
            {customModes.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
      )}
      <label>
        Judul (opsional)
        <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="otomatis dari mode & tanggal" />
      </label>
      {!initial?.is_permanent && (
        <label>
          Waktu mulai
          <input type="datetime-local" required value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
        </label>
      )}
      {isCustom ? (
        <label>
          Jumlah party
          <input
            type="number"
            min="1"
            max="20"
            required
            value={customParties}
            onChange={(e) => set('sections', CUSTOM_SECTIONS(e.target.value))}
          />
        </label>
      ) : (
        <SectionsEditor sections={f.sections} size={Number(f.party_size) || 5} onChange={(v) => set('sections', v)} />
      )}
      <label>
        {isCustom ? 'Anggota per party' : 'Slot per party'}
        <input type="number" min="1" max="20" required value={f.party_size} onChange={(e) => set('party_size', e.target.value)} />
      </label>
      {isCustom && (
        <label className="check-label span-2">
          <input type="checkbox" checked={!!f.one_per_account} onChange={(e) => set('one_per_account', e.target.checked)} />
          <span>
            1 akun = 1 karakter{' '}
            <span className="muted small">
              (biarkan kosong jika ada yang mengklaim karakter temannya; satu karakter tetap hanya bisa masuk 1 slot)
            </span>
          </span>
        </label>
      )}
      <label className="span-2">
        Catatan
        <input value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="mis. kumpul 19:45 di markas guild" />
      </label>
      <div className="form-actions">
        <button className="btn btn-gold" disabled={busy}>
          {initial ? 'Simpan' : isCustom && !isAdmin ? 'Buat party' : 'Buat event'}
        </button>
      </div>
    </form>
  )
}

/** Atur bagian party: nama, awalan nama party, jumlah party, dihitung hadir atau tidak */
function SectionsEditor({ sections, size, onChange }) {
  const upd = (i, k, v) => onChange(sections.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const total = sections.reduce((a, x) => a + (Number(x.parties) || 0), 0)
  return (
    <div className="span-all sections-editor">
      <div className="row gap-sm">
        <span className="grow">Bagian party</span>
        <span className={`small ${total > 60 ? 'text-red' : 'muted'}`}>
          Total {total} party · {total * size} orang (maks 60 party)
        </span>
      </div>
      <table className="table compact">
        <thead>
          <tr>
            <th>Nama bagian</th>
            <th>Awalan nama party</th>
            <th className="num">Jumlah party</th>
            <th>Dihitung hadir</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sections.map((x, i) => (
            <tr key={i}>
              <td>
                <input value={x.name} onChange={(e) => upd(i, 'name', e.target.value)} placeholder="mis. STAR" />
              </td>
              <td>
                <input value={x.prefix ?? ''} onChange={(e) => upd(i, 'prefix', e.target.value)} placeholder="mis. ND1-" />
              </td>
              <td className="num">
                <input type="number" min="1" max="60" value={x.parties} onChange={(e) => upd(i, 'parties', e.target.value)} style={{ width: 80 }} />
              </td>
              <td>
                <input type="checkbox" checked={x.attend !== false} onChange={(e) => upd(i, 'attend', e.target.checked)} />
              </td>
              <td className="actions">
                {sections.length > 1 && (
                  <button type="button" className="icon-btn" title="Hapus bagian" onClick={() => onChange(sections.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange([...sections, { name: `Bagian ${sections.length + 1}`, prefix: `B${sections.length + 1}-`, parties: 10, attend: true }])}
      >
        + Tambah bagian
      </button>
      <p className="small muted">
        Party diberi nomor berurutan dari bagian pertama. Mengubah jumlah party di bagian atas bisa menggeser anggota ke bagian
        berikutnya.
      </p>
    </div>
  )
}
