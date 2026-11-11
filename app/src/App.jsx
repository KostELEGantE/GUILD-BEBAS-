import { APP_VERSION } from './lib/util.js'
import { useEffect, useState } from 'react'
import { supabase, rpc } from './lib/supabase.js'
import { AppProvider, useApp, useAction } from './context.jsx'
import Login from './pages/Login.jsx'
import Events from './pages/Events.jsx'
import EventDetail from './pages/EventDetail.jsx'
import MyAccount, { LoginCheckIn } from './pages/MyAccount.jsx'
import Stats from './pages/Stats.jsx'
import Admin from './pages/Admin.jsx'
import Groups from './pages/Groups.jsx'
import Schedule from './pages/Schedule.jsx'
import logo from './assets/logo.webp'
import LangSwitch from './components/LangSwitch.jsx'
import ServerClock from './components/ServerClock.jsx'

// server Discord guild (link undangan)


function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/events')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/events')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center-screen muted">Memuat…</div>
  if (!session) return <Login />

  return (
    <AppProvider key={session.user.id} session={session}>
      <Shell />
    </AppProvider>
  )
}

function Shell() {
  const hash = useHash()
  const { profile, isAdmin, loading, myMembers, activeMember, setActiveId, session } = useApp()
  // tampil dengan IGN (karakter yang diklaim); nama akun hanya sebagai keterangan
  const ign = activeMember?.name
  const parts = hash.replace(/^#\/?/, '').split('/')
  const page = parts[0] || 'events'

  const nav = [
    // [kunci, label, ikon, label pendek untuk menu bawah di HP]
    ['events', 'Event & Party', '⚔', 'Event'],
    ['groups', 'Party Fix', '🤝', 'Party Fix'],
    ['me', 'Akun saya', '👤', 'Akun'],
    ['stats', 'Kehadiran', '📊', 'Absensi'],
    ...(isAdmin ? [['admin', 'Admin', '⚙', 'Admin']] : []),
  ]

  let content
  if (loading) content = <div className="muted pad">Memuat data guild…</div>
  else if (page === 'event' && parts[1]) content = <EventDetail id={Number(parts[1])} initialTab={parts[2]} />
  else if (page === 'me' || page === 'roster') content = <MyAccount />
  else if (page === 'groups') content = <Groups />
  else if (page === 'stats') content = <Stats />
  else if (page === 'schedule') content = <Schedule />
  else if (page === 'admin' && isAdmin) content = <Admin />
  else content = <Events />

  const activeNav = page === 'event' ? 'events' : page === 'roster' ? 'me' : page

  if (profile?.banned_at) return <Banned profile={profile} />

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand notranslate" href="#/events">
          <img src={logo} alt="" className="brand-logo" />
          <span>
            BEBAS <span className="brand-sub">Guild</span> <span className="brand-ver" title="Versi aplikasi">{`v${APP_VERSION}`}</span>
          </span>
        </a>
        <nav className="nav">
          {nav.map(([k, label, icon, short]) => (
            <a key={k} href={`#/${k}`} className={activeNav === k ? 'active' : ''}>
              <span className="nav-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="nav-label">{label}</span>
              <span className="nav-short">{short}</span>
            </a>
          ))}
        </nav>
        <div className="userbox">
          {profile?.avatar_url && <img src={profile.avatar_url} alt="" className="avatar" />}
          <LangSwitch />
          <span className="username notranslate-name" title={`Akun: ${profile?.display_name ?? ''}`}>
            {myMembers.length > 1 ? (
              <select
                className="char-switch notranslate"
                value={activeMember?.id ?? ''}
                title="Ganti akun game yang sedang dipakai"
                onChange={(e) => setActiveId(Number(e.target.value))}
              >
                {myMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <a href="#/me" className="notranslate">
                {ign ?? profile?.display_name ?? '…'}
              </a>
            )}
            {isAdmin && <span className="pill pill-gold">{profile?.is_super ? 'Super Mod' : 'Sub Mod'}</span>}
          </span>
          <button className="btn btn-ghost btn-sm logout" onClick={() => supabase.auth.signOut()} title="Keluar">
            <span className="logout-icon" aria-hidden="true">⎋</span>
            <span className="logout-label">Keluar</span>
          </button>
        </div>
      </header>
      <ServerClock />

      <FirstAdminBanner />
      {!loading && myMembers.length === 0 && page !== 'me' && page !== 'roster' && (
        <div className="banner">
          Anda belum mendaftarkan karakter. Buka <a href="#/me">Akun saya</a> lalu isi IGN, class, dan Gear Score Anda supaya
          bisa masuk party.
        </div>
      )}

      <main className="main">{content}</main>
      {!loading && <LoginCheckIn key={session.user.last_sign_in_at || 'x'} />}
    </div>
  )
}

function Banned({ profile }) {
  return (
    <div className="login">
      <div className="login-card banned-card">
        <LangSwitch className="login-lang" />
        <div className="ban-icon">⛔</div>
        <h1>Akun diblokir</h1>
        <p className="muted">Akun ini diblokir oleh moderator guild dan tidak bisa membuka website.</p>
        {profile.ban_reason && (
          <p>
            Alasan: <b className="notranslate">{profile.ban_reason}</b>
          </p>
        )}
        <p className="muted small">Jika menurut Anda ini keliru, hubungi moderator guild.</p>
        <button className="btn btn-ghost btn-lg" onClick={() => supabase.auth.signOut()}>
          Keluar
        </button>
      </div>
    </div>
  )
}

function FirstAdminBanner() {
  const { isAdmin, reloadProfile, toast } = useApp()
  const [noAdmin, setNoAdmin] = useState(false)
  const [run, busy] = useAction()

  useEffect(() => {
    if (isAdmin) return
    rpc('admin_exists').then((exists) => setNoAdmin(!exists)).catch(() => {})
  }, [isAdmin])

  if (isAdmin || !noAdmin) return null
  return (
    <div className="banner banner-gold">
      Belum ada admin di guild ini. Jika Anda pengurus guild, jadikan akun ini admin pertama.
      <button
        className="btn btn-gold btn-sm"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const ok = await rpc('claim_first_admin')
            if (!ok) throw new Error('Admin sudah ada')
            await reloadProfile()
            toast('Anda sekarang admin')
          })
        }
      >
        Jadikan saya admin
      </button>
    </div>
  )
}
