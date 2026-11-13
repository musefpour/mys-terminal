/**
 * Word and line navigation keys for the terminal, the way each OS's own terminals behave:
 *
 *   macOS            ⌥←/⌥→ word, ⌥⌫ delete word, ⌥⌦ delete next word, ⌘←/⌘→ line start/end, ⌘⌫ delete to line start
 *   Windows / Linux  Ctrl+←/→ word, Ctrl+Backspace delete word, Ctrl+Delete delete next word
 *
 * xterm sends ESC[1;3D / ESC[1;5D for these, which zsh and many bash setups leave unbound.
 * Readline/ZLE/fish all understand the emacs keys (ESC b, ESC f, ESC DEL, ESC d, ^A, ^E, ^U),
 * so those are sent to POSIX shells. Windows shells (PowerShell, cmd via ConPTY) get the
 * Ctrl+arrow sequences they map to word moves themselves.
 */
export interface NavKey {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type ShellKind = 'posix' | 'windows'

const ESC = '\x1b'

export function navSequence(event: NavKey, platform: string, shell: ShellKind): string | null {
  // Shift is for selecting text; leave those combinations alone.
  if (event.shiftKey) return null
  const mac = platform === 'darwin'
  const { key } = event

  if (mac) {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      if (key === 'ArrowLeft') return `${ESC}b`
      if (key === 'ArrowRight') return `${ESC}f`
      if (key === 'Backspace') return `${ESC}\x7f`
      if (key === 'Delete') return `${ESC}d`
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      if (key === 'ArrowLeft') return '\x01'
      if (key === 'ArrowRight') return '\x05'
      if (key === 'Backspace') return '\x15'
    }
    return null
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    if (shell === 'windows') {
      if (key === 'ArrowLeft') return `${ESC}[1;5D`
      if (key === 'ArrowRight') return `${ESC}[1;5C`
      return null
    }
    if (key === 'ArrowLeft') return `${ESC}b`
    if (key === 'ArrowRight') return `${ESC}f`
    if (key === 'Backspace') return `${ESC}\x7f`
    if (key === 'Delete') return `${ESC}d`
  }
  // Alt+←/→ is the other common word-jump habit on Linux.
  if (event.altKey && !event.ctrlKey && !event.metaKey && shell === 'posix') {
    if (key === 'ArrowLeft') return `${ESC}b`
    if (key === 'ArrowRight') return `${ESC}f`
  }
  return null
}
