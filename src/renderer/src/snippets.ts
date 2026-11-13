import type { Macro } from '../../shared/types'

export type ShellTokenKind = 'cmd' | 'flag' | 'path' | 'str' | 'var' | 'op' | 'text' | 'space'

export interface ShellToken {
  kind: ShellTokenKind
  text: string
}

const OPERATOR = /^(?:\|\||&&|>>|2>&1|[|;&<>])/
const STRING = /^(?:'[^']*'?|"(?:[^"\\]|\\.)*"?)/
const VARIABLE = /^\$(?:\{[^}]*\}?|\(|[A-Za-z_][A-Za-z0-9_]*|[0-9#?@*$!-])/
const WORD = /^[^\s|;&<>'"$]+/

/** Rough shell tokenizer for tinting a snippet preview. Never used to execute anything. */
export function tokenizeShell(source: string): ShellToken[] {
  const out: ShellToken[] = []
  let rest = source
  let expectCommand = true
  const push = (kind: ShellTokenKind, text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && (kind === 'space' || kind === 'text')) last.text += text
    else out.push({ kind, text })
  }
  while (rest) {
    const space = /^\s+/.exec(rest)
    if (space) {
      if (space[0].includes('\n')) expectCommand = true
      push('space', space[0])
      rest = rest.slice(space[0].length)
      continue
    }
    const op = OPERATOR.exec(rest)
    if (op) {
      push('op', op[0])
      if (op[0] !== '>' && op[0] !== '>>' && op[0] !== '<' && op[0] !== '2>&1') expectCommand = true
      rest = rest.slice(op[0].length)
      continue
    }
    const str = STRING.exec(rest)
    if (str) {
      push('str', str[0])
      expectCommand = false
      rest = rest.slice(str[0].length)
      continue
    }
    const variable = VARIABLE.exec(rest)
    if (variable) {
      push('var', variable[0])
      rest = rest.slice(variable[0].length)
      continue
    }
    const word = WORD.exec(rest)?.[0] ?? rest[0]
    rest = rest.slice(word.length)
    if (expectCommand && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      push('cmd', word)
      expectCommand = word === 'sudo' || word === 'time' || word === 'env' || word === 'exec'
    } else if (/^--?[A-Za-z0-9]/.test(word)) {
      push('flag', word)
    } else if (/^(?:~|\.{1,2})?\//.test(word) || /^[\w.-]+\/[\w./-]*$/.test(word)) {
      push('path', word)
    } else {
      push('text', word)
    }
  }
  return out
}

/** Every distinct tag across snippets, in first-seen order. */
export function snippetTags(macros: Macro[]): string[] {
  const seen = new Set<string>()
  for (const macro of macros) for (const tag of macro.tags ?? []) seen.add(tag)
  return [...seen]
}

/** Pinned first; otherwise saved order (which drag-to-reorder controls). */
export function orderSnippets(macros: Macro[]): Macro[] {
  return [...macros.filter((item) => item.pinned), ...macros.filter((item) => !item.pinned)]
}

export function matchesSnippet(macro: Macro, query: string, tag: string | null): boolean {
  if (tag && !(macro.tags ?? []).includes(tag)) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  // A secret's command is never in the renderer, so it can only match by name or tag.
  return macro.name.toLowerCase().includes(q)
    || macro.command.toLowerCase().includes(q)
    || (macro.tags ?? []).some((item) => item.toLowerCase().includes(q))
}

/** Move `id` to sit before `beforeId` (or to the end), keeping everything else in place. */
export function moveSnippet(macros: Macro[], id: string, beforeId: string | null): Macro[] {
  const moving = macros.find((item) => item.id === id)
  if (!moving || id === beforeId) return macros
  const rest = macros.filter((item) => item.id !== id)
  const at = beforeId ? rest.findIndex((item) => item.id === beforeId) : -1
  if (at < 0) return [...rest, moving]
  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}

export const SECRET_MASK = '••••••••••••'
