import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import type { Session, Settings } from '../../../shared/types'
import { attachHighlighter } from '../highlight'
import { isMultiline, quotePath } from '../paste'
import { useI18n } from '../i18n'
import { appShortcut } from '../keys'
import { useModel } from '../model'
import { CloseButton } from './XMark'
import { registerTerminal, takeSeed, unregisterTerminal } from '../term-registry'
import { navSequence } from '../terminal-keys'
import { themeOf } from '../themes'

function asTerminalData(data: unknown): string | Uint8Array | null {
  // Main sends latin1 so every ANSI byte (ESC=0x1b) survives contextBridge.
  if (typeof data === 'string') {
    const bytes = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i += 1) bytes[i] = data.charCodeAt(i) & 0xff
    return bytes
  }
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (Array.isArray(data)) return new Uint8Array(data as number[])
  if (data && typeof data === 'object') {
    const row = data as { type?: string; data?: unknown }
    if (row.type === 'Buffer' && Array.isArray(row.data)) return new Uint8Array(row.data as number[])
  }
  return null
}

export { isTerminalProtocol } from '../terminal-protocols'

const isMac = window.mys.platform === 'darwin'

/** App settings with the session's own terminal look laid over them. */
function profileOf(settings: Settings, session?: Session) {
  return {
    theme: session?.termTheme || settings.theme,
    fontSize: session?.termFontSize || settings.fontSize,
    fontFamily: session?.termFontFamily || settings.fontFamily,
  }
}


export function TerminalView({ instanceId, active, sessionId, protocol }: { instanceId: string; active: boolean; sessionId?: string; protocol?: string }) {
  const model = useModel()
  const { t } = useI18n()
  const session = sessionId ? model.sessions.find((item) => item.id === sessionId) : undefined
  const profile = profileOf(model.settings, session)
  const highlightRef = useRef<IDisposable | null>(null)
  const askRef = useRef(model.ask)
  const pasteWarnRef = useRef(model.settings.pasteWarning)
  const tRef = useRef(t)
  askRef.current = model.ask
  pasteWarnRef.current = model.settings.pasteWarning
  tRef.current = t
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const multiRef = useRef(model.multiExec)
  const broadcastRef = useRef(model.broadcast)
  const [find, setFind] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  multiRef.current = model.multiExec
  const modeRef = useRef(themeOf(profile.theme).mode)
  modeRef.current = themeOf(profile.theme).mode
  broadcastRef.current = model.broadcast
  // Local Windows shells and PowerShell sessions take double-quoted paths; everything else is POSIX.
  const quoteStyle: 'posix' | 'windows' = protocol === 'powershell' || (protocol === 'local' && window.mys.platform === 'win32') ? 'windows' : 'posix'
  const quoteRef = useRef(quoteStyle)
  quoteRef.current = quoteStyle

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      cursorBlink: model.settings.cursorBlink,
      fontSize: profile.fontSize,
      fontFamily: profile.fontFamily,
      scrollback: model.settings.scrollback,
      theme: { ...themeOf(profile.theme).term },
      // registerDecoration (keyword highlighting) is still a proposed xterm API.
      allowProposedApi: true,
      cursorStyle: 'bar',
      convertEol: false,
      drawBoldTextInBrightColors: true,
      // Lift program colors that are too dark on this background to WCAG AA.
      minimumContrastRatio: 4.5,
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      void window.mys.openExternal(uri)
    }))
    term.open(host)
    registerTerminal(instanceId, term)
    // A tab moved in from another window brings its earlier output along.
    const seed = takeSeed(instanceId)
    if (seed) term.write(`${seed.replace(/\r?\n/g, '\r\n')}\r\n`)
    if (model.settings.webgl) {
      // GPU renderer; falls back to the DOM renderer if the context is lost or unavailable.
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        /* no WebGL2 here */
      }
    }
    if (model.settings.highlightKeywords) highlightRef.current = attachHighlighter(term, () => modeRef.current)
    fitRef.current = fit
    let fitFrame = 0
    let fitAgain = false
    let sized = { cols: 0, rows: 0 }
    const fitNow = () => {
      if (fitFrame) {
        fitAgain = true
        return
      }
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = 0
        if (host.isConnected && host.clientWidth >= 2 && host.clientHeight >= 2) {
          fit.fit()
          if (term.cols !== sized.cols || term.rows !== sized.rows) {
            sized = { cols: term.cols, rows: term.rows }
            window.mys.resize(instanceId, term.cols, term.rows)
          }
        }
        if (fitAgain) {
          fitAgain = false
          fitNow()
        }
      })
    }
    fitNow()
    termRef.current = term
    searchRef.current = search
    model.registerTerm(instanceId)

    const writeOut = (data: string) => {
      window.mys.write(instanceId, data)
      if (multiRef.current) broadcastRef.current(data, instanceId)
    }
    const dataSub = term.onData(writeOut)
    // term.paste() applies bracketed paste when the shell asked for it.
    const pasteText = async (text: string) => {
      if (!text) return
      if (pasteWarnRef.current && isMultiline(text)) {
        const lines = text.replace(/(\r?\n)+$/, '').split(/\r?\n/).length
        const ok = await askRef.current(tRef.current('pasteMultiline', { n: lines }))
        if (!ok) return
        requestAnimationFrame(() => term.focus())
      }
      term.paste(text)
    }
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      // Word / line jumps (⌥← ⌘← on macOS, Ctrl+← elsewhere) as keys every shell understands.
      const nav = navSequence(event, window.mys.platform, quoteRef.current)
      if (nav) {
        event.preventDefault()
        writeOut(nav)
        return false
      }
      const key = event.key.toLowerCase()
      // macOS: ⌘C / ⌘V. Windows/Linux: Ctrl+Shift+C / Ctrl+Shift+V (Ctrl+V also pastes),
      // so plain Ctrl+C always reaches the shell as an interrupt.
      const copyKey = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey && !event.metaKey
      const pasteKey = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (copyKey && key === 'c' && !event.altKey) {
        event.preventDefault()
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      if (pasteKey && key === 'v' && !event.altKey) {
        // Returning false only stops xterm; without preventDefault the native paste
        // event (Edit menu role) still reaches xterm's textarea and pastes a second time.
        event.preventDefault()
        void navigator.clipboard.readText().then((text) => pasteText(text))
        return false
      }
      // App shortcuts (menu accelerators, Ctrl+1…7) must not reach the shell; the menu/app handles them.
      if (appShortcut(event)) return false
      if (event.metaKey) return false
      return true
    })
    host.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return
      }
      void navigator.clipboard.readText().then((text) => pasteText(text))
    })
    // Files or folders dragged in from Finder/Explorer: type their paths, like a native terminal.
    const onDragOver = (event: DragEvent) => {
      const types = event.dataTransfer?.types ?? []
      if (!types.includes('Files') && !types.includes('text/plain')) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDropIn = (event: DragEvent) => {
      const data = event.dataTransfer
      if (!data) return
      event.preventDefault()
      const paths = [...data.files].map((file) => window.mys.getPathForFile(file)).filter(Boolean)
      const text = paths.length
        ? `${paths.map((path) => quotePath(path, quoteRef.current)).join(' ')} `
        : data.getData('text/plain')
      if (!text) return
      void pasteText(text)
      requestAnimationFrame(() => term.focus())
    }
    host.addEventListener('dragover', onDragOver)
    host.addEventListener('drop', onDropIn)
    if (model.settings.copyOnSelect) {
      term.onSelectionChange(() => {
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
      })
    }
    const unsub = window.mys.subscribe((event) => {
      if (event.type === 'data' && event.instanceId === instanceId) {
        const chunk = asTerminalData(event.data)
        if (chunk) term.write(chunk)
      }
    })
    const observer = new ResizeObserver(() => fitNow())
    observer.observe(host.parentElement ?? host)
    const onFit = (event: Event) => {
      if ((event as CustomEvent<string>).detail === instanceId) fitNow()
    }
    window.addEventListener('mys-fit', onFit)

    return () => {
      observer.disconnect()
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('drop', onDropIn)
      if (fitFrame) window.cancelAnimationFrame(fitFrame)
      window.removeEventListener('mys-fit', onFit)
      dataSub.dispose()
      unsub()
      highlightRef.current?.dispose()
      highlightRef.current = null
      unregisterTerminal(instanceId, term)
      term.dispose()
      model.unregisterTerm(instanceId)
      termRef.current = null
    }
    // Connection identity owns the terminal. Settings are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = profile.fontSize
    term.options.fontFamily = profile.fontFamily
    term.options.theme = { ...themeOf(profile.theme).term }
    term.options.cursorBlink = model.settings.cursorBlink
    term.options.scrollback = model.settings.scrollback
    if (model.settings.highlightKeywords && !highlightRef.current) highlightRef.current = attachHighlighter(term, () => modeRef.current)
    if (!model.settings.highlightKeywords && highlightRef.current) {
      highlightRef.current.dispose()
      highlightRef.current = null
    }
    fitRef.current?.fit()
  }, [model.settings, profile.theme, profile.fontSize, profile.fontFamily])

  useEffect(() => {
    if (active && model.findNonce) setFindOpen(true)
  }, [active, model.findNonce])

  useEffect(() => {
    if (!active) return
    const term = termRef.current
    const frame = requestAnimationFrame(() => term?.focus())
    return () => cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    const onFocus = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== instanceId) return
      requestAnimationFrame(() => termRef.current?.focus())
    }
    const onClear = (event: Event) => {
      if ((event as CustomEvent<string>).detail === instanceId) termRef.current?.clear()
    }
    window.addEventListener('mys-focus', onFocus)
    window.addEventListener('mys-clear', onClear)
    return () => {
      window.removeEventListener('mys-focus', onFocus)
      window.removeEventListener('mys-clear', onClear)
    }
  }, [instanceId])

  return (
    <div className="term-wrap" dir="ltr">
      {findOpen && (
        <form
          className="findbar"
          onSubmit={(event) => {
            event.preventDefault()
            searchRef.current?.findNext(find)
          }}
        >
          <input autoFocus value={find} placeholder={t('find')} onChange={(event) => setFind(event.target.value)} />
          <button type="submit">{t('next')}</button>
          <button type="button" onClick={() => searchRef.current?.findPrevious(find)}>{t('previous')}</button>
          <CloseButton label={t('close')} onClick={() => setFindOpen(false)} />
        </form>
      )}
      <div className="term-host" ref={hostRef} />
    </div>
  )
}
