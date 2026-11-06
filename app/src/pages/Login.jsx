import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import logo from '../assets/logo.webp'
import LangSwitch from '../components/LangSwitch.jsx'

// Saat dibuka sebagai file HTML lokal (file://), login yang butuh redirect (Discord / link email)
// tidak bisa kembali ke halaman ini, jadi yang dipakai adalah email + password.
const IS_FILE = window.location.protocol === 'file:'

export default function Login() {
  const [mode, setMode] = useState(IS_FILE ? 'password' : 'discord')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const redirectTo = window.location.origin + window.location.pathname

  async function oauth(provider) {
    setMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, ...(provider === 'discord' ? { scopes: 'identify' } : {}) },
    })
    if (error) setMsg({ type: 'err', text: error.message })
  }

  async function withPassword(e) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name || email.split('@')[0] } },
        })
        if (error) throw error
        if (!data.session)
          setMsg({
            type: 'ok',
            text:
              'Akun dibuat. Buka email konfirmasi dan klik link-nya (halaman tujuan boleh error), lalu kembali ke sini dan klik Masuk.',
          })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          if (/confirm/i.test(error.message)) throw new Error('Email belum dikonfirmasi. Cek inbox/spam untuk link konfirmasi.')
          if (/invalid/i.test(error.message)) throw new Error('Email atau password salah.')
          throw error
        }
      }
    } catch (err) {
      setMsg({ type: 'err', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <LangSwitch className="login-lang" />
        <img src={logo} alt="BEBAS Guild" className="login-logo" />
        <h1>BEBAS Guild</h1>
        <p className="muted">Party Manager · Guild League · Polarity Zone · Siege</p>

        {mode === 'discord' ? (
          <>
            <button className="btn btn-discord btn-lg" onClick={() => oauth('discord')}>
              Masuk dengan Discord
            </button>
            <button className="btn btn-google btn-lg" onClick={() => oauth('google')}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Masuk dengan Google
            </button>
            <button className="link-btn" onClick={() => setMode('password')}>
              Masuk pakai email &amp; password
            </button>
          </>
        ) : (
          <form onSubmit={withPassword} className="login-form">
            {isSignup && (
              <input placeholder="Nama tampilan (mis. nama Discord)" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <input type="email" required placeholder="email@contoh.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password (min. 6 karakter)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn btn-gold btn-lg" disabled={busy}>
              {isSignup ? 'Daftar' : 'Masuk'}
            </button>
            <button type="button" className="link-btn" onClick={() => setIsSignup((v) => !v)}>
              {isSignup ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
            </button>
            {!IS_FILE && (
              <button type="button" className="link-btn" onClick={() => setMode('discord')}>
                Masuk dengan Discord / Google
              </button>
            )}
          </form>
        )}

        {msg && <div className={`notice notice-${msg.type}`}>{msg.text}</div>}
      </div>
    </div>
  )
}
