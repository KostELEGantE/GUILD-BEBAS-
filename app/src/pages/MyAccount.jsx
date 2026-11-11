import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { rpc } from '../lib/supabase.js'
import { useApp, useAction } from '../context.jsx'
import { CLASSES, ROLES, defaultRole, fmtNum } from '../lib/util.js'
import JobIcon from '../components/JobIcon.jsx'

const MAX = 5
const empty = { name: '', class: '', level: '', gear_score: '', role: '' }
const num = (v) => (v === '' || v == null ? null : Number(v))

/** Form data karakter: dipakai untuk tambah baru & edit */
export function CharForm({ initial, submitLabel, onSubmit, onCancel, busy, cancelLabel = 'Batal' }) {
  const [f, setF] = useState(initial)
  const [roleTouched, setRoleTouched] = useState(!!initial.role && initial.role !== defaultRole(initial.class))
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const role = roleTouched ? f.role : f.class ? defaultRole(f.class) : ''
  const ok = !!f.name.trim()
  return (
    <form
      className="char-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onSubmit({ ...f, role: role || null })
      }}
    >
      <label className="field">
        <span>Nickname / IGN (wajib)</span>
        <input value={f.name} maxLength={32} required autoComplete="off" placeholder="Persis seperti di game" onChange={(e) => set('name', e.target.value)} />
      </label>
      <label className="field">
        <span>Class</span>
        <select value={f.class} onChange={(e) => set('class', e.target.value)}>
          <option value="">Belum diisi</option>
          {CLASSES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Role</span>
        <select
          value={role}
          disabled={!f.class}
          onChange={(e) => {
            setRoleTouched(true)
            set('role', e.target.value)
          }}
        >
          {!f.class && <option value="">—</option>}
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Level</span>
        <input type="number" min="1" max="200" inputMode="numeric" value={f.level} onChange={(e) => set('level', e.target.value)} />
      </label>
      <label className="field">
        <span>CP / Gear Score</span>
        <input type="number" min="0" max="999999" inputMode="numeric" value={f.gear_score} onChange={(e) => set('gear_score', e.target.value)} />
      </label>
      <div className="char-form-actions">
        <button className="btn btn-gold" disabled={busy || !ok}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  )
}

export default function MyAccount() {
  const { myMembers, profile, reloadMembers, activeMember, setActiveId } = useApp()
  const [run, busy] = useAction()
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const mine = [...myMembers].sort((a, b) => (b.gear_score || 0) - (a.gear_score || 0))
  const showAdd = adding || mine.length === 0

  const declare = (f) =>
    run(async () => {
      await rpc('declare_member', { p_name: f.name.trim(), p_class: f.class || null, p_level: num(f.level), p_gear_score: num(f.gear_score), p_role: f.class ? f.role : null })
      await reloadMembers()
      setAdding(false)
    }, `${f.name.trim()} terdaftar di akun Anda`)
  const save = (m, f) =>
    run(async () => {
      await rpc('update_my_member', {
        p_member_id: m.id,
        p_name: f.name.trim(),
        p_class: f.class || null,
        p_level: num(f.level),
        p_gear_score: num(f.gear_score),
        p_role: f.class ? f.role : null,
      })
      await reloadMembers()
      setEditing(null)
    }, 'Data karakter disimpan')
  const remove = (m) => {
    if (!confirm(`Hapus ${m.name} dari akun Anda?\n\nKarakter ini tidak bisa lagi Anda masukkan ke party sampai didaftarkan lagi.`)) return
    run(async () => {
      await rpc('unclaim_member', { p_member_id: m.id })
      await reloadMembers()
    }, `${m.name} dihapus dari akun Anda`)
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Akun saya</h1>
          <p className="muted">
            Daftarkan karakter Anda sendiri. Tulis IGN persis seperti di game. Kalau IGN Anda sudah ada di daftar guild, data
            guildnya (Gear Score, kontribusi) otomatis tersambung ke akun ini.
          </p>
        </div>
      </div>

      {mine.length === 0 && (
        <div className="banner">Akun ini belum punya karakter. Isi form di bawah supaya bisa masuk party.</div>
      )}

      {mine.map((m, i) => (
        <div key={m.id} className="card char-card">
          {editing === m.id ? (
            <>
              <h3>{`Ubah ${m.name}`}</h3>
              <CharForm
                busy={busy}
                initial={{ name: m.name, class: m.class || '', level: m.level ?? '', gear_score: m.gear_score ?? '', role: m.role || '' }}
                submitLabel="Simpan"
                onSubmit={(f) => save(m, f)}
                onCancel={() => setEditing(null)}
              />
              <p className="muted small">Ganti IGN di sini kalau Anda mengganti nama di game. Party, party fix, dan kehadiran tetap ikut.</p>
            </>
          ) : (
            <div className="char-row">
              <JobIcon m={m} size={44} />
              <div className="grow">
                <div className="char-name">
                  <b className="notranslate">{m.name}</b>
                  {mine.length > 1 && activeMember?.id === m.id && <span className="pill pill-gold">Sedang dipakai</span>}
                  {!m.last_import_at && <span className="pill">Belum ada di daftar guild</span>}
                </div>
                <div className="muted small">
                  {m.class || 'class belum diisi'} · {m.role || '–'} · Lv {m.level ?? '–'} · CP {fmtNum(m.gear_score)}
                  {m.weekly_contribution != null && ` · ${fmtNum(m.weekly_contribution)} kontribusi minggu ini`}
                </div>
                {m.prev_names?.length > 0 && (
                  <div className="muted small">
                    {`Nama sebelumnya: `}
                    <span className="notranslate">{m.prev_names.join(', ')}</span>
                  </div>
                )}
              </div>
              <div className="char-actions">
                {mine.length > 1 && activeMember?.id !== m.id && (
                  <button className="btn btn-sm" onClick={() => setActiveId(m.id)}>
                    Pakai akun ini
                  </button>
                )}
                <button className="btn btn-sm char-edit" disabled={busy} onClick={() => setEditing(m.id)}>
                  ✎ Ubah
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(m)}>
                  Hapus
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showAdd ? (
        <div className="card">
          <h3>{mine.length ? 'Tambah akun game lain' : 'Daftarkan akun game Anda'}</h3>
          <CharForm busy={busy} initial={empty} submitLabel="Daftarkan" onSubmit={declare} onCancel={mine.length ? () => setAdding(false) : null} />
        </div>
      ) : (
        mine.length < MAX && (
          <button className="btn add-char" onClick={() => setAdding(true)}>
            + Tambah akun game lain
          </button>
        )
      )}

      <p className="muted small">
        {`Akun login: `}
        <span className="notranslate">{profile?.display_name}</span>
        {` · maksimal ${MAX} akun game per login. Pilih akun yang dipakai di pojok kanan atas. Moderator bisa melihat data ini.`}
      </p>
    </div>
  )
}

/**
 * Muncul sekali setiap login: minta data akun game.
 * - Belum punya karakter: wajib isi minimal nickname (tidak bisa dilewati).
 * - Sudah punya: cek / perbarui nickname & CP akun yang dipakai, atau lewati.
 * Pemain dengan beberapa akun game bisa menambah akun lain dan memilih akun yang dipakai.
 */
export function LoginCheckIn() {
  const { myMembers, activeMember, setActiveId, reloadMembers, session } = useApp()
  const [run, busy] = useAction()
  const key = `checkin:${session.user.id}:${session.user.last_sign_in_at || ''}`
  const [done, setDone] = useState(() => {
    try {
      return !!localStorage.getItem(key)
    } catch {
      return false
    }
  })
  const [adding, setAdding] = useState(false)
  const finish = () => {
    try {
      localStorage.setItem(key, '1')
    } catch {}
    setDone(true)
  }
  const none = myMembers.length === 0
  if (done && !none) return null
  if (location.hash.startsWith('#/me') && !none) return null

  const declare = (f) =>
    run(async () => {
      const id = await rpc('declare_member', { p_name: f.name.trim(), p_class: f.class || null, p_level: num(f.level), p_gear_score: num(f.gear_score), p_role: f.class ? f.role : null })
      await reloadMembers()
      if (id) setActiveId(id)
      setAdding(false)
      finish()
    }, `${f.name.trim()} tersimpan`)
  const save = (m, f) =>
    run(async () => {
      await rpc('update_my_member', {
        p_member_id: m.id,
        p_name: f.name.trim(),
        p_class: f.class || null,
        p_level: num(f.level),
        p_gear_score: num(f.gear_score),
        p_role: f.class ? f.role : null,
      })
      await reloadMembers()
      finish()
    }, 'Data akun diperbarui')

  const m = activeMember
  return (
    <div className="modal-backdrop">
      <div className="modal checkin">
        <h3>{none ? 'Isi data akun game Anda' : 'Cek data akun game'}</h3>
        <p className="muted small">
          {none
            ? 'Minimal isi nickname (IGN) persis seperti di game. Class, level, dan CP boleh dikosongkan dulu.'
            : 'Perbarui CP / data akun yang Anda pakai hari ini, atau lewati kalau tidak ada yang berubah.'}
        </p>

        {!none && myMembers.length > 1 && !adding && (
          <label className="field checkin-switch">
            <span>Akun yang dipakai</span>
            <select value={m?.id ?? ''} onChange={(e) => setActiveId(Number(e.target.value))}>
              {myMembers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {none || adding ? (
          <CharForm
            key="new"
            busy={busy}
            initial={empty}
            submitLabel="Simpan"
            onSubmit={declare}
            onCancel={none ? null : () => setAdding(false)}
          />
        ) : (
          <CharForm
            key={m.id}
            busy={busy}
            initial={{ name: m.name, class: m.class || '', level: m.level ?? '', gear_score: m.gear_score ?? '', role: m.role || '' }}
            submitLabel="Simpan"
            onSubmit={(f) => save(m, f)}
            onCancel={finish}
            cancelLabel="Lewati"
          />
        )}

        <div className="checkin-foot">
          {!none && !adding && myMembers.length < MAX && (
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
              + Saya main akun game lain juga
            </button>
          )}
          {none && (
            <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>
              Keluar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
