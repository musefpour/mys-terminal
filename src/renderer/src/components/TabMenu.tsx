import { useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { bulkCloseIds, type Leaf, type Tab } from '../layout'
import { useI18n } from '../i18n'
import { keyLabel } from '../keys'
import { useModel } from '../model'
import { terminalText } from '../term-registry'
import { isTerminalProtocol } from '../terminal-protocols'
import { MenuItem, MenuSep, PopupMenu } from './PopupMenu'

export const TAB_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#d6409f']

/** Right-click menu of a tab: naming, closing, window placement and terminal output. */
export function TabMenu({ leaf, tab, x, y, onClose }: { leaf: Leaf; tab: Tab; x: number; y: number; onClose: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const [mode, setMode] = useState<'menu' | 'rename' | 'color'>('menu')
  const [name, setName] = useState(tab.title)
  const terminal = isTerminalProtocol(tab.protocol)
  const session = tab.spec.sessionId ? model.sessions.find((item) => item.id === tab.spec.sessionId) : undefined
  const count = (which: 'before' | 'after' | 'others' | 'all') => bulkCloseIds(leaf, tab.instanceId, which).length
  const run = (fn: () => unknown) => () => {
    onClose()
    void fn()
  }

  const rename = (event: FormEvent) => {
    event.preventDefault()
    const next = name.trim()
    if (next && next !== tab.title) model.patchTab(tab.instanceId, { title: next })
    onClose()
  }

  const fullscreen = () => {
    onClose()
    // Show the tab first, synchronously, so the request still counts as part of this click.
    flushSync(() => model.activateTab(leaf.id, tab.instanceId))
    const slot = document.querySelector<HTMLElement>(`[data-tab-slot="${tab.instanceId}"]`)
    if (!slot) return
    if (document.fullscreenElement === slot) void document.exitFullscreen()
    else void slot.requestFullscreen().catch(() => undefined)
  }

  const saveOutput = async () => {
    const path = await window.mys.tabs.saveOutput(tab.title || 'terminal', `${terminalText(tab.instanceId)}\n`)
    if (path) model.toast(t('outputSaved'))
  }

  if (mode === 'rename') {
    return (
      <PopupMenu x={x} y={y} onClose={onClose} className="tab-menu">
        <form className="row-rename" onSubmit={rename}>
          <input dir="auto" autoFocus value={name} placeholder={t('tabRename')} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
          <button type="submit" className="primary">{t('save')}</button>
        </form>
      </PopupMenu>
    )
  }

  if (mode === 'color') {
    return (
      <PopupMenu x={x} y={y} onClose={onClose} className="tab-menu">
        <div className="tab-swatches" role="group" aria-label={t('tabColor')}>
          {TAB_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={tab.color === color ? 'swatch on' : 'swatch'}
              style={{ background: color }}
              aria-label={color}
              aria-pressed={tab.color === color}
              onClick={() => { model.patchTab(tab.instanceId, { color }); onClose() }}
            />
          ))}
        </div>
        <MenuSep />
        <MenuItem icon={<Icon d="M3 13 13 3M5.5 2.5h5a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />} label={t('tabColorNone')} disabled={!tab.color} onClick={() => { model.patchTab(tab.instanceId, { color: undefined }); onClose() }} />
      </PopupMenu>
    )
  }

  return (
    <PopupMenu x={x} y={y} onClose={onClose} className="tab-menu">
      <MenuItem icon={<Icon d="M3 13h3l7-7-3-3-7 7zM9 4l3 3" />} label={t('tabRename')} onClick={() => setMode('rename')} />
      <MenuItem
        icon={<span className="menu-dot" style={tab.color ? { background: tab.color } : undefined} />}
        label={t('tabColor')}
        onClick={() => setMode('color')}
      />
      <MenuItem icon={<Icon d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />} label={t('tabDuplicate')} onClick={run(() => model.duplicateTab(tab.instanceId))} />
      <MenuItem icon={<Icon d="M4 4l8 8M12 4l-8 8" />} label={t('tabClose')} hint={keyLabel('closeTab')} onClick={run(() => model.closeTabById(leaf.id, tab.instanceId))} />
      <MenuSep />
      <MenuItem icon={<Icon d="M13 8H3M7 4 3 8l4 4" />} label={t('tabCloseBefore')} disabled={!count('before')} onClick={run(() => model.closeTabs(leaf.id, tab.instanceId, 'before'))} />
      <MenuItem icon={<Icon d="M3 8h10M9 4l4 4-4 4" />} label={t('tabCloseAfter')} disabled={!count('after')} onClick={run(() => model.closeTabs(leaf.id, tab.instanceId, 'after'))} />
      <MenuItem icon={<Icon d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM5 8h6" />} label={t('tabCloseOthers')} disabled={!count('others')} onClick={run(() => model.closeTabs(leaf.id, tab.instanceId, 'others'))} />
      <MenuItem icon={<Icon d="M8 2.5v5M4.6 4.6a5 5 0 1 0 6.8 0" />} label={t('tabCloseAll')} danger disabled={!count('all')} onClick={run(() => model.closeTabs(leaf.id, tab.instanceId, 'all'))} />
      <MenuSep />
      {terminal && !model.detached && (
        <MenuItem icon={<Icon d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3h-8v-8h3" />} label={t('tabDetach')} onClick={run(() => model.detachTab(leaf.id, tab.instanceId))} />
      )}
      <MenuItem icon={<Icon d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />} label={t('tabFullscreen')} onClick={fullscreen} />
      <MenuItem
        icon={<Icon d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" />}
        label={tab.pinned ? t('tabUnpin') : t('tabPin')}
        onClick={run(() => model.togglePin(tab.instanceId))}
      />
      {terminal && (
        <>
          <MenuSep />
          <MenuItem icon={<Icon d="M3 2.5h8l2 2v9H3zM5.5 2.5v3.5h5V2.5M5 13.5v-4h6v4" />} label={t('tabSaveOutput')} onClick={run(saveOutput)} />
          <MenuItem
            icon={<Icon d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z" />}
            label={t('tabPrintOutput')}
            onClick={run(() => window.mys.tabs.print(tab.title, terminalText(tab.instanceId)))}
          />
          <MenuItem icon={<Icon d="M7 7a4 4 0 1 0 0 .01M10 10l3.5 3.5M7 5v4M5 7h4" />} label={t('fontBigger')} hint={keyLabel('fontBigger')} onClick={() => model.changeFontSize(1, tab.instanceId)} />
          <MenuItem icon={<Icon d="M7 7a4 4 0 1 0 0 .01M10 10l3.5 3.5M5 7h4" />} label={t('fontSmaller')} hint={keyLabel('fontSmaller')} onClick={() => model.changeFontSize(-1, tab.instanceId)} />
        </>
      )}
      {session && (
        <>
          <MenuSep />
          <MenuItem icon={<Icon d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />} label={t('tabEditSession')} onClick={run(() => model.editSession(session))} />
        </>
      )}
    </PopupMenu>
  )
}

function Icon({ d }: { d: string }): ReactNode {
  return <svg viewBox="0 0 16 16"><path d={d} /></svg>
}
