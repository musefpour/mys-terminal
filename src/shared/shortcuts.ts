/**
 * Every keyboard shortcut in one place: the main process builds menu accelerators from it,
 * the renderer shows the same labels in tooltips and lets these keys out of the terminal.
 *
 * macOS uses ⌘, which never reaches the shell. Windows/Linux use Ctrl+Shift (Windows Terminal style)
 * because plain Ctrl+W/D/F/B/K/T are shell keys (delete word, EOF, readline, tmux prefix…).
 * Plain Ctrl+Alt is avoided there: on many European layouts it is AltGr and types characters.
 */
export type ShortcutId =
  | 'localTerminal' | 'newSession' | 'pickProtocol' | 'closeTab' | 'closePane'
  | 'splitV' | 'splitH' | 'splitQuad' | 'find' | 'clearTerminal' | 'record' | 'multiExec'
  | 'sidebar' | 'sidePanel' | 'palette' | 'fontBigger' | 'fontSmaller' | 'fontReset'
  | 'settings' | 'passwordGen' | 'language'
  | 'account' | 'lock' | 'newFolder'
  | 'nav1' | 'nav2' | 'nav3' | 'nav4' | 'nav5' | 'nav6' | 'nav7'

/** Electron accelerator syntax. */
export const SHORTCUTS: Record<ShortcutId, { mac: string; other: string }> = {
  localTerminal: { mac: 'Cmd+T', other: 'Ctrl+Shift+T' },
  newSession: { mac: 'Cmd+Shift+T', other: 'Ctrl+Shift+N' },
  pickProtocol: { mac: 'Cmd+Alt+T', other: 'Ctrl+Shift+Alt+T' },
  closeTab: { mac: 'Cmd+W', other: 'Ctrl+Shift+W' },
  closePane: { mac: 'Cmd+Shift+W', other: 'Ctrl+Shift+Alt+W' },
  splitV: { mac: 'Cmd+D', other: 'Ctrl+Shift+D' },
  splitH: { mac: 'Cmd+Shift+D', other: 'Ctrl+Shift+E' },
  splitQuad: { mac: 'Cmd+Alt+D', other: 'Ctrl+Shift+Alt+D' },
  find: { mac: 'Cmd+F', other: 'Ctrl+Shift+F' },
  clearTerminal: { mac: 'Cmd+Shift+K', other: 'Ctrl+Shift+K' },
  record: { mac: 'Cmd+Shift+R', other: 'Ctrl+Shift+R' },
  multiExec: { mac: 'Cmd+Shift+M', other: 'Ctrl+Shift+M' },
  sidebar: { mac: 'Cmd+B', other: 'Ctrl+Shift+B' },
  sidePanel: { mac: 'Cmd+Alt+B', other: 'Ctrl+Shift+Alt+B' },
  palette: { mac: 'Cmd+K', other: 'Ctrl+Shift+P' },
  fontBigger: { mac: 'Cmd+=', other: 'Ctrl+=' },
  fontSmaller: { mac: 'Cmd+-', other: 'Ctrl+-' },
  fontReset: { mac: 'Cmd+0', other: 'Ctrl+0' },
  settings: { mac: 'Cmd+,', other: 'Ctrl+,' },
  passwordGen: { mac: 'Cmd+Shift+G', other: 'Ctrl+Shift+G' },
  language: { mac: 'Cmd+Alt+L', other: 'Ctrl+Shift+Alt+L' },
  account: { mac: 'Cmd+Shift+A', other: 'Ctrl+Shift+A' },
  lock: { mac: 'Cmd+Shift+L', other: 'Ctrl+Shift+L' },
  newFolder: { mac: 'Cmd+Shift+N', other: 'Ctrl+Shift+Alt+N' },
  nav1: { mac: 'Ctrl+1', other: 'Ctrl+1' },
  nav2: { mac: 'Ctrl+2', other: 'Ctrl+2' },
  nav3: { mac: 'Ctrl+3', other: 'Ctrl+3' },
  nav4: { mac: 'Ctrl+4', other: 'Ctrl+4' },
  nav5: { mac: 'Ctrl+5', other: 'Ctrl+5' },
  nav6: { mac: 'Ctrl+6', other: 'Ctrl+6' },
  nav7: { mac: 'Ctrl+7', other: 'Ctrl+7' },
}

export const NAV_SHORTCUTS: ShortcutId[] = ['nav1', 'nav2', 'nav3', 'nav4', 'nav5', 'nav6', 'nav7']

const isMacPlatform = (platform: string) => platform === 'darwin'

export function accelerator(id: ShortcutId, platform: string): string {
  return isMacPlatform(platform) ? SHORTCUTS[id].mac : SHORTCUTS[id].other
}

const MAC_SYMBOL: Record<string, string> = { Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }

/** Human label: ⌘⇧T on macOS, Ctrl+Shift+T elsewhere. */
export function shortcutLabel(id: ShortcutId, platform: string): string {
  const parts = accelerator(id, platform).split('+')
  if (!isMacPlatform(platform)) return parts.join('+')
  // macOS order: ⌃⌥⇧⌘ then the key.
  const order = ['Ctrl', 'Alt', 'Shift', 'Cmd']
  const mods = order.filter((mod) => parts.includes(mod)).map((mod) => MAC_SYMBOL[mod])
  return mods.join('') + parts[parts.length - 1]
}

export interface KeyLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const CODE: Record<string, string> = { '=': 'Equal', '-': 'Minus', ',': 'Comma', '/': 'Slash', '.': 'Period' }

/** Layout-independent match on the physical key (event.code), with exact modifiers. */
export function matchesShortcut(event: KeyLike, id: ShortcutId, platform: string): boolean {
  const parts = accelerator(id, platform).split('+')
  const key = parts[parts.length - 1]
  const want = {
    meta: parts.includes('Cmd'),
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
  }
  if (event.metaKey !== want.meta || event.ctrlKey !== want.ctrl || event.shiftKey !== want.shift || event.altKey !== want.alt) return false
  const code = /^[A-Z]$/.test(key) ? `Key${key}` : /^\d$/.test(key) ? `Digit${key}` : CODE[key]
  return event.code === code
}

/** The shortcut this key press belongs to, if any. */
export function shortcutFor(event: KeyLike, platform: string): ShortcutId | null {
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    if (matchesShortcut(event, id, platform)) return id
  }
  return null
}
