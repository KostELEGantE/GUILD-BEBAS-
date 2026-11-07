import { useEffect, useState } from 'react'
import { LANGS, getLang, setLang } from '../lib/i18n.js'

// layar sempit (HP): tampilkan bendera + kode saja, mis. "🇮🇩 ID"
const narrowQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 600px)') : null
function useNarrow() {
  const [n, setN] = useState(!!narrowQ?.matches)
  useEffect(() => {
    if (!narrowQ) return
    const on = () => setN(narrowQ.matches)
    narrowQ.addEventListener?.('change', on)
    return () => narrowQ.removeEventListener?.('change', on)
  }, [])
  return n
}

/** Pilihan bahasa: Indonesia, Melayu, English, ไทย, Filipino */
export default function LangSwitch({ className = '' }) {
  const cur = getLang()
  const narrow = useNarrow() && !className.includes('login-lang')
  return (
    <select
      className={`lang-select notranslate ${className}`}
      value={cur}
      onChange={(e) => setLang(e.target.value)}
      aria-label="Language"
      title="Language / Bahasa"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {narrow ? `${l.flag} ${l.code.toUpperCase()}` : `${l.flag} ${l.name}`}
        </option>
      ))}
    </select>
  )
}
