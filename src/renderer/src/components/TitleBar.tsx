import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { LOCALES, localeInfo, protocolLabel } from '../../../shared/i18n'
import type { Protocol } from '../../../shared/types'
import { allTabs, isHomeTab } from '../layout'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { ProtocolIcon, protocolStyle } from '../protocols'
import { BrandLogo } from './BrandLogo'
import { CommandPalette } from './CommandPalette'
import { PasswordGen } from './PasswordGen'
import { keyLabel } from '../keys'
import '../titlebar.css'

const MAC = window.mys.platform === 'darwin'

const NEW_PROTOCOLS: Protocol[] = ['ssh', 'sftp', 'mosh', 'telnet', 'rdp', 'vnc', 'ftp', 's3', 'serial', 'docker', 'k8s', 'browser']

export function TitleBar() {
  const model = useModel()
  const { t } = useI18n()
  const [palette, setPalette] = useState(false)
  const live = allTabs(model.layout).filter((tab) => !isHomeTab(tab)).length

  /** Lock now, or (no master password yet) open Settings where one is set. */
  const lockScreen = async () => {
    const status = await window.mys.lock.status()
    if (status.enabled) {
      await window.mys.lock.lockNow()
      return
    }
    model.setDrawer('settings')
    model.toast(t('lockSetFirst'))
  }

  // ⌘K / Ctrl+Shift+P is a menu accelerator, so it works from anywhere (including inside a terminal).
  useEffect(() => window.mys.onMenu('menu:palette', () => setPalette((value) => !value)), [])

  return (
    <header className="tb">
      <div className="tb-start">
        {!MAC && <AppMenuButton />}
        <div className="tb-brand" title={t('tagline')}>
          <BrandLogo size={22} />
          <strong>Mys Terminal</strong>
        </div>
        <span className="tb-div" aria-hidden="true" />
        <button
          type="button"
          className={model.sidebar ? 'tb-btn icon on tip' : 'tb-btn icon tip'}
          data-tip={`${t('sessions')}  ${keyLabel('sidebar')}`}
          aria-label={t('sessions')}
          aria-pressed={model.sidebar}
          onClick={() => model.setSidebar(!model.sidebar)}
        ><Glyph d={['M4 5h16v14H4z', 'M9.5 5v14']} /></button>

        <NewSessionButton />
        <button
          type="button"
          className="tb-btn icon tb-collapse tip"
          data-tip={`${t('localTerminal')}  ${keyLabel('localTerminal')}`}
          aria-label={t('localTerminal')}
          onClick={() => model.openLocal()}
        ><Glyph d={['M4 5h16v14H4z', 'M8 10l2.5 2L8 14', 'M13 14h3']} /></button>
        <button
          type="button"
          className={model.multiExec ? 'tb-btn icon tb-collapse on tip' : 'tb-btn icon tb-collapse tip'}
          data-tip={`${t('multiExec')}  ${keyLabel('multiExec')}`}
          aria-label={t('multiExec')}
          aria-pressed={model.multiExec}
          onClick={() => model.setMultiExec(!model.multiExec)}
        ><Glyph d={['M4 7h10v10H4z', 'M8 4h12v10']} /></button>
      </div>

      <div className="tb-center">
        <button
          type="button"
          className="tb-search tip"
          data-tip={`${t('commandPalette')}  ${keyLabel('palette')}`}
          aria-label={t('tbSearch')}
          aria-haspopup="dialog"
          onClick={() => setPalette(true)}
        >
          <Glyph d={['M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12z', 'M16 16l4 4']} />
          <span className="tb-search-text">{t('tbSearch')}</span>
          <kbd>{keyLabel('palette')}</kbd>
        </button>
      </div>

      <div className="tb-end">
        <Clock />
        {live > 0 && (
          <span className="tb-live" role="status" title={t('tbActive', { n: live })}>
            <i aria-hidden="true" />
            <span className="tb-live-n">{live}</span>
            <span className="tb-live-text">{t('tbActiveWord')}</span>
          </span>
        )}
        <span className="tb-div tb-collapse" aria-hidden="true" />
        <div className="tb-collapse tb-pass"><PasswordGen icon /></div>
        <button
          type="button"
          className="tb-btn icon tb-collapse tip tip-end"
          data-tip={`${t('settings')}  ${keyLabel('settings')}`}
          aria-label={t('settings')}
          onClick={() => model.setDrawer('settings')}
        ><Glyph d={GEAR} /></button>
        <button
          type="button"
          className="tb-btn icon tip tip-end"
          data-tip={`${t('lockNow')}  ${keyLabel('lock')}`}
          aria-label={t('lockNow')}
          onClick={() => void lockScreen()}
        ><Glyph d={LOCK} /></button>
        <LanguagePill className="tb-collapse" />
        <MoreMenu />
        <span className="tb-div" aria-hidden="true" />
        <AccountButton />
      </div>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </header>
  )
}

/* ─── pieces ─── */

/** Windows/Linux have no menu bar under the custom title bar: ☰ (or a lone Alt press) opens the app menu. */
function AppMenuButton() {
  const { t } = useI18n()
  const ref = useRef<HTMLButtonElement>(null)
  const open = () => {
    const box = ref.current?.getBoundingClientRect()
    if (box) void window.mys.popupMenu(box.left, box.bottom + 4)
  }

  useEffect(() => {
    let alone = false
    const down = (event: KeyboardEvent) => { alone = event.key === 'Alt' && !event.repeat }
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && alone) {
        event.preventDefault()
        open()
      }
      alone = false
    }
    const reset = () => { alone = false }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('mousedown', reset, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('mousedown', reset, true)
    }
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      className="tb-btn icon tb-appmenu tip"
      data-tip={`${t('tbMenu')}  Alt`}
      aria-label={t('tbMenu')}
      aria-haspopup="menu"
      aria-keyshortcuts="Alt"
      onClick={open}
    ><Glyph d={['M4 7h16', 'M4 12h16', 'M4 17h16']} /></button>
  )
}

function NewSessionButton() {
  const model = useModel()
  const { t, locale } = useI18n()
  return (
    <div className="tb-split">
      <button
        type="button"
        className="tb-btn tb-primary tip"
        data-tip={`${t('newSession')}  ${keyLabel('newSession')}`}
        aria-label={t('newSession')}
        onClick={() => model.openBlank('ssh')}
      ><Glyph d={['M12 5v14', 'M5 12h14']} /></button>
      <Dropdown
        label={t('tbPickProtocol')}
        tip={`${t('tbPickProtocol')}  ${keyLabel('pickProtocol')}`}
        openOn="menu:pick-protocol"
        className="tb-btn tb-primary tb-caret-btn"
        trigger={<Caret />}
        align="start"
      >
        {(close) => NEW_PROTOCOLS.map((protocol) => (
          <button
            key={protocol}
            type="button"
            role="menuitem"
            onClick={() => { close(); model.openBlank(protocol) }}
          >
            <span className="tb-proto" style={protocolStyle(protocol)}><ProtocolIcon protocol={protocol} size={14} /></span>
            {protocolLabel(locale, protocol)}
            {protocol === 'ssh' && <kbd>{keyLabel('newSession')}</kbd>}
          </button>
        ))}
      </Dropdown>
    </div>
  )
}

export function LanguagePill({ className = '' }: { className?: string }) {
  const model = useModel()
  const { t } = useI18n()
  const info = localeInfo(model.settings.locale)
  return (
    <Dropdown
      label={`${t('language')}: ${info.native}`}
      className={`tb-lang ${className}`}
      tip={`${t('language')}  ${keyLabel('language')}`}
      openOn={className.includes('tb-collapse') ? 'menu:language' : undefined}
      trigger={<><span dir="ltr">{info.id.toUpperCase()}</span><Caret /></>}
      align="end"
      wide
    >
      {(close) => <LanguageItems onPick={close} />}
    </Dropdown>
  )
}

function LanguageItems({ onPick }: { onPick: () => void }) {
  const model = useModel()
  const current = localeInfo(model.settings.locale).id
  return LOCALES.map((item) => (
    <button
      key={item.id}
      type="button"
      role="menuitemradio"
      aria-checked={item.id === current}
      lang={item.id}
      onClick={() => {
        onPick()
        void model.saveSettings({ ...model.settings, locale: item.id }, { quiet: true })
      }}
    >
      <span className="tb-code" dir="ltr">{item.id.toUpperCase()}</span>
      <span className="tb-native">{item.native}</span>
      <span className="tb-english">{item.english}</span>
    </button>
  ))
}

/** Only visible when the window is too narrow for the collapsible buttons. */
function MoreMenu() {
  const model = useModel()
  const { t } = useI18n()
  const [lang, setLang] = useState(false)
  return (
    <Dropdown label={t('more')} className="tb-btn icon tb-more" tip={t('more')} trigger={<Glyph d={DOTS} fill />} align="end" wide={lang} onClose={() => setLang(false)}>
      {(close) => lang ? (
        <LanguageItems onPick={close} />
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => { close(); model.openLocal() }}>
            <Glyph d={['M4 5h16v14H4z', 'M8 10l2.5 2L8 14', 'M13 14h3']} />{t('localTerminal')}<kbd>{keyLabel('localTerminal')}</kbd>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={model.multiExec} onClick={() => { close(); model.setMultiExec(!model.multiExec) }}>
            <Glyph d={['M4 7h10v10H4z', 'M8 4h12v10']} />{t('multiExec')}{model.multiExec && <span className="tb-on-dot" aria-hidden="true" />}
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={() => { close(); model.setDrawer('settings') }}>
            <Glyph d={GEAR} />{t('settings')}<kbd>{keyLabel('settings')}</kbd>
          </button>
          <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); setLang(true) }}>
            <Glyph d={['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z']} />
            {t('language')}<span className="tb-menu-value" dir="ltr">{localeInfo(model.settings.locale).id.toUpperCase()}</span>
          </button>
        </>
      )}
    </Dropdown>
  )
}

function AccountButton() {
  const model = useModel()
  const { t } = useI18n()
  const account = model.account
  if (!account) {
    return (
      <button type="button" className="tb-btn outline tip tip-end" data-tip={`${t('signIn')}  ${keyLabel('account')}`} onClick={() => model.setLogin(true)}>
        {t('signIn')}
      </button>
    )
  }
  const name = account.username || account.name
  const initials = (account.name || account.username || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  return (
    <Dropdown
      label={name}
      className="tb-avatar"
      tip={`${name}  ${keyLabel('account')}`}
      trigger={account.picture ? <img src={account.picture} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>}
      align="end"
    >
      {(close) => (
        <>
          <div className="tb-who">
            <strong>{account.name}</strong>
            {(account.email || account.phone) && <small dir="ltr">{account.email || account.phone}</small>}
          </div>
          <hr />
          <button type="button" role="menuitem" onClick={() => { close(); model.setLogin(true) }}>
            <Glyph d={['M12 8.8a3.2 3.2 0 1 1 0 .01z', 'M5.5 19.2c1.2-3 3.4-4.4 6.5-4.4s5.3 1.4 6.5 4.4']} />{t('tbAccount')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              close()
              void window.mys.auth.signOut().then(() => model.setAccount(null))
            }}
          ><Glyph d={['M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4', 'M14 12H21M18 9l3 3-3 3']} />{t('signOut')}</button>
        </>
      )}
    </Dropdown>
  )
}

/** Trigger + menu with outside-click, Escape and arrow-key handling. */
function Dropdown({ label, className, trigger, children, align, tip, wide, onClose, openOn }: {
  label: string
  className: string
  trigger: ReactNode
  children: (close: () => void) => ReactNode
  align: 'start' | 'end'
  tip?: string
  wide?: boolean
  onClose?: () => void
  /** Menu channel (keyboard shortcut) that opens this dropdown. */
  openOn?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => (openOn ? window.mys.onMenu(openOn, () => setOpen(true)) : undefined), [openOn])
  const close = (focus = true) => {
    setOpen(false)
    onClose?.()
    if (focus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false)
    }
    const onBlur = () => close(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
    }
  })

  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"], [role^="menuitem"]')?.focus()
  }, [open, children])

  const onKey = (event: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      close(false)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(at + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(at - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    }
  }

  const tipClass = tip || className.includes('tb-caret-btn') ? (align === 'end' ? ' tip tip-end' : ' tip') : ''
  return (
    <div className={`tb-drop${className.includes('tb-collapse') ? ' tb-collapse' : ''}${className.includes('tb-more') ? ' tb-more-wrap' : ''}`} ref={root} onKeyDown={open ? onKey : undefined}>
      <button
        ref={button}
        type="button"
        className={`${className.replace(/\btb-collapse\b/, '')}${open ? ' open' : ''}${tipClass}`}
        data-tip={tip ?? label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >{trigger}</button>
      {open && (
        <div ref={menu} className={`tb-menu ${align}${wide ? ' wide' : ''}`} role="menu" aria-label={label}>
          {children(() => close())}
        </div>
      )}
    </div>
  )
}

const GEAR = ['M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z']
const DOTS = ['M6 12h.01', 'M12 12h.01', 'M18 12h.01']

const LOCK = ['M6.5 10.5h11v9h-11z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5', 'M12 14.2v2']

/** Live clock (hours:minutes:seconds) in the app language's digits; the full date on hover. */
function Clock() {
  const { locale } = useI18n()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    // Tick on the second boundary so the seconds never lag or skip.
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    }
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    return () => window.clearTimeout(timer)
  }, [])
  const lang = localeInfo(locale).id
  const time = now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const date = now.toLocaleDateString(lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <time className="tb-clock tb-collapse" dateTime={now.toISOString()} title={date} aria-live="off">{time}</time>
  )
}

function Glyph({ d, fill = false }: { d: string[]; fill?: boolean }) {
  return (
    <svg className={fill ? 'tb-ico dots' : 'tb-ico'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {d.map((path) => <path key={path} d={path} />)}
    </svg>
  )
}

function Caret() {
  return <svg className="tb-caret" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" /></svg>
}
