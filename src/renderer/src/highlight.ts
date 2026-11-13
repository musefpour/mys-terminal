import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'

export type Tone = 'danger' | 'warn' | 'ok' | 'ip' | 'port' | 'path' | 'hash' | 'time' | 'size' | 'text' | 'link' | 'host'

export interface HighlightRule {
  pattern: RegExp
  /** Whole match in one tone, or one tone per capture group (null = leave that group alone). */
  tone: Tone | (Tone | null)[]
}

const PALETTES: Record<'night' | 'day', Record<Tone, string>> = {
  night: {
    danger: '#ff6b6b', warn: '#f5c451', ok: '#5fd38d', ip: '#4fd1e0', port: '#79a8ff', path: '#c3a6ff',
    hash: '#e8a46c', time: '#8fa3b8', size: '#f28fb8', text: '#cfb87c', link: '#6cb6ff', host: '#4fd1e0',
  },
  day: {
    danger: '#c62828', warn: '#a86a00', ok: '#1b7f45', ip: '#00789a', port: '#2f5fd0', path: '#6b46c1',
    hash: '#a4561d', time: '#5b6b7c', size: '#b0306b', text: '#7a6420', link: '#1f6fd1', host: '#00789a',
  },
}

// Letters on either side mean "inside a word" for Persian too, where \b does not apply.
const fa = (words: string) => new RegExp(`(?<![\\p{L}\\p{M}])(?:${words})(?![\\p{L}\\p{M}])`, 'gu')

/** Earlier rules win where matches overlap. Whole words only, so "errorlevel" or "token" stay untouched. */
export const HIGHLIGHT_RULES: HighlightRule[] = [
  // Shell prompts: root in red as a reminder, then host and working directory.
  { pattern: /^(root)@([\w.-]+):(\S*?)(#)(?=\s|$)/gd, tone: ['danger', 'host', 'path', 'danger'] },
  { pattern: /^([\w.-]+)@([\w.-]+):(\S*?)([$%>])(?=\s|$)/gd, tone: ['ok', 'host', 'path', null] },
  { pattern: /\bhttps?:\/\/[^\s"'<>]+/g, tone: 'link' },
  { pattern: /\bExited \([1-9]\d*\)|\b(?:OOMKilled|CrashLoopBackOff|ErrImagePull|ImagePullBackOff|Evicted)\b/g, tone: 'danger' },
  { pattern: /\b(?:error|errors|err|failed|failure|fail|fatal|denied|refused|panic|critical|exception|traceback|segfault|unreachable|dead|killed|stopped)\b/gi, tone: 'danger' },
  { pattern: fa('خطا|ناموفق|شکست|رد شد|مجاز نیست|یافت نشد'), tone: 'danger' },
  { pattern: /\b(?:warn|warning|warnings|deprecated|timeout|timed out|retrying|restarting|pending|starting|unhealthy|degraded|inactive|paused|terminating|ContainerCreating)\b/gi, tone: 'warn' },
  { pattern: fa('هشدار|در حال تلاش|در انتظار'), tone: 'warn' },
  { pattern: /\bUp\b|\bExited \(0\)|\b(?:ok|success|successful|succeeded|passed|done|healthy|running|active \(running\)|active|enabled|connected|online|listening|LISTEN|ESTABLISHED|Ready|Completed)\b/g, tone: 'ok' },
  { pattern: /\b(?:OK|SUCCESS|PASS|DONE)\b/g, tone: 'ok' },
  { pattern: fa('موفق|انجام شد|فعال|متصل'), tone: 'ok' },
  // 10.0.0.1, 10.0.0.0/24, 0.0.0.0:1800 — then the container side of "->1000/tcp".
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?(?::\d{1,5})?\b/g, tone: 'ip' },
  { pattern: /\b\d{1,5}\/(?:tcp|udp|sctp)\b/g, tone: 'port' },
  { pattern: /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}:\d{2}:\d{2}\b/g, tone: 'time' },
  { pattern: /\b(?:About an?|an?|\d+) (?:second|minute|hour|day|week|month|year)s?(?: ago)?\b/gi, tone: 'time' },
  // Container IDs, git SHAs: hex with at least one digit and one letter.
  { pattern: /\b(?=[0-9a-f]{0,63}[a-f])(?=[0-9a-f]{0,63}\d)[0-9a-f]{7,64}\b/g, tone: 'hash' },
  { pattern: /\b\d+(?:\.\d+)?\s?(?:[KMGTP]i?B|[KMGTP]|bytes?)\b|\b\d+(?:\.\d+)?%(?!\w)/g, tone: 'size' },
  { pattern: /(?<![\w.\/-])(?:~|\.\.?)?\/[\w.@+-]+(?:\/[\w.@+-]*)*/g, tone: 'path' },
  { pattern: /"[^"\n]{1,200}"/g, tone: 'text' },
]

const MAX_DECORATIONS = 4000
const MAX_LINES_PER_PASS = 500

/**
 * One line of the buffer as text, plus the cell column of every UTF-16 unit (wide chars, emoji)
 * and whether the program already colored that unit.
 */
export function lineText(cells: { chars: string; width: number; colored?: boolean }[]): { text: string; column: number[]; colored: boolean[] } {
  let text = ''
  const column: number[] = []
  const colored: boolean[] = []
  cells.forEach((cell, x) => {
    if (cell.width === 0) return
    const chars = cell.chars || ' '
    text += chars
    for (let i = 0; i < chars.length; i += 1) {
      column.push(x)
      colored.push(Boolean(cell.colored))
    }
  })
  return { text, column, colored }
}

/** Cell ranges to color for one line of text. Text the program colored itself is left alone. */
export function findHighlights(
  text: string,
  column: number[],
  rules = HIGHLIGHT_RULES,
  colored: boolean[] = [],
  palette: Record<Tone, string> = PALETTES.night,
): { x: number; width: number; color: string }[] {
  const out: { x: number; width: number; color: string }[] = []
  const taken = new Array<boolean>(text.length).fill(false)
  const claim = (start: number, end: number, tone: Tone | null) => {
    if (end < start || column[start] === undefined || column[end] === undefined) return false
    for (let i = start; i <= end; i += 1) if (taken[i] || colored[i]) return false
    for (let i = start; i <= end; i += 1) taken[i] = true
    if (tone) out.push({ x: column[start], width: column[end] - column[start] + 1, color: palette[tone] })
    return true
  }
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index ?? 0
      if (!Array.isArray(rule.tone)) {
        claim(start, start + match[0].length - 1, rule.tone)
        continue
      }
      // Per-group tones need the "d" flag for group offsets.
      const spans = match.indices
      if (!spans) continue
      if ([...Array(match[0].length).keys()].some((i) => taken[start + i] || colored[start + i])) continue
      rule.tone.forEach((tone, index) => {
        const span = spans[index + 1]
        if (span) claim(span[0], span[1] - 1, tone)
      })
    }
  }
  return out.sort((a, b) => a.x - b.x)
}

/**
 * Colors finished lines (above the cursor) with decorations, so the byte stream is never
 * rewritten. Full-screen apps (alt buffer) are left alone.
 */
export function attachHighlighter(term: Terminal, mode: () => 'night' | 'day' = () => 'night'): IDisposable {
  const decorations: IDecoration[] = []
  let next: IMarker | undefined
  let frame = 0

  const scan = () => {
    frame = 0
    const buffer = term.buffer.active
    if (buffer.type !== 'normal') return
    const palette = PALETTES[mode()]
    const cursor = buffer.baseY + buffer.cursorY
    // The marker follows its line when scrollback drops old lines.
    let from = next && !next.isDisposed && next.line >= 0 ? next.line : Math.max(0, cursor - MAX_LINES_PER_PASS)
    if (from > cursor) from = cursor
    from = Math.max(from, cursor - MAX_LINES_PER_PASS)
    // Start on the first row of a soft-wrapped line.
    while (from > 0 && buffer.getLine(from)?.isWrapped) from -= 1
    let y = from
    let resume = cursor
    while (y < cursor) {
      // A long line soft-wrapped over several rows is matched as one line.
      let last = y
      while (last + 1 <= cursor && buffer.getLine(last + 1)?.isWrapped) last += 1
      if (last >= cursor) {
        resume = y
        break
      }
      const cells: { chars: string; width: number; colored: boolean }[] = []
      const place: { row: number; x: number }[] = []
      for (let row = y; row <= last; row += 1) {
        const line = buffer.getLine(row)
        if (!line) continue
        for (let x = 0; x < line.length; x += 1) {
          const cell = line.getCell(x)
          if (!cell) break
          cells.push({ chars: cell.getChars(), width: cell.getWidth(), colored: !cell.isFgDefault() })
          place.push({ row, x })
        }
      }
      const { text, column, colored } = lineText(cells)
      if (text.trim()) {
        for (const hit of findHighlights(text, column, HIGHLIGHT_RULES, colored, palette)) {
          // Split a hit that crosses a wrap into one decoration per row.
          let index = hit.x
          const stop = hit.x + hit.width - 1
          while (index <= stop) {
            const row = place[index].row
            let end = index
            while (end + 1 <= stop && place[end + 1].row === row) end += 1
            decorate(row - cursor, place[index].x, place[end].x - place[index].x + 1, hit.color)
            index = end + 1
          }
        }
      }
      y = last + 1
    }
    while (decorations.length > MAX_DECORATIONS) decorations.shift()?.dispose()
    next?.dispose()
    next = term.registerMarker(resume - cursor)
  }

  const decorate = (offset: number, x: number, width: number, color: string) => {
    const marker = term.registerMarker(offset)
    if (!marker) return
    const decoration = term.registerDecoration({ marker, x, width, foregroundColor: color, layer: 'top' })
    if (!decoration) {
      marker.dispose()
      return
    }
    decoration.onDispose(() => marker.dispose())
    decorations.push(decoration)
  }

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(scan)
  }
  const sub = term.onWriteParsed(schedule)
  // A resize re-wraps lines, but decorations stay on their old cells: start over.
  const resized = term.onResize(() => {
    for (const decoration of decorations.splice(0)) decoration.dispose()
    next?.dispose()
    next = undefined
    schedule()
  })
  return {
    dispose() {
      sub.dispose()
      resized.dispose()
      if (frame) window.cancelAnimationFrame(frame)
      next?.dispose()
      for (const decoration of decorations.splice(0)) decoration.dispose()
    },
  }
}
