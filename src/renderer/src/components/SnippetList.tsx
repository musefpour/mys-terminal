import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Macro, MacroPackage } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { snippetCommand } from '../snippet-command'
import { matchesSnippet, moveSnippet, orderSnippets, SECRET_MASK, snippetTags, tokenizeShell } from '../snippets'
import { isTerminalProtocol } from './TerminalView'
import '../snippets.css'

const MAC = typeof window !== 'undefined' && window.mys?.platform === 'darwin'
export const KEY_ALT = MAC ? '⌥' : 'Alt+'
const REVEAL_MS = 15_000
const FLASH_MS = 1600
const COLLAPSED_KEY = 'mys.scripts.collapsed'

type Editing = { id?: string } | null
type Flash = { id: string; kind: 'run' | 'paste' }

/** The Snippets tab of the terminal side panel. */
export function ScriptsTab() {
  const model = useModel()
  const { t, dir } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [flash, setFlash] = useState<Flash | null>(null)
  const [announce, setAnnounce] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]') as string[]) } catch { return new Set() }
  })

  const tags = useMemo(() => snippetTags(model.macros), [model.macros])
  const visible = useMemo(() => orderSnippets(model.macros).filter((item) => matchesSnippet(item, query, tag)), [model.macros, query, tag])
  useEffect(() => { if (tag && !tags.includes(tag)) setTag(null) }, [tag, tags])

  // Folders reuse the snippet packages, so they match the Snippets panel in the sidebar.
  const folders = model.packages
  const known = new Set(folders.map((item) => item.id))
  const folderOf = (macro: Macro) => (macro.packageId && known.has(macro.packageId) ? macro.packageId : '')
  const filtering = Boolean(query.trim() || tag)
  const isOpen = (id: string) => filtering || !collapsed.has(id)
  const groups = [...folders.map((item) => ({ id: item.id, name: item.name })), { id: '', name: t('noFolder') }]
    .map((group) => ({ ...group, items: visible.filter((macro) => folderOf(macro) === group.id) }))
    .filter((group) => (group.id ? !filtering || group.items.length > 0 : group.items.length > 0))
  /** Cards in on-screen order (collapsed folders skipped): keyboard navigation follows this. */
  const ordered = groups.flatMap((group) => (isOpen(group.id) ? group.items : []))

  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      return next
    })
  }

  // "/" focuses the filter while focus is anywhere in this side panel (never steals keys from the terminal).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== '/' && event.key.toLowerCase() !== 'n') || event.metaKey || event.ctrlKey || event.altKey) return
      const panel = rootRef.current?.closest('aside')
      const target = event.target as HTMLElement | null
      if (!panel || !target || !panel.contains(target)) return
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.key === '/') searchRef.current?.focus()
      else setEditing({})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Revealed secrets hide themselves again; nothing stays in plain text for long.
  useEffect(() => {
    const ids = Object.keys(revealed)
    if (!ids.length) return
    const timer = window.setTimeout(() => setRevealed({}), REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [revealed])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  const send = async (macro: Macro, enter: boolean) => {
    const tab = model.activeTab()
    if (!tab || !isTerminalProtocol(tab.protocol)) {
      model.toast(t('pickTerminal'), 'err')
      return
    }
    const command = await snippetCommand(macro)
    if (!command) {
      model.toast(t('snippetSecretMissing'), 'err')
      return
    }
    const data = enter ? `${command}\n` : command
    window.mys.write(tab.instanceId, data)
    if (model.multiExec) model.broadcast(data, tab.instanceId)
    window.dispatchEvent(new CustomEvent('mys-focus', { detail: tab.instanceId }))
    const kind = enter ? 'run' : 'paste'
    setFlash({ id: macro.id, kind })
    setAnnounce(t(kind === 'run' ? 'snippetSent' : 'snippetPasted'))
    void model.saveMacros(model.macros.map((item) => item.id === macro.id ? { ...item, uses: (item.uses || 0) + 1, lastRun: Date.now() } : item))
  }

  const save = async (next: Macro[]) => {
    try {
      await model.saveMacros(next)
      return true
    } catch (error) {
      model.toast(t('snippetSaveFailed', { message: error instanceof Error ? error.message : String(error) }), 'err')
      return false
    }
  }

  const toggleReveal = async (macro: Macro) => {
    if (revealed[macro.id] !== undefined) {
      setRevealed(({ [macro.id]: _gone, ...rest }) => rest)
      return
    }
    const command = await snippetCommand(macro)
    setRevealed((map) => ({ ...map, [macro.id]: command }))
  }

  const moveTo = async (macro: Macro, folderId: string) => {
    setMenu(null)
    if (folderOf(macro) === folderId) return
    await save(model.macros.map((item) => item.id === macro.id ? { ...item, packageId: folderId || null } : item))
    if (folderId && collapsed.has(folderId)) toggleFolder(folderId)
  }

  const createFolder = async () => {
    const folder: MacroPackage = { id: crypto.randomUUID(), name: t('newFolder') }
    await model.savePackages([...model.packages, folder])
    setRenaming(folder.id)
  }

  const renameFolder = async (id: string, name: string) => {
    setRenaming(null)
    const next = name.trim()
    if (!next) return
    await model.savePackages(model.packages.map((item) => item.id === id ? { ...item, name: next.slice(0, 60) } : item))
  }

  const deleteFolder = async (folder: MacroPackage) => {
    setFolderMenu(null)
    if (!await model.ask(t('scriptFolderDeleteConfirm', { name: folder.name }))) return
    await model.savePackages(model.packages.filter((item) => item.id !== folder.id))
    await save(model.macros.map((item) => item.packageId === folder.id ? { ...item, packageId: null } : item))
  }

  const act = async (action: 'edit' | 'duplicate' | 'copy' | 'pin' | 'delete', macro: Macro) => {
    setMenu(null)
    if (action === 'edit') setEditing({ id: macro.id })
    if (action === 'copy') {
      await navigator.clipboard.writeText(await snippetCommand(macro))
      model.toast(t('copied'))
    }
    if (action === 'pin') await save(model.macros.map((item) => item.id === macro.id ? { ...item, pinned: !item.pinned } : item))
    if (action === 'duplicate') {
      const copy: Macro = { ...macro, id: crypto.randomUUID(), name: `${macro.name} (${t('copy')})`.slice(0, 80), command: await snippetCommand(macro), uses: 0, lastRun: 0, pinned: false }
      const at = model.macros.findIndex((item) => item.id === macro.id)
      await save([...model.macros.slice(0, at + 1), copy, ...model.macros.slice(at + 1)])
    }
    if (action === 'delete' && await model.ask(t('snippetDeleteConfirm', { name: macro.name }))) {
      await save(model.macros.filter((item) => item.id !== macro.id))
    }
  }

  const focusCard = (index: number) => {
    const cards = listRef.current?.querySelectorAll<HTMLElement>('li[data-id]')
    if (!cards?.length) return
    cards[Math.max(0, Math.min(cards.length - 1, index))].focus()
  }

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('li[data-id]')
    if (!card || card !== event.target) return
    const index = ordered.findIndex((item) => item.id === card.dataset.id)
    const macro = ordered[index]
    if (!macro) return
    if (event.key === 'ArrowDown') focusCard(index + 1)
    else if (event.key === 'ArrowUp') index === 0 ? searchRef.current?.focus() : focusCard(index - 1)
    else if (event.key === 'Home') focusCard(0)
    else if (event.key === 'End') focusCard(ordered.length - 1)
    else if (event.key === 'Enter') void send(macro, !event.shiftKey)
    else if (event.key === 'Delete' || (MAC && event.key === 'Backspace' && event.metaKey)) void act('delete', macro)
    else if (event.key === 'F2') setEditing({ id: macro.id })
    else return
    event.preventDefault()
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, target: Macro) => {
    event.preventDefault()
    if (!drag) return
    const at = model.macros.findIndex((item) => item.id === target.id)
    const beforeId = drag.after ? model.macros[at + 1]?.id ?? null : target.id
    setDrag(null)
    const folderId = folderOf(target) || null
    const moved = beforeId === drag.id ? model.macros : moveSnippet(model.macros, drag.id, beforeId)
    void save(moved.map((item) => item.id === drag.id ? { ...item, packageId: folderId } : item))
  }

  const onFolderDrop = (event: DragEvent<HTMLElement>, folderId: string) => {
    event.preventDefault()
    setDropFolder(null)
    if (!drag) return
    const id = drag.id
    setDrag(null)
    void save(moveSnippet(model.macros, id, null).map((item) => item.id === id ? { ...item, packageId: folderId || null } : item))
    if (folderId && collapsed.has(folderId)) toggleFolder(folderId)
  }

  if (editing) {
    const macro = editing.id ? model.macros.find((item) => item.id === editing.id) : undefined
    return (
      <div className="snp" ref={rootRef}>
        <SnippetEditor
          macro={macro}
          tags={tags}
          folders={folders}
          onCancel={() => setEditing(null)}
          onSave={async (next) => {
            const list = macro ? model.macros.map((item) => item.id === next.id ? next : item) : [...model.macros, next]
            if (await save(list)) setEditing(null)
          }}
        />
      </div>
    )
  }

  const menuMacro = menu ? model.macros.find((item) => item.id === menu.id) : undefined

  return (
    <div className="snp" ref={rootRef}>
      <header className="snp-head">
        <h2>
          {t('snippets')}
          <span className="snp-count" aria-label={t('snippetCount', { n: model.macros.length })}>{model.macros.length}</span>
        </h2>
        <span className="snp-head-actions">
          <button type="button" className="snc-btn tip tip-end" data-tip={t('newFolder')} aria-label={t('newFolder')} onClick={() => void createFolder()}>
            <FolderPlusIcon />
          </button>
          <button type="button" className="snp-new tip tip-end" data-tip={`${t('newSnippet')}  N`} aria-keyshortcuts="N" onClick={() => setEditing({})}>
            <PlusIcon /> {t('snippetNew')}
          </button>
        </span>
      </header>

      {model.macros.length > 0 && (
        <div className="snp-tools">
          <label className="snp-search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={t('snippetFilter')}
              aria-label={t('snippetFilter')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault()
                  setQuery('')
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  focusCard(0)
                } else if (event.key === 'Enter' && ordered[0]) {
                  event.preventDefault()
                  void send(ordered[0], !event.shiftKey)
                }
              }}
            />
            {!query && <kbd className="snp-kbd" aria-hidden="true">/</kbd>}
          </label>
          {tags.length > 0 && (
            <div className="snp-chips" role="group" aria-label={t('snippetTags')}>
              <button type="button" className="snp-chip" aria-pressed={!tag} onClick={() => setTag(null)}>{t('snippetAll')}</button>
              {tags.map((item) => (
                <button key={item} type="button" className="snp-chip" aria-pressed={tag === item} onClick={() => setTag(tag === item ? null : item)}>{item}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="snp-scroll">
        {model.macros.length === 0 && folders.length === 0 ? (
          <div className="snp-empty">
            <EmptyArt />
            <strong>{t('snippetEmptyTitle')}</strong>
            <p>{t('snippetEmptyHint')}</p>
            <button type="button" className="snp-new big" onClick={() => setEditing({})}><PlusIcon /> {t('snippetCreateFirst')}</button>
          </div>
        ) : filtering && visible.length === 0 ? (
          <p className="snp-nomatch">{t('snippetNoMatch', { q: query || tag || '' })}</p>
        ) : (
          <div className="snp-groups" ref={listRef} onKeyDown={onListKey}>
            {groups.map((group) => {
              const open = isOpen(group.id)
              const folder = folders.find((item) => item.id === group.id)
              const showHeader = folders.length > 0
              return (
                <section key={group.id || 'none'} className="snp-group" aria-label={group.name}>
                  {showHeader && (
                    <div
                      className={dropFolder === group.id ? 'snp-folder drop' : 'snp-folder'}
                      onDragOver={(event) => {
                        if (!drag) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        if (dropFolder !== group.id) setDropFolder(group.id)
                      }}
                      onDragLeave={() => setDropFolder(null)}
                      onDrop={(event) => onFolderDrop(event, group.id)}
                    >
                      {renaming === group.id && folder ? (
                        <form
                          className="snp-folder-rename"
                          onSubmit={(event) => {
                            event.preventDefault()
                            void renameFolder(folder.id, new FormData(event.currentTarget).get('name') as string)
                          }}
                        >
                          <FolderIcon />
                          <input
                            name="name"
                            defaultValue={folder.name}
                            aria-label={t('folderName')}
                            autoFocus
                            onFocus={(event) => event.currentTarget.select()}
                            onBlur={(event) => void renameFolder(folder.id, event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                event.stopPropagation()
                                setRenaming(null)
                              }
                            }}
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="snp-folder-toggle"
                          aria-expanded={open}
                          disabled={filtering}
                          onClick={() => toggleFolder(group.id)}
                          onDoubleClick={() => folder && setRenaming(folder.id)}
                        >
                          <CaretIcon open={open} />
                          {folder ? <FolderIcon /> : <InboxIcon />}
                          <span className="snp-folder-name" title={group.name}>{group.name}</span>
                          <span className="snp-count">{group.items.length}</span>
                        </button>
                      )}
                      {folder && renaming !== folder.id && (
                        <button
                          type="button"
                          className="snc-btn snp-folder-more"
                          aria-label={t('more')}
                          aria-haspopup="menu"
                          onClick={(event) => {
                            const box = event.currentTarget.getBoundingClientRect()
                            setFolderMenu(folderMenu?.id === folder.id ? null : { id: folder.id, x: dir === 'rtl' ? box.left : box.right, y: box.bottom + 4 })
                          }}
                        ><DotsIcon /></button>
                      )}
                    </div>
                  )}
                  {open && group.items.length > 0 && (
                    <ul className="snp-list" aria-label={group.name}>
                      {group.items.map((macro) => (
                        <SnippetCard
                          key={macro.id}
                          macro={macro}
                          revealed={revealed[macro.id]}
                          flash={flash?.id === macro.id ? flash.kind : null}
                          menuOpen={menu?.id === macro.id}
                          dropEdge={drag?.over === macro.id && drag.id !== macro.id ? (drag.after ? 'after' : 'before') : null}
                          dragging={drag?.id === macro.id}
                          onRun={() => void send(macro, true)}
                          onPaste={() => void send(macro, false)}
                          onReveal={() => void toggleReveal(macro)}
                          onMenu={(x, y) => setMenu(menu?.id === macro.id ? null : { id: macro.id, x, y })}
                          onDragStart={() => setDrag({ id: macro.id, over: null, after: false })}
                          onDragEnd={() => { setDrag(null); setDropFolder(null) }}
                          onDragOver={(event) => {
                            if (!drag) return
                            event.preventDefault()
                            event.stopPropagation()
                            event.dataTransfer.dropEffect = 'move'
                            const box = event.currentTarget.getBoundingClientRect()
                            const after = event.clientY > box.top + box.height / 2
                            if (dropFolder) setDropFolder(null)
                            if (drag.over !== macro.id || drag.after !== after) setDrag({ ...drag, over: macro.id, after })
                          }}
                          onDrop={(event) => onDrop(event, macro)}
                        />
                      ))}
                    </ul>
                  )}
                  {open && group.items.length === 0 && group.id && <p className="snp-folder-empty">{t('scriptFolderEmpty')}</p>}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <div className="snp-sr" role="status" aria-live="polite">{announce}</div>

      {menu && menuMacro && (
        <CardMenu
          x={menu.x}
          y={menu.y}
          macro={menuMacro}
          folders={folders}
          folderId={folderOf(menuMacro)}
          onClose={() => setMenu(null)}
          onAct={(action) => void act(action, menuMacro)}
          onMove={(folderId) => void moveTo(menuMacro, folderId)}
        />
      )}
      {folderMenu && folders.some((item) => item.id === folderMenu.id) && (
        <Popup x={folderMenu.x} y={folderMenu.y} onClose={() => setFolderMenu(null)}>
          <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); setRenaming(folderMenu.id) }}><EditIcon /> {t('rename')}</button>
          <hr />
          <button type="button" role="menuitem" className="danger" onClick={() => void deleteFolder(folders.find((item) => item.id === folderMenu.id)!)}><TrashIcon /> {t('delete')}</button>
        </Popup>
      )}
    </div>
  )
}

function SnippetCard({
  macro, revealed, flash, menuOpen, dropEdge, dragging,
  onRun, onPaste, onReveal, onMenu, onDragStart, onDragEnd, onDragOver, onDrop,
}: {
  macro: Macro
  revealed?: string
  flash: 'run' | 'paste' | null
  menuOpen: boolean
  dropEdge: 'before' | 'after' | null
  dragging: boolean
  onRun: () => void
  onPaste: () => void
  onReveal: () => void
  onMenu: (x: number, y: number) => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLLIElement>) => void
  onDrop: (event: DragEvent<HTMLLIElement>) => void
}) {
  const model = useModel()
  const { t, locale, dir } = useI18n()
  const cardRef = useRef<HTMLLIElement>(null)
  const codeRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const masked = macro.secret && revealed === undefined
  const text = macro.secret ? revealed ?? '' : macro.command

  useLayoutEffect(() => {
    const node = codeRef.current
    if (!node) return
    const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1 || (expanded && node.scrollHeight > 3 * 18 + 16))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [text, masked, expanded])

  const targets = (macro.targetIds ?? []).map((id) => model.sessions.find((item) => item.id === id)).filter(Boolean)
  const firstTarget = targets[0]
  const meta: string[] = []
  if (macro.uses) meta.push(t('snippetUses', { n: macro.uses }))
  if (macro.lastRun) meta.push(relativeTime(macro.lastRun, locale))
  const showMeta = Boolean(firstTarget || meta.length || macro.tags?.length)

  const classes = ['snc']
  if (menuOpen) classes.push('menu-open')
  if (dragging) classes.push('dragging')
  if (dropEdge) classes.push(`drop-${dropEdge}`)
  if (flash) classes.push('flashing')

  return (
    <li
      ref={cardRef}
      className={classes.join(' ')}
      data-id={macro.id}
      tabIndex={0}
      aria-label={macro.name}
      aria-describedby={`snc-hint-${macro.id}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, .snc-code')) return
        onRun()
      }}
    >
      <div className="snc-head">
        <span
          className="snc-grip tip"
          data-tip={t('snippetDrag')}
          draggable
          aria-hidden="true"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', macro.id)
            if (cardRef.current) event.dataTransfer.setDragImage(cardRef.current, dir === 'rtl' ? cardRef.current.offsetWidth - 16 : 16, 16)
            onDragStart()
          }}
          onDragEnd={onDragEnd}
        ><GripIcon /></span>
        <span className={macro.secret ? 'snc-ico secret' : 'snc-ico'} aria-hidden="true">{macro.secret ? <LockIcon /> : <BraceIcon />}</span>
        <strong className="snc-name" title={macro.name}>{macro.name}</strong>
        {macro.pinned && <span className="snc-pin" title={t('snippetPinned')}><PinIcon /></span>}
        <div className="snc-actions">
          {macro.secret && (
            <button
              type="button"
              className="snc-btn tip tip-end"
              data-tip={masked ? t('snippetReveal') : t('snippetHide')}
              aria-label={masked ? t('snippetReveal') : t('snippetHide')}
              aria-pressed={!masked}
              onClick={onReveal}
            >{masked ? <EyeIcon /> : <EyeOffIcon />}</button>
          )}
          <button
            type="button"
            className="snc-btn tip tip-end"
            data-tip={`${t('paste')}  ⇧↵`}
            aria-label={t('paste')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPaste}
          ><PasteIcon /></button>
          <button
            type="button"
            className="snc-btn run tip tip-end"
            data-tip={`${t('run')}  ↵`}
            aria-label={t('run')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRun}
          ><PlayIcon /></button>
          <button
            type="button"
            className="snc-btn tip tip-end"
            data-tip={t('more')}
            aria-label={t('more')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              onMenu(dir === 'rtl' ? box.left : box.right, box.bottom + 4)
            }}
          ><DotsIcon /></button>
        </div>
      </div>

      <div
        ref={codeRef}
        className={expanded ? 'snc-code open' : overflows ? 'snc-code clipped' : 'snc-code'}
        dir="ltr"
        role={overflows || expanded ? 'button' : undefined}
        tabIndex={overflows || expanded ? -1 : undefined}
        aria-expanded={overflows || expanded ? expanded : undefined}
        aria-label={overflows || expanded ? t(expanded ? 'snippetCollapse' : 'snippetExpand') : undefined}
        title={overflows || expanded ? t(expanded ? 'snippetCollapse' : 'snippetExpand') : undefined}
        onClick={() => { if (overflows || expanded) setExpanded((value) => !value) }}
      >
        <span className="snc-prompt" aria-hidden="true">$</span>
        <code>
          {masked
            ? <span className="tk-mask" aria-label={t('snippetSecret')}>{SECRET_MASK}</span>
            : tokenizeShell(text).map((token, index) => <span key={index} className={`tk-${token.kind}`}>{token.text}</span>)}
        </code>
      </div>

      {showMeta && (
        <div className="snc-meta">
          {firstTarget && (
            <span className="snc-host" dir="ltr" title={targets.map((item) => item!.name || item!.host).join(', ')}>
              <HostIcon />{firstTarget.name || firstTarget.host}{targets.length > 1 ? ` +${targets.length - 1}` : ''}
            </span>
          )}
          {macro.tags?.map((item) => <span key={item} className="snc-tag">{item}</span>)}
          {meta.length > 0 && <span className="snc-stats">{meta.join(' · ')}</span>}
        </div>
      )}

      <span id={`snc-hint-${macro.id}`} className="snp-sr">{t('snippetKeysHint')}</span>
      {flash && (
        <span className="snc-flash" aria-hidden="true">
          <CheckIcon /> {t(flash === 'run' ? 'snippetSent' : 'snippetPasted')}
        </span>
      )}
    </li>
  )
}

function CardMenu({ x, y, macro, folders, folderId, onClose, onAct, onMove }: {
  x: number
  y: number
  macro: Macro
  folders: MacroPackage[]
  folderId: string
  onClose: () => void
  onAct: (action: 'edit' | 'duplicate' | 'copy' | 'pin' | 'delete') => void
  onMove: (folderId: string) => void
}) {
  const { t } = useI18n()
  return (
    <Popup x={x} y={y} onClose={onClose} returnFocus={`li[data-id="${CSS.escape(macro.id)}"]`}>
      <button type="button" role="menuitem" onClick={() => onAct('edit')}><EditIcon /> {t('edit')}<kbd>F2</kbd></button>
      <button type="button" role="menuitem" onClick={() => onAct('duplicate')}><DuplicateIcon /> {t('duplicate')}</button>
      <button type="button" role="menuitem" onClick={() => onAct('copy')}><CopyIcon /> {t('snippetCopy')}</button>
      <button type="button" role="menuitem" onClick={() => onAct('pin')}><PinIcon /> {macro.pinned ? t('snippetUnpin') : t('snippetPin')}</button>
      {folders.length > 0 && (
        <>
          <hr />
          <p className="snp-menu-label">{t('moveToFolder')}</p>
          {[...folders, { id: '', name: t('noFolder') }].map((folder) => (
            <button
              key={folder.id || 'none'}
              type="button"
              role="menuitemradio"
              aria-checked={folder.id === folderId}
              disabled={folder.id === folderId}
              onClick={() => onMove(folder.id)}
            >
              {folder.id ? <FolderIcon /> : <InboxIcon />} <span className="snp-menu-text">{folder.name}</span>
              {folder.id === folderId && <CheckIcon />}
            </button>
          ))}
        </>
      )}
      <hr />
      <button type="button" role="menuitem" className="danger" onClick={() => onAct('delete')}><TrashIcon /> {t('delete')}<kbd>{MAC ? '⌘⌫' : 'Del'}</kbd></button>
    </Popup>
  )
}

/** Anchored popup menu: arrow keys move, Escape/Tab close, outside click closes. */
function Popup({ x, y, onClose, returnFocus, children }: {
  x: number
  y: number
  onClose: () => void
  returnFocus?: string
  children: React.ReactNode
}) {
  const { dir } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    const left = dir === 'rtl' ? x : x - width
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - width - 8, left)),
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height - 40) : y,
    })
    node.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [x, y, dir])

  useEffect(() => {
    const close = () => onClose()
    document.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const onKey = (event: ReactKeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose()
      if (returnFocus) document.querySelector<HTMLElement>(returnFocus)?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(at + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(at - 1 + items.length) % items.length]?.focus()
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="snp-menu"
      role="menu"
      dir={dir}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={onKey}
    >
      {children}
    </div>,
    document.body,
  )
}

function SnippetEditor({ macro, tags, folders, onCancel, onSave }: {
  macro?: Macro
  tags: string[]
  folders: MacroPackage[]
  onCancel: () => void
  onSave: (next: Macro) => Promise<void>
}) {
  const { t } = useI18n()
  const [name, setName] = useState(macro?.name || '')
  const [command, setCommand] = useState(macro?.secret ? '' : macro?.command || '')
  const [tagText, setTagText] = useState((macro?.tags ?? []).join(', '))
  const [folderId, setFolderId] = useState(macro?.packageId && folders.some((item) => item.id === macro.packageId) ? macro.packageId : '')
  const [sendEnter, setSendEnter] = useState(macro?.sendEnter !== false)
  const [secret, setSecret] = useState(Boolean(macro?.secret))
  const [show, setShow] = useState(!macro?.secret)
  const [loading, setLoading] = useState(Boolean(macro?.secret))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!macro?.secret) return
    let live = true
    void snippetCommand(macro).then((value) => {
      if (!live) return
      setCommand(value)
      setLoading(false)
    })
    return () => { live = false }
  }, [macro])

  const submit = async () => {
    if (!command.trim()) {
      setError(t('scriptRequired'))
      return
    }
    setBusy(true)
    const parsedTags = [...new Set(tagText.split(/[,\n]/).map((item) => item.trim().replace(/^#/, '')).filter(Boolean))]
    await onSave({
      ...macro,
      id: macro?.id || crypto.randomUUID(),
      name: name.trim() || command.trim().split('\n')[0].slice(0, 40),
      command,
      sendEnter,
      secret,
      tags: parsedTags,
      packageId: folderId || null,
      targetIds: macro?.targetIds ?? [],
    })
    setBusy(false)
  }

  const suggestions = tags.filter((item) => !tagText.split(',').map((part) => part.trim()).includes(item)).slice(0, 6)

  return (
    <form
      className="snp-edit"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <header className="snp-head">
        <h2>{macro ? t('editSnippet') : t('newSnippet')}</h2>
      </header>
      <div className="snp-scroll snp-fields">
        <label className="snp-field">
          <span>{t('name')}</span>
          <input value={name} autoFocus={!macro} placeholder="Restart nginx" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="snp-field">
          <span className="snp-field-row">
            {t('command')}
            {secret && (
              <button type="button" className="snc-btn sm" aria-label={show ? t('snippetHide') : t('snippetReveal')} aria-pressed={show} onClick={() => setShow((value) => !value)}>
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            )}
          </span>
          <span className={secret && !show ? 'snp-code-input masked' : 'snp-code-input'}>
            <span className="snc-prompt" aria-hidden="true">$</span>
            <textarea
              dir="ltr"
              rows={4}
              spellCheck={false}
              autoComplete="off"
              value={command}
              disabled={loading}
              autoFocus={Boolean(macro)}
              placeholder="sudo systemctl restart nginx"
              onChange={(event) => { setCommand(event.target.value); setError('') }}
            />
          </span>
        </label>
        {folders.length > 0 && (
          <label className="snp-field">
            <span>{t('folders')}</span>
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
              <option value="">{t('noFolder')}</option>
              {folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        <label className="snp-field">
          <span>{t('snippetTags')}</span>
          <input value={tagText} placeholder={t('snippetTagsHint')} onChange={(event) => setTagText(event.target.value)} />
          {suggestions.length > 0 && (
            <span className="snp-suggest">
              {suggestions.map((item) => (
                <button key={item} type="button" className="snp-chip" onClick={() => setTagText((value) => value.trim() ? `${value.replace(/,\s*$/, '')}, ${item}` : item)}>+ {item}</button>
              ))}
            </span>
          )}
        </label>

        <label className="snp-switch">
          <input type="checkbox" role="switch" checked={sendEnter} onChange={(event) => setSendEnter(event.target.checked)} />
          <span className="snp-switch-ui" aria-hidden="true" />
          <span className="snp-switch-text"><strong>{t('sendEnter')}</strong></span>
        </label>
        <label className="snp-switch">
          <input type="checkbox" role="switch" checked={secret} onChange={(event) => { setSecret(event.target.checked); if (event.target.checked) setShow(false) }} />
          <span className="snp-switch-ui" aria-hidden="true" />
          <span className="snp-switch-text">
            <strong><LockIcon /> {t('snippetSecret')}</strong>
            <small>{t('snippetSecretHint')}</small>
          </span>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="snp-edit-foot">
        <button type="button" className="snp-ghost" onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" className="snp-new" disabled={busy || loading}>{t('save')}<kbd>{MAC ? '⌘↵' : 'Ctrl+↵'}</kbd></button>
      </footer>
    </form>
  )
}

function relativeTime(when: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const seconds = Math.round((when - Date.now()) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity]]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf.format(unit === 'second' && Math.abs(value) < 30 ? 0 : value, unit)
    value = Math.round(value / size)
  }
  return ''
}

/* ─── icons (1.6px stroke, 16px grid) ─── */

function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return <svg className="snp-ico" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">{children}</svg>
}
function PlusIcon() { return <Svg size={14}><path d="M12 5v14M5 12h14" /></Svg> }
function SearchIcon() { return <Svg size={14}><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></Svg> }
function PlayIcon() { return <Svg size={14}><path className="fill" d="M8 5.5v13l10.5-6.5z" /></Svg> }
function PasteIcon() { return <Svg><rect x="8" y="3.5" width="8" height="4" rx="1.2" /><path d="M8 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H16" /><path d="M9 13h6M9 16.5h4" /></Svg> }
function DotsIcon() { return <Svg><circle className="fill" cx="6" cy="12" r="1.4" /><circle className="fill" cx="12" cy="12" r="1.4" /><circle className="fill" cx="18" cy="12" r="1.4" /></Svg> }
function GripIcon() { return <Svg size={14}><circle className="fill" cx="9" cy="6" r="1.3" /><circle className="fill" cx="15" cy="6" r="1.3" /><circle className="fill" cx="9" cy="12" r="1.3" /><circle className="fill" cx="15" cy="12" r="1.3" /><circle className="fill" cx="9" cy="18" r="1.3" /><circle className="fill" cx="15" cy="18" r="1.3" /></Svg> }
function BraceIcon() { return <Svg size={14}><path d="M10 5.2c-2 .35-2.8 1.55-2.8 3.05 0 1.75 1.25 2.35 1.25 3.75S7.2 14 7.2 15.75c0 1.5.8 2.7 2.8 3.05" /><path d="M14 5.2c2 .35 2.8 1.55 2.8 3.05 0 1.75-1.25 2.35-1.25 3.75s1.25 1.95 1.25 3.7c0 1.5-.8 2.7-2.8 3.05" /></Svg> }
function LockIcon() { return <Svg size={14}><rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></Svg> }
function EyeIcon() { return <Svg><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Svg> }
function EyeOffIcon() { return <Svg><path d="M4 4l16 16" /><path d="M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.2 7.4A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9" /><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4" /></Svg> }
function PinIcon() { return <Svg size={14}><path d="M9 4h6l-1 5 3 3H7l3-3z" /><path d="M12 12v8" /></Svg> }
function EditIcon() { return <Svg size={14}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Svg> }
function DuplicateIcon() { return <Svg size={14}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg> }
function CopyIcon() { return <Svg size={14}><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H15" /></Svg> }
function TrashIcon() { return <Svg size={14}><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12" /></Svg> }
function CheckIcon() { return <Svg size={14}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg> }
function FolderIcon() { return <Svg size={14}><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /></Svg> }
function FolderPlusIcon() { return <Svg><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M12 10.5v5M9.5 13h5" /></Svg> }
function InboxIcon() { return <Svg size={14}><path d="M4 13l2.5-7h11L20 13v5.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13h4.5l1 2h5l1-2H20" /></Svg> }
function CaretIcon({ open }: { open: boolean }) { return <span className={open ? 'snp-caret open' : 'snp-caret'} aria-hidden="true"><Svg size={12}><path d="M9 6l6 6-6 6" /></Svg></span> }
function HostIcon() { return <Svg size={12}><rect x="4" y="5" width="16" height="6" rx="1.5" /><rect x="4" y="13" width="16" height="6" rx="1.5" /><path d="M8 8h.01M8 16h.01" /></Svg> }

function EmptyArt() {
  return (
    <svg className="snp-empty-art" viewBox="0 0 120 88" aria-hidden="true" focusable="false">
      <rect className="back" x="22" y="6" width="76" height="52" rx="10" />
      <rect className="mid" x="14" y="16" width="92" height="58" rx="11" />
      <rect className="front" x="6" y="28" width="108" height="56" rx="12" />
      <path className="prompt" d="M20 46l7 6-7 6" />
      <path className="line" d="M34 58h30" />
      <rect className="cursor" x="68" y="52" width="7" height="12" rx="1.5" />
      <path className="line dim" d="M20 72h54" />
    </svg>
  )
}
