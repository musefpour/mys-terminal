import { useEffect, useState } from 'react'
import { LOCALES, localeInfo } from '../../../shared/i18n'
import type { LocaleId } from '../../../shared/types'
import { flagSrc } from '../flags'
import { useI18n } from '../i18n'
import { useModel } from '../model'

export function Flag({ code }: { code: string }) {
  return <img className="flag" src={flagSrc(code)} alt="" width={22} height={15} />
}

export function LanguageList({ onPick }: { onPick?: () => void }) {
  const model = useModel()
  const current = localeInfo(model.settings.locale).id
  return (
    <div className="lang-list" role="listbox">
      {LOCALES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === current}
          className={item.id === current ? 'on' : ''}
          onClick={() => {
            const next = { ...model.settings, locale: item.id }
            void model.saveSettings(next, { quiet: true })
            onPick?.()
          }}
        >
          <Flag code={item.flag} />
          <span className="native">{item.native}</span>
          <span className="english">{item.english}</span>
        </button>
      ))}
    </div>
  )
}

export function LanguageField() {
  const model = useModel()
  const [open, setOpen] = useState(false)
  const info = localeInfo(model.settings.locale)
  return (
    <div className="lang-setting">
      <button type="button" className="lang-current" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Flag code={info.flag} />
        <span className="native">{info.native}</span>
        <span className="english">{info.english}</span>
        <i className={open ? 'caret open' : 'caret'} />
      </button>
      {open && (
        <div className="lang-drop">
          <LanguageList onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

export function LanguageButton() {
  const model = useModel()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const info = localeInfo(model.settings.locale)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  return (
    <div className="lang-pop" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="tool-icon" title={`${t('language')}: ${info.native}`} aria-label={t('language')} onClick={() => setOpen((value) => !value)}>
        <Flag code={info.flag} />
      </button>
      {open && (
        <div className="lang-menu">
          <LanguageList onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

export function isLocale(value: string): value is LocaleId {
  return LOCALES.some((item) => item.id === value)
}
