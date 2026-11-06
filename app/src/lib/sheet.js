import * as XLSX from 'xlsx'

/** Baca file .xlsx / .xls / .csv menjadi array baris (objek per header) */
export async function readSheet(file) {
  let wb
  if (/\.(csv|txt)$/i.test(file.name)) {
    // file.text() otomatis membuang BOM UTF-8 dari export game
    const text = await file.text()
    wb = XLSX.read(text, { type: 'string', raw: true })
  } else {
    const buf = await file.arrayBuffer()
    wb = XLSX.read(buf, { type: 'array' })
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '')

// header di file -> nama kolom di database
const HEADER_MAP = {
  player: 'name', name: 'name', nama: 'name', character: 'name', karakter: 'name', ign: 'name',
  lv: 'level', level: 'level',
  class: 'class', job: 'class', kelas: 'class',
  title: 'title',
  gender: 'gender',
  position: 'position', jabatan: 'position', rank: 'position',
  gearscore: 'gear_score', gs: 'gear_score', cp: 'gear_score', power: 'gear_score',
  weekly: 'weekly',
  weeklycontribution: 'weekly_contribution',
  totalcontribution: 'total_contribution',
  onlinestatus: 'online_status', status: 'online_status',
}

const NUMERIC = new Set(['level', 'gear_score', 'weekly', 'weekly_contribution', 'total_contribution'])

/** Ubah baris mentah dari export game menjadi data member */
export function toMemberRows(rawRows) {
  if (!rawRows.length) return { rows: [], unknownHeaders: [], hasName: false }
  const headers = Object.keys(rawRows[0])
  const mapping = {}
  const unknownHeaders = []
  for (const h of headers) {
    const key = HEADER_MAP[norm(h)]
    if (key && !Object.values(mapping).includes(key)) mapping[h] = key
    else if (!key && norm(h) !== 'id' && norm(h) !== 'no') unknownHeaders.push(h)
  }
  const hasName = Object.values(mapping).includes('name')
  const rows = rawRows
    .map((r) => {
      const o = {}
      for (const [h, key] of Object.entries(mapping)) {
        let v = String(r[h] ?? '').trim()
        if (NUMERIC.has(key)) {
          const digits = v.replace(/[^0-9-]/g, '')
          v = digits === '' || digits === '-' ? '' : String(parseInt(digits, 10))
        }
        o[key] = v
      }
      return o
    })
    .filter((o) => o.name)
  return { rows, unknownHeaders, hasName }
}

/** Ambil daftar nama dari file hasil game (untuk kehadiran) */
export function extractNames(rawRows) {
  if (!rawRows.length) return []
  const headers = Object.keys(rawRows[0])
  const nameHeader =
    headers.find((h) => HEADER_MAP[norm(h)] === 'name') ??
    headers.find((h) => !['id', 'no', 'rank', 'ranking'].includes(norm(h))) ??
    headers[0]
  return rawRows.map((r) => String(r[nameHeader] ?? '').trim()).filter(Boolean)
}

/** Simpan data sebagai file Excel */
export function downloadXlsx(rows, filename, sheetName = 'Data') {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}
