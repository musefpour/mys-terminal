import { describe, expect, it } from 'vitest'
import { accelerator, matchesShortcut, shortcutFor, shortcutLabel, SHORTCUTS, type ShortcutId } from '../src/shared/shortcuts'

const ids = Object.keys(SHORTCUTS) as ShortcutId[]
const press = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  ({ key: '', code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods })

describe('keyboard shortcuts', () => {
  it.each(['darwin', 'win32', 'linux'])('has no duplicate keys on %s', (platform) => {
    const keys = ids.map((id) => accelerator(id, platform))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never claims plain Ctrl+letter on Windows/Linux (shell keys)', () => {
    for (const id of ids) {
      const parts = accelerator(id, 'win32').split('+')
      if (parts.includes('Ctrl') && /^[A-Z]$/.test(parts[parts.length - 1])) expect(parts).toContain('Shift')
    }
  })

  it('formats labels per platform', () => {
    expect(shortcutLabel('newSession', 'darwin')).toBe('⇧⌘T')
    expect(shortcutLabel('splitQuad', 'darwin')).toBe('⌥⌘D')
    expect(shortcutLabel('newSession', 'win32')).toBe('Ctrl+Shift+N')
  })

  it('matches physical keys with exact modifiers', () => {
    expect(matchesShortcut(press('KeyT', { metaKey: true }), 'localTerminal', 'darwin')).toBe(true)
    expect(matchesShortcut(press('KeyT', { metaKey: true, shiftKey: true }), 'localTerminal', 'darwin')).toBe(false)
    expect(shortcutFor(press('Equal', { ctrlKey: true }), 'win32')).toBe('fontBigger')
    expect(shortcutFor(press('KeyW', { ctrlKey: true }), 'win32')).toBe(null)
    expect(shortcutFor(press('Digit3', { ctrlKey: true }), 'darwin')).toBe('nav3')
  })
})
