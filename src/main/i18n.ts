import { translate, type MessageKey } from '../shared/i18n'

let locale = 'fa'

export function setAppLocale(value: string): void {
  locale = value
}

export function tr(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars)
}

const CODES: Record<string, MessageKey> = {
  'invalid-host': 'invalidHost',
  'invalid-port': 'invalidPort',
}

export function explain(error: unknown, fallback: MessageKey): string {
  const message = error instanceof Error ? error.message : ''
  if (message in CODES) return tr(CODES[message])
  return message || tr(fallback)
}
