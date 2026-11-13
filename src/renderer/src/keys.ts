import { shortcutFor, shortcutLabel, type KeyLike, type ShortcutId } from '../../shared/shortcuts'

/** ⌘⇧T on macOS, Ctrl+Shift+T elsewhere. */
export function keyLabel(id: ShortcutId): string {
  return shortcutLabel(id, window.mys.platform)
}

/** "Label (⌘⇧T)" for native title attributes. */
export function titled(label: string, id: ShortcutId): string {
  return `${label} (${keyLabel(id)})`
}

/** The app shortcut this key press belongs to, if any. */
export function appShortcut(event: KeyLike): ShortcutId | null {
  return shortcutFor(event, window.mys.platform)
}
