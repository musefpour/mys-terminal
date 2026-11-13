export type DiffOp = { kind: 'same' | 'add' | 'del'; text: string; a?: number; b?: number }

export interface DiffRow {
  kind: 'same' | 'change'
  left?: { no: number; text: string }
  right?: { no: number; text: string }
}

/** Lines beyond this edit distance are reported as "too different" instead of computed. */
const MAX_EDITS = 4000

/**
 * Line diff (Myers, O((N+M)·D)). `a` is the old text, `b` the new one.
 * Returns null when the files differ in more than MAX_EDITS lines.
 */
export function diffLines(a: string, b: string): DiffOp[] | null {
  const left = splitLines(a)
  const right = splitLines(b)
  const n = left.length
  const m = right.length
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  let v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice())
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && left[x] === right[y]) {
        x += 1
        y += 1
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
    v = next
  }
  if (!found) return null
  trace.push(v)
  // Walk the trace backwards to recover the edit script.
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 2; d >= 0; d -= 1) {
    const vv = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vv[offset + k - 1] < vv[offset + k + 1]) ? k + 1 : k - 1
    const prevX = vv[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
      ops.push({ kind: 'same', text: left[x], a: x + 1, b: y + 1 })
    }
    if (d === 0) break
    if (x === prevX) {
      y -= 1
      ops.push({ kind: 'add', text: right[y], b: y + 1 })
    } else {
      x -= 1
      ops.push({ kind: 'del', text: left[x], a: x + 1 })
    }
  }
  while (x > 0 && y > 0) {
    x -= 1
    y -= 1
    ops.push({ kind: 'same', text: left[x], a: x + 1, b: y + 1 })
  }
  return ops.reverse()
}

/** Turn an edit script into aligned rows; long unchanged runs are folded to 3 lines of context. */
export function pairRows(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].kind === 'same') {
      const op = ops[i]
      rows.push({ kind: 'same', left: { no: op.a!, text: op.text }, right: { no: op.b!, text: op.text } })
      i += 1
      continue
    }
    const dels: DiffOp[] = []
    const adds: DiffOp[] = []
    while (i < ops.length && ops[i].kind !== 'same') {
      if (ops[i].kind === 'del') dels.push(ops[i])
      else adds.push(ops[i])
      i += 1
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
      rows.push({
        kind: 'change',
        left: dels[k] ? { no: dels[k].a!, text: dels[k].text } : undefined,
        right: adds[k] ? { no: adds[k].b!, text: adds[k].text } : undefined,
      })
    }
  }
  const keep = rows.map((row, index) => row.kind === 'change' || rows.slice(Math.max(0, index - 3), index + 4).some((near) => near.kind === 'change'))
  const out: DiffRow[] = []
  rows.forEach((row, index) => {
    if (keep[index]) out.push(row)
    else if (keep[index - 1] || index === 0) out.push({ kind: 'same', left: { no: 0, text: '⋯' }, right: { no: 0, text: '⋯' } })
  })
  return out
}

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
