import type { Terminal } from '@xterm/xterm'

/** Live xterm instances by connection id, for menu actions on tabs that are not focused. */
const terminals = new Map<string, Terminal>()
/** Text to show in a terminal before its first output (a tab moved in from another window). */
const seeds = new Map<string, string>()
/** Connections handed to another window: closing their tab here must not end them. */
const handedOff = new Set<string>()

export function registerTerminal(id: string, term: Terminal): void {
  terminals.set(id, term)
}

export function unregisterTerminal(id: string, term: Terminal): void {
  if (terminals.get(id) === term) terminals.delete(id)
}

/** Everything in the terminal's scrollback and screen as plain text, trailing blank lines dropped. */
export function terminalText(id: string): string {
  const term = terminals.get(id)
  if (!term) return ''
  const buffer = term.buffer.active
  const lines: string[] = []
  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row)
    if (!line) continue
    // A wrapped row continues the previous one; join them back into the original line.
    if (line.isWrapped && lines.length) lines[lines.length - 1] += line.translateToString(true)
    else lines.push(line.translateToString(true))
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.join('\n')
}

export function seedTerminal(id: string, text: string): void {
  if (text) seeds.set(id, text)
}

export function takeSeed(id: string): string {
  const text = seeds.get(id) ?? ''
  seeds.delete(id)
  return text
}

export function handOff(id: string): void {
  handedOff.add(id)
}

/** True once for a connection that was handed to another window. */
export function wasHandedOff(id: string): boolean {
  return handedOff.delete(id)
}
