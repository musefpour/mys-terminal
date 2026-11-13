import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VaultPassword } from '../../../shared/types'
import { titled } from '../keys'
import { useI18n } from '../i18n'
import { XMark } from './XMark'

function makePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'
  const bytes = new Uint32Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (item) => alphabet[item % alphabet.length]).join('')
}

export function PasswordGen({ onPick, icon = false }: { onPick?: (value: string) => void; icon?: boolean }) {
  const { t, locale } = useI18n()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)
  const [items, setItems] = useState<VaultPassword[]>([])
  const [drop, setDrop] = useState<VaultPassword | null>(null)

  const show = (next: string) => {
    setValue(next)
    setCopied(false)
    setOpen(true)
    onPick?.(next)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.pass-doom')) return
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.pass-doom')) setOpen(false)
    }
    void window.mys.passwords.list().then(setItems)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Only the title-bar instance (icon) answers the keyboard shortcut.
  useEffect(() => (icon ? window.mys.onMenu('menu:passgen', () => show(value || makePassword())) : undefined))

  return (
    <div className="passgen" ref={root}>
      <button type="button" className={icon ? 'passgen-btn icon' : 'passgen-btn'} title={icon ? titled(t('passwordGen'), 'passwordGen') : t('passwordGen')} aria-label={t('passwordGen')} onClick={() => show(value || makePassword())}>
        <KeyIcon />
        {!icon && <span>{t('passwordGen')}</span>}
      </button>
      {open && (
        <div className="passgen-pop" role="dialog">
          <div className="passgen-head">
            <p className="passgen-label">{t('passwordGen')}</p>
            <button type="button" className="passgen-x" title={t('close')} aria-label={t('close')} onClick={() => setOpen(false)}>
              <XMark />
            </button>
          </div>
          <div className="passgen-value" dir="ltr">{value}</div>
          <div className="passgen-actions">
            <button type="button" className="passgen-ghost" aria-label={t('passwordGen')} onClick={() => show(makePassword())}>
              <RefreshIcon />
            </button>
            <button
              type="button"
              className={copied ? 'passgen-copy on' : 'passgen-copy'}
              title={copied ? t('copied') : t('copy')}
              aria-label={copied ? t('copied') : t('copy')}
              onClick={() => {
                void navigator.clipboard.writeText(value).then(async () => {
                  setCopied(true)
                  setItems(await window.mys.passwords.remember(value))
                })
              }}
            >{copied ? <CheckIcon /> : <CopyIcon />}</button>
          </div>
          <VaultList items={items} locale={locale} onChange={setItems} onDelete={setDrop} />
        </div>
      )}
      {drop && (
        <PasswordDrop
          item={drop}
          onCancel={() => setDrop(null)}
          onConfirm={() => {
            const id = drop.id
            setDrop(null)
            void window.mys.passwords.remove(id).then(setItems)
          }}
        />
      )}
    </div>
  )
}

function VaultList({ items, locale, onChange, onDelete }: { items: VaultPassword[]; locale: string; onChange: (next: VaultPassword[]) => void; onDelete: (item: VaultPassword) => void }) {
  const { t } = useI18n()
  const [exported, setExported] = useState(false)
  const format = new Intl.DateTimeFormat(locale === 'de-AT' ? 'de-AT' : locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const visible = [...items].sort((a, b) => Number(b.kept) - Number(a.kept) || b.createdAt - a.createdAt)
  const tone = (item: VaultPassword) => {
    if (!item.kept) return 'open'
    const month = 30 * 24 * 60 * 60 * 1000
    return Date.now() - item.createdAt > month ? 'old' : 'fresh'
  }
  return (
    <div className="pass-vault">
      <div className="pass-vault-head">
        <p className="passgen-label">{t('passwords')}</p>
        <span className="pass-ops">
          <button
            type="button"
            title={exported ? t('passwordsExported') : t('exportPasswords')}
            aria-label={exported ? t('passwordsExported') : t('exportPasswords')}
            disabled={visible.length === 0}
            onClick={() => {
              void window.mys.passwords.export().then((saved) => {
                if (!saved) return
                setExported(true)
                setTimeout(() => setExported(false), 1600)
              })
            }}
          >{exported ? <CheckIcon /> : <ExportIcon />}</button>
        </span>
      </div>
      {visible.length === 0 && <p className="pass-empty">{t('passwordsEmpty')}</p>}
      <ul className="plain">
        {visible.map((item) => (
          <li key={item.id}>
            <span className="pass-main">
              <span className={`pass-secret ${tone(item)}`} dir="ltr">{item.secret}</span>
              <time dateTime={new Date(item.createdAt).toISOString()}>{format.format(item.createdAt)}</time>
            </span>
            <span className="pass-ops">
              <button type="button" title={t('copy')} aria-label={t('copy')} onClick={() => void navigator.clipboard.writeText(item.secret)}>
                <CopyIcon />
              </button>
              {!item.kept && (
                <button type="button" title={t('saveThis')} aria-label={t('saveThis')} onClick={() => { void window.mys.passwords.keep(item.id, item.label).then(onChange) }}>
                  <SaveIcon />
                </button>
              )}
              <button
                type="button"
                className="danger"
                title={t('delete')}
                aria-label={t('delete')}
                onClick={() => onDelete(item)}
              >
                <TrashIcon />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PasswordDrop({ item, onCancel, onConfirm }: { item: VaultPassword; onCancel: () => void; onConfirm: () => void }) {
  const { t, dir } = useI18n()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(
    <div className="pass-doom" dir={dir} onMouseDown={onCancel}>
      <div
        className="pass-doom-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pass-doom-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pass-doom-seal" aria-hidden="true"><TrashIcon /></div>
        <h2 id="pass-doom-title">{t('deletePassword')}</h2>
        <p className="pass-doom-note">{t('deletePasswordNote')}</p>
        <div className="pass-doom-secret" dir="ltr">{item.secret}</div>
        <div className="pass-doom-actions">
          <button type="button" className="pass-doom-no" onClick={onCancel}>{t('cancel')}</button>
          <button type="button" className="pass-doom-yes" onClick={onConfirm}>{t('delete')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 14v5h14v-5" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M8 4v6h7" />
      <path d="M8 20v-6h8v6" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 5v5h-5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7.5" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="3.2" />
      <path d="M11 12h9v2.2h-2.2V16H15.6v-1.8H11" />
    </svg>
  )
}
