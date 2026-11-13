import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { FileEntry, TransferInfo } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { DiffModal, SyncDialog } from './SyncDiff'
import { CloseButton } from './XMark'
import { MenuItem, MenuSep, PopupMenu } from './PopupMenu'

const FOLLOW_KEY = 'mys.files.follow'

export function FilePanel({ instanceId, mode, bare = false, terminal = false, visible = true }: {
  instanceId: string
  mode: 'sftp' | 'ftp' | 's3' | 'local'
  bare?: boolean
  /** A shell runs in this tab, so the panel can follow and drive its directory. */
  terminal?: boolean
  visible?: boolean
}) {
  const model = useModel()
  const { t } = useI18n()
  const [follow, setFollow] = useState(() => localStorage.getItem(FOLLOW_KEY) !== '0')
  const seenCwd = useRef('')
  const [path, setPath] = useState('')
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState('')
  const [rowMenu, setRowMenu] = useState<{ entry: FileEntry; x: number; y: number } | null>(null)
  const closeRowMenu = useCallback(() => setRowMenu(null), [])
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [transfers, setTransfers] = useState<TransferInfo[]>([])
  const [syncing, setSyncing] = useState(false)
  const [diff, setDiff] = useState<{ leftTitle: string; rightTitle: string; left: string; right: string } | null>(null)
  const pathRef = useRef('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (next?: string, attempt = 0) => {
    setBusy(true)
    setError('')
    try {
      const result = await window.mys.files.list(instanceId, next)
      setPath(result.path)
      setDraft(result.path)
      setEntries(result.entries)
      setBusy(false)
    } catch (caught) {
      const message = cleanIpcError(caught, t('listFailed'))
      if ((message.includes('sftp-not-ready') || message.includes('هنوز آماده')) && attempt < 10) {
        window.setTimeout(() => { void load(next, attempt + 1) }, 300)
        return
      }
      setError(message === 'sftp-not-ready' ? t('sftpNotReady') : message)
      setBusy(false)
    }
  }, [instanceId])

  useEffect(() => {
    void load()
  }, [load])

  // Move with the shell: only when its directory changes, so manual browsing sticks.
  useEffect(() => {
    if (!terminal || !follow || !visible) return
    let alive = true
    const tick = async () => {
      if (document.hidden) return
      const cwd = await window.mys.files.terminalCwd(instanceId).catch(() => null)
      if (!alive || !cwd || cwd === seenCwd.current) return
      seenCwd.current = cwd
      await load(cwd)
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [terminal, follow, visible, instanceId, load])

  pathRef.current = path

  // Queue state comes from main; refresh the listing when an upload lands here.
  useEffect(() => {
    void window.mys.transfers.list(instanceId).then(setTransfers).catch(() => undefined)
    let finished = new Set<string>()
    let reload = 0
    const off = window.mys.subscribe((event) => {
      if (event.type !== 'transfers' || event.connId !== instanceId) return
      setTransfers(event.items)
      const done = new Set(event.items.filter((item) => item.state === 'done').map((item) => item.id))
      const landed = event.items.some((item) => item.direction === 'up' && item.state === 'done' && !finished.has(item.id))
      finished = done
      if (landed) {
        window.clearTimeout(reload)
        reload = window.setTimeout(() => void load(pathRef.current), 400)
      }
    })
    return () => {
      off()
      window.clearTimeout(reload)
    }
  }, [instanceId, load])

  const openEntry = async (entry: FileEntry) => {
    const next = joinPath(path, entry.name)
    if (entry.isDir) {
      await load(next)
      return
    }
    if (mode === 'local' && !textLike(entry.name)) {
      await window.mys.files.openPath(next)
      return
    }
    try {
      const file = await window.mys.files.read(instanceId, next)
      if ('binary' in file) {
        await window.mys.files.download(instanceId, next, false)
        return
      }
      model.setEditor({ instanceId, path: next, content: file.content, mode })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('fileOpenFailed'))
    }
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    const paths = [...event.dataTransfer.files].map((file) => window.mys.getPathForFile(file)).filter(Boolean)
    if (!paths.length || !path) return
    setBusy(true)
    try {
      await window.mys.files.uploadPaths(instanceId, path, paths)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={`${bare ? 'files-pane' : 'files'}${dropping ? ' drop-target' : ''}`}
      dir="ltr"
      onDragOver={(event) => {
        event.preventDefault()
        if ([...event.dataTransfer.types].includes('Files')) {
          event.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(event) => {
        setDropping(false)
        void onDrop(event)
      }}
    >
      <div className="files-bar">
        <button type="button" className="files-ico" title={t('up')} aria-label={t('up')} onClick={() => void load(parentPath(path))} disabled={!path || path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)}><FileIcon d={['M8 13V3', 'M4 7l4-4 4 4']} /></button>
        <form onSubmit={(event) => { event.preventDefault(); void load(draft) }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        </form>
        <button type="button" className="files-ico" title={t('refresh')} aria-label={t('refresh')} onClick={() => void load(path)}><FileIcon d={['M13 8a5 5 0 1 1-1.5-3.6', 'M13 2.5v3h-3']} /></button>
      </div>
      <div className="files-actions">
        <button type="button" className="files-ico" title={t('add')} aria-label={t('add')} onClick={() => void upload()}><FileIcon d={['M8 11V3', 'M4.5 6.5 8 3l3.5 3.5', 'M3 13h10']} /></button>
        <button type="button" className="files-ico" title={t('makeFolder')} aria-label={t('makeFolder')} onClick={() => void makeDir()}><FileIcon d={['M2 4.5h4l1.5 1.5H14V13H2z', 'M8 8v3.5', 'M6.25 9.75h3.5']} /></button>
        {mode === 'local' && <button type="button" className="files-ico" title={revealLabel()} aria-label={revealLabel()} onClick={() => void window.mys.files.reveal(path)}><FileIcon d={['M9 3h4v4', 'M13 3 7.5 8.5', 'M11 9.5V13H3V5h3.5']} /></button>}
        {mode !== 'local' && <button type="button" disabled={!path} title={t('syncHint')} onClick={() => setSyncing(true)}>{t('syncButton')}</button>}
        {terminal && (
          <>
            <span className="files-sep" />
            <button type="button" title={t('cdHereHint')} disabled={!path} onClick={() => cdHere()}>{t('cdHere')}</button>
            <label className="check" title={t('followTerminalHint')}>
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => {
                  setFollow(event.target.checked)
                  seenCwd.current = ''
                  localStorage.setItem(FOLLOW_KEY, event.target.checked ? '1' : '0')
                }}
              /> {t('followTerminal')}
            </label>
          </>
        )}
      </div>
      <TransferList items={transfers} connId={instanceId} />
      {syncing && <SyncDialog instanceId={instanceId} remoteDir={path} onClose={() => setSyncing(false)} />}
      {diff && <DiffModal {...diff} onClose={() => setDiff(null)} />}
      {error && <p className="form-error">{error}</p>}
      <div className="file-list">
        {entries.map((entry) => (
          <div
            key={entry.name}
            className={['file-row', rowMenu?.entry.name === entry.name && 'menu-open', dragging === entry.name && 'dragging'].filter(Boolean).join(' ')}
            title={permString(entry.mode)}
            draggable
            onDragStart={(event) => {
              // Hand the drag to the OS so the file lands in Finder/Explorer (remote files are fetched first).
              event.preventDefault()
              setError('')
              setDragging(entry.name)
              void window.mys.files.dragOut(instanceId, joinPath(path, entry.name), entry.isDir)
                .catch((caught) => setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('downloadFailed')))
                .finally(() => setDragging(null))
            }}
            onDoubleClick={() => void openEntry(entry)}
            onContextMenu={(event) => {
              event.preventDefault()
              setRowMenu({ entry, x: event.clientX, y: event.clientY })
            }}
          >
            <button type="button" className="file-name" onClick={() => void openEntry(entry)}>
              <span className="file-glyph">{entry.isDir ? '▸' : '·'}</span>
              <span className="file-label">{entry.name}</span>
            </button>
            <span className="file-size">{entry.isDir ? '' : formatSize(entry.size)}</span>
            <button
              type="button"
              className="file-more"
              title={t('more')}
              aria-label={t('more')}
              aria-haspopup="menu"
              aria-expanded={rowMenu?.entry.name === entry.name}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                setRowMenu(rowMenu?.entry.name === entry.name ? null : { entry, x: box.left, y: box.bottom + 4 })
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
            </button>
          </div>
        ))}
        {!busy && entries.length === 0 && <p className="hint">{t('emptyFolder')}</p>}
      </div>
      {rowMenu && (() => {
        const entry = rowMenu.entry
        const run = (fn: () => unknown) => () => {
          setRowMenu(null)
          void fn()
        }
        return (
          <PopupMenu x={rowMenu.x} y={rowMenu.y} onClose={closeRowMenu}>
            {mode !== 'local' && (
              <MenuItem label={t('download')} onClick={run(() => window.mys.files.download(instanceId, joinPath(path, entry.name), entry.isDir))} />
            )}
            {!entry.isDir && <MenuItem label={t('editExternal')} onClick={run(() => editExternal(entry))} />}
            {!entry.isDir && <MenuItem label={t('compareButton')} onClick={run(() => compare(entry))} />}
            {mode !== 's3' && <MenuItem label={t('permissions')} hint={permString(entry.mode)} onClick={run(() => chmod(entry))} />}
            <MenuSep />
            <MenuItem label={t('rename')} onClick={run(() => rename(entry))} />
            <MenuItem label={t('delete')} danger onClick={run(() => remove(entry))} />
          </PopupMenu>
        )
      })()}
    </section>
  )

  async function upload() {
    if (!path) return
    setBusy(true)
    try {
      await window.mys.files.upload(instanceId, path)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function compare(entry: FileEntry) {
    setError('')
    try {
      const local = await window.mys.dialog.pickFile()
      if (!local) return
      const [remoteFile, localFile] = await Promise.all([window.mys.files.read(instanceId, joinPath(path, entry.name)), window.mys.files.readLocal(local)])
      if ('binary' in remoteFile || 'binary' in localFile) {
        setError(t('compareBinary'))
        return
      }
      setDiff({ leftTitle: local, rightTitle: joinPath(path, entry.name), left: localFile.content, right: remoteFile.content })
    } catch (caught) {
      setError(cleanIpcError(caught, t('fileOpenFailed')))
    }
  }

  function cdHere() {
    if (!path) return
    const windowsShell = mode === 'local' && window.mys.platform === 'win32'
    const quoted = `'${path.replace(/'/g, windowsShell ? "''" : "'\\''")}'`
    window.mys.write(instanceId, `cd ${quoted}\r`)
    seenCwd.current = path
    window.dispatchEvent(new CustomEvent('mys-focus', { detail: instanceId }))
  }

  async function editExternal(entry: FileEntry) {
    setError('')
    try {
      await window.mys.files.editExternal(instanceId, joinPath(path, entry.name))
      if (mode !== 'local') model.toast(t('editExternalStarted', { name: entry.name }))
    } catch (caught) {
      setError(cleanIpcError(caught, t('fileOpenFailed')))
    }
  }

  async function chmod(entry: FileEntry) {
    const current = octalMode(entry.mode)
    const next = window.prompt(t('permissionsPrompt', { name: entry.name }), current)
    if (!next || next === current) return
    setError('')
    try {
      await window.mys.files.chmod(instanceId, joinPath(path, entry.name), next.trim())
      await load(path)
    } catch (caught) {
      setError(cleanIpcError(caught, t('saveFailed')))
    }
  }

  async function makeDir() {
    const name = window.prompt(t('folderName'))
    if (!name || !path) return
    await window.mys.files.mkdir(instanceId, joinPath(path, name))
    await load(path)
  }

  async function rename(entry: FileEntry) {
    const name = window.prompt(t('newName'), entry.name)
    if (!name || name === entry.name) return
    await window.mys.files.rename(instanceId, joinPath(path, entry.name), joinPath(path, name))
    await load(path)
  }

  async function remove(entry: FileEntry) {
    if (!(await model.ask(t('deleteAsk', { name: entry.name })))) return
    await window.mys.files.remove(instanceId, joinPath(path, entry.name), entry.isDir)
    await load(path)
  }
}

function TransferList({ items, connId }: { items: TransferInfo[]; connId: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  if (!items.length) return null
  const active = items.filter((item) => item.state === 'running' || item.state === 'queued').length
  const finished = items.some((item) => item.state === 'done' || item.state === 'canceled' || item.state === 'failed')
  const running = items.filter((item) => item.state === 'running')
  const speed = running.reduce((sum, item) => sum + item.speed, 0)
  return (
    <section className="transfers">
      <header>
        <button type="button" className="transfers-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {t('transfers')} {active > 0 && <span className="transfers-count">{active}</span>}
          {speed > 0 && <span className="transfers-speed">{formatSize(speed)}/s</span>}
        </button>
        {finished && <button type="button" onClick={() => void window.mys.transfers.clear(connId)}>{t('clearFinished')}</button>}
      </header>
      {open && (
        <ul>
          {items.map((item) => <TransferRow key={item.id} item={item} />)}
        </ul>
      )}
    </section>
  )
}

function TransferRow({ item }: { item: TransferInfo }) {
  const { t } = useI18n()
  const percent = item.size > 0 ? Math.min(100, Math.round((item.transferred / item.size) * 100)) : item.state === 'done' ? 100 : 0
  const eta = item.state === 'running' && item.speed > 0 && item.size > item.transferred ? (item.size - item.transferred) / item.speed : null
  const status = item.state === 'running'
    ? [item.size ? `${formatSize(item.transferred)} / ${formatSize(item.size)}` : formatSize(item.transferred), item.speed ? `${formatSize(item.speed)}/s` : '', eta !== null ? formatEta(eta) : ''].filter(Boolean).join(' · ')
    : item.state === 'failed' ? item.error || t('transferFailed') : t(STATE_LABEL[item.state])
  return (
    <li className={`transfer ${item.state}`} title={`${item.direction === 'up' ? item.local : item.remote} → ${item.direction === 'up' ? item.remote : item.local}`}>
      <div className="transfer-top">
        <span className="transfer-dir" aria-hidden="true">{item.direction === 'up' ? '↑' : '↓'}</span>
        <span className="transfer-name">{item.name}</span>
        <span className="transfer-ops">
          {item.pausable && (item.state === 'running' || item.state === 'queued') && (
            <button type="button" title={t('pause')} aria-label={t('pause')} onClick={() => void window.mys.transfers.pause(item.id)}>❚❚</button>
          )}
          {(item.state === 'paused' || item.state === 'failed') && (
            <button type="button" title={t('resume')} aria-label={t('resume')} onClick={() => void window.mys.transfers.resume(item.id)}>▶</button>
          )}
          {(item.state === 'queued' || item.state === 'paused' || item.state === 'failed' || (item.state === 'running' && item.pausable)) && (
            <button type="button" title={t('cancel')} aria-label={t('cancel')} onClick={() => void window.mys.transfers.cancel(item.id)}>✕</button>
          )}
        </span>
      </div>
      <div className="transfer-bar"><i style={{ width: `${percent}%` }} /></div>
      <small>{status}</small>
    </li>
  )
}

const STATE_LABEL = {
  queued: 'transferQueued',
  running: 'transferQueued',
  paused: 'transferPaused',
  done: 'transferDone',
  failed: 'transferFailed',
  canceled: 'transferCanceled',
} as const

function formatEta(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

export function EditorModal() {
  const model = useModel()
  const { t } = useI18n()
  const editor = model.editor
  const [content, setContent] = useState(editor?.content ?? '')
  const [error, setError] = useState('')
  useEffect(() => setContent(editor?.content ?? ''), [editor?.path, editor?.content])
  if (!editor) return null
  return (
    <div className="modal-back" onMouseDown={() => model.setEditor(null)}>
      <form
        className="modal editor"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void window.mys.files.write(editor.instanceId, editor.path, content).then(() => {
            model.toast(t('fileSaved'))
            model.setEditor(null)
          }).catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : t('saveFailed'))
          })
        }}
      >
        <header>
          <h2 dir="ltr">{editor.path}</h2>
          <CloseButton label={t('close')} onClick={() => model.setEditor(null)} />
        </header>
        <textarea dir="ltr" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="submit" className="primary">{t('save')}</button>
        </footer>
      </form>
    </div>
  )
}

function cleanIpcError(caught: unknown, fallback: string): string {
  const raw = caught instanceof Error ? caught.message : fallback
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

/** `100644` (sftp), `644` (local), `rwxr-xr-x` (ftp) → `644` */
function octalMode(mode: string): string {
  if (/^[0-7]+$/.test(mode)) return mode.slice(-3).padStart(3, '0')
  if (/^[rwx-]{9}$/.test(mode)) {
    let out = ''
    for (let i = 0; i < 9; i += 3) {
      out += String((mode[i] === 'r' ? 4 : 0) + (mode[i + 1] === 'w' ? 2 : 0) + (mode[i + 2] === 'x' ? 1 : 0))
    }
    return out
  }
  return '644'
}

function permString(mode: string): string {
  if (!mode) return ''
  const octal = octalMode(mode)
  return [...octal].map((digit) => {
    const n = Number(digit)
    return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`
  }).join('') + `  ${octal}`
}

function revealLabel(): string {
  if (window.mys.platform === 'win32') return 'Explorer'
  if (window.mys.platform === 'darwin') return 'Finder'
  return 'Files'
}

function joinPath(dir: string, name: string): string {
  if (isDrivePath(dir)) return `${dir.replace(/[\\/]+$/, '')}\\${name}`
  if (dir === '/' || dir === '') return `/${name}`
  return `${dir.replace(/\/$/, '')}/${name}`
}

function parentPath(dir: string): string {
  if (isDrivePath(dir)) {
    const parts = dir.split(/[\\/]+/).filter(Boolean)
    if (parts.length <= 1) return `${parts[0] || dir.slice(0, 2)}\\`
    parts.pop()
    return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\')
  }
  if (!dir || dir === '/') return '/'
  const parts = dir.split('/').filter(Boolean)
  parts.pop()
  return dir.startsWith('/') ? `/${parts.join('/')}` || '/' : parts.join('/') || '/'
}

/** Windows `C:\…` paths from the local file panel. */
function isDrivePath(dir: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(dir)
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

function textLike(name: string): boolean {
  return /\.(txt|md|json|js|ts|tsx|jsx|py|go|rs|java|c|h|cpp|css|html|xml|ya?ml|toml|ini|conf|sh|log|csv|sql|php|vue|env|service)$/i.test(name)
    || /^(dockerfile|makefile|readme)$/i.test(name)
}

function FileIcon({ d }: { d: string[] }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {d.map((path) => <path key={path} d={path} />)}
    </svg>
  )
}
