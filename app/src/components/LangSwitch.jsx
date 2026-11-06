import { LANGS, getLang, setLang } from '../lib/i18n.js'

/** Pilihan bahasa: Indonesia, Melayu, English, ไทย, Filipino */
export default function LangSwitch({ className = '' }) {
  const cur = getLang()
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
          {l.flag} {l.name}
        </option>
      ))}
    </select>
  )
}
