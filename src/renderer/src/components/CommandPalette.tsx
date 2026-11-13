import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { protocolLabel } from '../../../shared/i18n'
import { parseQuickConnect, type Protocol } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { ProtocolIcon, protocolStyle } from '../protocols'
import { snippetCommand } from '../snippet-command'
import { SECRET_MASK } from '../snippets'
import { isTerminalProtocol } from './TerminalView'

interface Item {
  id: string
  group: 'connect' | 'hosts' | 'snippets' | 'actions'
  title: string
  detail?: string
  icon: ReactNode
  hint?: string
  run: () => void
}

const MAX_PER_GROUP = 8
const NEW_PROTOCOLS: Protocol[] = ['ssh', 'sftp', 'rdp', 'vnc', 'telnet', 'mosh', 'ftp', 's3', 'serial', 'docker', 'k8s']

/** ⌘K: one place to open hosts, run snippets and reach app actions. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const model = useModel()
  const { t, locale, dir } = useI18n()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(document.activeElement)
  const q = query.trim().toLowerCase()

  useEffect(() => () => {
    if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus()
  }, [])

  const items = useMemo(() => {
    const out: Item[] = []
    const has = (...fields: (string | undefined)[]) => !q || fields.some((field) => field?.toLowerCase().includes(q))
    const target = q ? parseQuickConnect(query) : null
    // A bare word is far more likely a search than a hostname; offer "connect" only for address-like input.
    const addressLike = /[@.:/]|^\w+\s+\S/.test(query.trim())
    const connect: Item | null = target && {
      id: 'connect',
      group: 'connect',
      title: t('paletteConnect', { target: query.trim() }),
      icon: <ProtocolIcon protocol={target.protocol} />,
      hint: '↵',
      run: () => model.openQuick(query),
    }
    const hosts = [...model.sessions]
      .filter((session) => has(session.name, session.host, session.username, session.protocol))
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, MAX_PER_GROUP)
    for (const session of hosts) {
      out.push({
        id: `host-${session.id}`,
        group: 'hosts',
        title: session.name || session.host,
        detail: `${session.username ? `${session.username}@` : ''}${session.host}${session.port ? `:${session.port}` : ''}`,
        icon: <span className="pal-proto" style={protocolStyle(session.protocol, session.color)}><ProtocolIcon protocol={session.protocol} icon={session.icon} size={14} /></span>,
        run: () => model.openSession(session),
      })
    }
    const snippets = model.macros.filter((macro) => has(macro.name, macro.command, ...(macro.tags ?? []))).slice(0, MAX_PER_GROUP)
    for (const macro of snippets) {
      out.push({
        id: `snippet-${macro.id}`,
        group: 'snippets',
        title: macro.name,
        detail: macro.secret ? SECRET_MASK : macro.command.split('\n')[0],
        icon: <Glyph d={['M10 5.2c-2 .35-2.8 1.55-2.8 3.05 0 1.75 1.25 2.35 1.25 3.75S7.2 14 7.2 15.75c0 1.5.8 2.7 2.8 3.05', 'M14 5.2c2 .35 2.8 1.55 2.8 3.05 0 1.75-1.25 2.35-1.25 3.75s1.25 1.95 1.25 3.7c0 1.5-.8 2.7-2.8 3.05']} />,
        hint: t('run'),
        run: () => void runSnippet(macro.id),
      })
    }
    const actions: Item[] = [
      { id: 'local', group: 'actions', title: t('localTerminal'), icon: <Glyph d={['M4 5h16v14H4z', 'M8 10l2.5 2L8 14', 'M13 14h3']} />, run: () => model.openLocal() },
      ...NEW_PROTOCOLS.map((protocol): Item => ({
        id: `new-${protocol}`,
        group: 'actions',
        title: t('paletteNew', { protocol: protocolLabel(locale, protocol) }),
        icon: <span className="pal-proto" style={protocolStyle(protocol)}><ProtocolIcon protocol={protocol} size={14} /></span>,
        run: () => model.openBlank(protocol),
      })),
      { id: 'multi', group: 'actions', title: t('multiExec'), detail: model.multiExec ? t('paletteOn') : undefined, icon: <Glyph d={['M4 7h10v10H4z', 'M8 4h12v10']} />, run: () => model.setMultiExec(!model.multiExec) },
      { id: 'sidebar', group: 'actions', title: t('sessions'), icon: <Glyph d={['M4 5h16v14H4z', 'M9.5 5v14']} />, run: () => model.setSidebar(!model.sidebar) },
      { id: 'settings', group: 'actions', title: t('settings'), icon: <Glyph d={['M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z', 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4']} />, run: () => model.setDrawer('settings') },
    ]
    out.push(...actions.filter((item) => has(item.title)).slice(0, q ? MAX_PER_GROUP : 4))
    if (connect && (addressLike || !out.length)) out.unshift(connect)
    return out
    // runSnippet only reads model at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, model.sessions, model.macros, model.multiExec, model.sidebar, locale, t])

  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  async function runSnippet(id: string) {
    const macro = model.macros.find((item) => item.id === id)
    const tab = model.activeTab()
    if (!macro) return
    if (!tab || !isTerminalProtocol(tab.protocol)) {
      model.toast(t('pickTerminal'), 'err')
      return
    }
    const command = await snippetCommand(macro)
    if (!command) return
    const data = macro.sendEnter ? `${command}\n` : command
    window.mys.write(tab.instanceId, data)
    if (model.multiExec) model.broadcast(data, tab.instanceId)
    window.dispatchEvent(new CustomEvent('mys-focus', { detail: tab.instanceId }))
    void model.saveMacros(model.macros.map((item) => item.id === id ? { ...item, uses: (item.uses || 0) + 1, lastRun: Date.now() } : item))
  }

  const choose = (item: Item | undefined) => {
    if (!item) return
    returnFocus.current = null
    onClose()
    item.run()
  }

  const groups: { id: Item['group']; label: string }[] = [
    { id: 'connect', label: t('connect') },
    { id: 'hosts', label: t('paletteHosts') },
    { id: 'snippets', label: t('snippets') },
    { id: 'actions', label: t('paletteActions') },
  ]

  return createPortal(
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal" role="dialog" aria-modal="true" aria-label={t('tbSearch')} dir={dir} onMouseDown={(event) => event.stopPropagation()}>
        <div className="pal-input">
          <Glyph d={['M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12z', 'M16 16l4 4']} />
          <input
            autoFocus
            value={query}
            placeholder={t('tbSearch')}
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={items[index] ? `pal-${items[index].id}` : undefined}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); onClose() }
              else if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(items.length - 1, value + 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)) }
              else if (event.key === 'Enter') { event.preventDefault(); choose(items[index]) }
              else if (event.key === 'Tab') event.preventDefault()
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          {items.length === 0 && <p className="pal-empty">{t('paletteEmpty')}</p>}
          {groups.map((group) => {
            const rows = items.filter((item) => item.group === group.id)
            if (!rows.length) return null
            return (
              <div key={group.id} role="group" aria-label={group.label}>
                <div className="pal-group" aria-hidden="true">{group.label}</div>
                {rows.map((item) => {
                  const at = items.indexOf(item)
                  return (
                    <div
                      key={item.id}
                      id={`pal-${item.id}`}
                      role="option"
                      aria-selected={at === index}
                      className="pal-row"
                      onMouseMove={() => { if (at !== index) setIndex(at) }}
                      onClick={() => choose(item)}
                    >
                      <span className="pal-ico">{item.icon}</span>
                      <span className="pal-title">{item.title}</span>
                      {item.detail && <span className="pal-detail" dir="ltr">{item.detail}</span>}
                      {at === index && <kbd className="pal-hint">{item.hint ?? '↵'}</kbd>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        <footer className="pal-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('paletteMove')}</span>
          <span><kbd>↵</kbd> {t('paletteOpen')}</span>
          <span><kbd>esc</kbd> {t('close')}</span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function Glyph({ d }: { d: string[] }) {
  return (
    <svg className="tb-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {d.map((path) => <path key={path} d={path} />)}
    </svg>
  )
}
