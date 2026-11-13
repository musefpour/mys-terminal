/** asciicast v2 parsing for the recording player (kept free of DOM imports for tests). */

export interface CastEvent {
  /** Seconds from start, with long pauses squeezed to IDLE_LIMIT. */
  at: number
  kind: 'o' | 'r'
  data: string
}

export interface Cast {
  cols: number
  rows: number
  title: string
  duration: number
  events: CastEvent[]
}

const IDLE_LIMIT = 2

/** asciicast v2 → events; gaps longer than IDLE_LIMIT seconds are shortened like `asciinema play -i`. */
export function parseCast(text: string): Cast {
  const lines = text.split('\n').filter((line) => line.trim())
  const header = JSON.parse(lines[0] || '{}') as { width?: number; height?: number; title?: string; version?: number }
  if (header.version !== 2) throw new Error('not an asciicast v2 file')
  const events: CastEvent[] = []
  let last = 0
  let clock = 0
  for (const line of lines.slice(1)) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(row) || typeof row[0] !== 'number' || (row[1] !== 'o' && row[1] !== 'r') || typeof row[2] !== 'string') continue
    clock += Math.min(IDLE_LIMIT, Math.max(0, row[0] - last))
    last = row[0]
    events.push({ at: clock, kind: row[1], data: row[2] })
  }
  return { cols: Number(header.width) || 80, rows: Number(header.height) || 24, title: String(header.title || ''), duration: clock, events }
}
