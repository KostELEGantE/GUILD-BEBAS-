// Penerjemah tampilan: menerjemahkan semua teks di halaman (termasuk popup, toast,
// konfirmasi) berdasarkan kamus di i18n-dict.js, tanpa mengubah setiap komponen.
// Nama karakter, angka, dan isi yang diketik pengguna tidak disentuh.
import { DICT, PATTERNS, LANGS } from './i18n-dict.js'

export { LANGS }
const IDX = { id: 0, ms: 1, en: 2, th: 3, fil: 4 }
const KEY = 'bebas-lang'

function detect() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && IDX[saved] != null) return saved
  } catch {
    /* penyimpanan tidak tersedia */
  }
  const nav = (navigator.language || 'id').toLowerCase()
  if (nav.startsWith('ms')) return 'ms'
  if (nav.startsWith('th')) return 'th'
  if (nav.startsWith('fil') || nav.startsWith('tl')) return 'fil'
  if (nav.startsWith('en')) return 'en'
  return 'id'
}

let lang = detect()
export const getLang = () => lang
export const getLocale = () => LANGS.find((l) => l.code === lang)?.locale ?? 'id-ID'

export function setLang(code) {
  if (IDX[code] == null || code === lang) return
  try {
    localStorage.setItem(KEY, code)
  } catch {
    /* abaikan */
  }
  // muat ulang supaya tanggal & angka ikut format bahasa baru
  window.location.reload()
}

const norm = (s) => s.replace(/\s+/g, ' ')

/** Terjemahkan satu potongan teks (tanpa spasi tepi). null = tidak ada terjemahan. */
function lookup(core) {
  const i = IDX[lang]
  const key = norm(core)
  const e = DICT[key] ?? DICT[core]
  if (e) return e[i] || null
  for (const [re, arr] of PATTERNS) {
    const m = key.match(re)
    if (!m) continue
    const tpl = arr[i]
    if (!tpl) return null
    return tpl.replace(/\$(\d)/g, (_, n) => {
      const part = m[+n] ?? ''
      return lookup(part) ?? part
    })
  }
  return null
}

/** Terjemahkan teks, mempertahankan spasi/baris di awal & akhir. Bisa multi-baris. */
export function tr(text) {
  if (!text || !/[A-Za-z]/.test(text)) return text
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  const core = m[2]
  let out = lookup(core)
  if (out == null && core.includes('\n')) {
    // pesan multi-baris (confirm/alert): terjemahkan per baris
    const lines = core.split('\n').map((l) => (l.trim() ? lookup(l.trim()) ?? l : l))
    const joined = lines.join('\n')
    if (joined !== core) out = joined
  }
  return out == null ? text : m[1] + out + m[3]
}

// ---------- penerapan ke DOM ----------
const textState = new WeakMap() // node -> { src, out }
const ATTRS = ['placeholder', 'title', 'aria-label']
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE'])

function skip(el, forAttr = false) {
  for (let e = el; e; e = e.parentElement) {
    if (e.classList?.contains('notranslate') || e.isContentEditable) return true
    // teks di dalam input/script tidak disentuh, tapi placeholder/title input tetap diterjemahkan
    if (!forAttr && SKIP.has(e.tagName)) return true
  }
  return false
}

function doText(node) {
  const cur = node.nodeValue
  const st = textState.get(node)
  const src = st && cur === st.out ? st.src : cur
  const out = tr(src)
  textState.set(node, { src, out })
  if (out !== cur) node.nodeValue = out
}

function doAttrs(el) {
  const st = (el.__i18n ??= {})
  for (const a of ATTRS) {
    const cur = el.getAttribute(a)
    if (!cur) continue
    const prev = st[a]
    const src = prev && cur === prev.out ? prev.src : cur
    const out = tr(src)
    st[a] = { src, out }
    if (out !== cur) el.setAttribute(a, out)
  }
}

function walk(root) {
  if (root.nodeType === 3) {
    if (root.parentElement && !skip(root.parentElement)) doText(root)
    return
  }
  if (root.nodeType !== 1) return
  if (!skip(root, true)) doAttrs(root)
  if (skip(root)) return
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let n
  while ((n = w.nextNode())) {
    if (n.nodeType === 1) {
      if (!skip(n, true)) doAttrs(n)
    } else if (n.parentElement && !skip(n.parentElement)) doText(n)
  }
}

export function startI18n() {
  document.documentElement.lang = lang === 'fil' ? 'fil' : lang

  // popup bawaan browser ikut diterjemahkan
  const { confirm, alert, prompt } = window
  window.confirm = (msg) => confirm.call(window, tr(String(msg ?? '')))
  window.alert = (msg) => alert.call(window, tr(String(msg ?? '')))
  window.prompt = (msg, def) => prompt.call(window, tr(String(msg ?? '')), def)

  walk(document.body)
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') {
        if (m.target.parentElement && !skip(m.target.parentElement)) doText(m.target)
      } else if (m.type === 'attributes') {
        if (!skip(m.target, true)) doAttrs(m.target)
      } else {
        m.addedNodes.forEach(walk)
      }
    }
  })
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}
