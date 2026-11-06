import { groupColor } from '../lib/util.js'

/** Label kecil berwarna untuk party fix */
export default function GroupChip({ g, count }) {
  if (!g) return null
  return (
    <span className="group-chip" style={{ '--g': groupColor(g.id) }} title={`Party fix: ${g.name}`}>
      {g.name}
      {count != null && <span className="group-chip-n">{count}</span>}
    </span>
  )
}
