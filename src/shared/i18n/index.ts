import type { LocaleId, Protocol, Session } from '../types'
import { normalizeLocale } from '../types'
import { ar } from './ar'
import { da } from './da'
import { de, deAT } from './de'
import { el } from './el'
import { en, type MessageKey, type Messages } from './en'
import { fa } from './fa'
import { fr } from './fr'
import { hi } from './hi'
import { nl } from './nl'
import { pt, ptBR } from './pt'
import { ru } from './ru'
import { es } from './es'
import { tr } from './tr'
import { zh } from './zh'

export type { MessageKey, Messages }

export interface LocaleInfo {
  id: LocaleId
  native: string
  english: string
  flag: string
  dir: 'rtl' | 'ltr'
}

export const LOCALES: LocaleInfo[] = [
  { id: 'en', native: 'English', english: 'English', flag: 'gb', dir: 'ltr' },
  { id: 'nl', native: 'Nederlands', english: 'Dutch', flag: 'nl', dir: 'ltr' },
  { id: 'de', native: 'Deutsch', english: 'German', flag: 'de', dir: 'ltr' },
  { id: 'de-AT', native: 'Österreichisches Deutsch', english: 'Austrian German', flag: 'at', dir: 'ltr' },
  { id: 'fr', native: 'Français', english: 'French', flag: 'fr', dir: 'ltr' },
  { id: 'zh', native: '中文', english: 'Chinese', flag: 'cn', dir: 'ltr' },
  { id: 'hi', native: 'हिन्दी', english: 'Hindi', flag: 'in', dir: 'ltr' },
  { id: 'es', native: 'Español', english: 'Spanish', flag: 'es', dir: 'ltr' },
  { id: 'pt', native: 'Português', english: 'Portuguese', flag: 'pt', dir: 'ltr' },
  { id: 'pt-BR', native: 'Português (Brasil)', english: 'Brazilian Portuguese', flag: 'br', dir: 'ltr' },
  { id: 'el', native: 'Ελληνικά', english: 'Greek', flag: 'gr', dir: 'ltr' },
  { id: 'tr', native: 'Türkçe', english: 'Turkish', flag: 'tr', dir: 'ltr' },
  { id: 'ar', native: 'العربية', english: 'Arabic', flag: 'sa', dir: 'rtl' },
  { id: 'fa', native: 'فارسی', english: 'Persian', flag: 'ir', dir: 'rtl' },
  { id: 'ru', native: 'Русский', english: 'Russian', flag: 'ru', dir: 'ltr' },
  { id: 'da', native: 'Dansk', english: 'Danish', flag: 'dk', dir: 'ltr' },
]

const PACKS: Record<LocaleId, Messages> = {
  en,
  nl,
  de,
  'de-AT': deAT,
  fr,
  zh,
  hi,
  es,
  pt,
  'pt-BR': ptBR,
  el,
  tr,
  ar,
  fa,
  ru,
  da,
}

export function localeInfo(id: string): LocaleInfo {
  return LOCALES.find((item) => item.id === normalizeLocale(id)) ?? LOCALES[0]
}

export function translate(locale: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const pack = PACKS[normalizeLocale(locale)]
  const template = pack[key] || en[key]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

const PROTOCOL_NAME: Partial<Record<Protocol, MessageKey>> = {
  local: 'protocolLocal',
  raw: 'protocolRaw',
  serial: 'protocolSerial',
  browser: 'protocolBrowser',
}

const PROTOCOL_PLAIN: Partial<Record<Protocol, string>> = {
  telnet: 'Telnet',
  mosh: 'Mosh',
  docker: 'Docker',
  k8s: 'Kubernetes',
  powershell: 'PowerShell',
}

export function protocolLabel(locale: string, protocol: Protocol): string {
  const key = PROTOCOL_NAME[protocol]
  if (key) return translate(locale, key)
  return PROTOCOL_PLAIN[protocol] ?? protocol.toUpperCase()
}

const BADGE_KEY: Partial<Record<Protocol, MessageKey>> = {
  local: 'badgeLocal',
  raw: 'badgeRaw',
  serial: 'badgeSerial',
  browser: 'badgeBrowser',
}

const BADGE_PLAIN: Partial<Record<Protocol, string>> = {
  telnet: 'Tel',
  mosh: 'Mosh',
  docker: 'Dkr',
  k8s: 'K8s',
  powershell: 'PS',
}

/** Short tag shown in tabs, lists and history cards. */
export function protocolBadge(locale: string, protocol: Protocol): string {
  const key = BADGE_KEY[protocol]
  if (key) return translate(locale, key)
  return BADGE_PLAIN[protocol] ?? protocol.toUpperCase()
}

export function titledSession(session: Pick<Session, 'name' | 'protocol' | 'host' | 'username'>, locale: string): string {
  if (session.name.trim()) return session.name.trim()
  if (session.protocol === 'local' || session.protocol === 'browser' || session.protocol === 'serial') {
    return protocolLabel(locale, session.protocol)
  }
  const user = session.username ? `${session.username}@` : ''
  return `${protocolLabel(locale, session.protocol)} ${user}${session.host}`.trim()
}
