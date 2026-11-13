import { app, dialog, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { tr } from './i18n'

/** Set at build time: `MAIN_VITE_UPDATE_URL=https://…/updates npm run dist`. */
const FEED_URL = (import.meta.env.MAIN_VITE_UPDATE_URL as string | undefined)?.trim() || ''
const EVERY = 6 * 60 * 60 * 1000

let ready = false
let manual = false
let timer: NodeJS.Timeout | null = null

function box(window: () => BrowserWindow | null, options: Electron.MessageBoxOptions) {
  const parent = window()
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

/** Portable Windows builds and unpackaged dev runs cannot replace themselves. */
export function updatesSupported(): boolean {
  return app.isPackaged && Boolean(FEED_URL) && !process.env.PORTABLE_EXECUTABLE_DIR
}

export function initUpdater(window: () => BrowserWindow | null, enabled: boolean): void {
  if (!updatesSupported() || ready) return
  ready = true
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-not-available', () => {
    if (!manual) return
    manual = false
    void box(window, { type: 'info', message: tr('updateNone', { version: app.getVersion() }) })
  })
  autoUpdater.on('error', (error) => {
    console.error('[updater]', error?.message || error)
    if (!manual) return
    manual = false
    void box(window, { type: 'error', message: tr('updateFailed', { message: error?.message || '' }) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    manual = false
    void box(window, {
      type: 'info',
      buttons: [tr('updateRestart'), tr('updateLater')],
      defaultId: 0,
      cancelId: 1,
      message: tr('updateReady', { version: info.version }),
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })
  setAutoUpdate(enabled)
}

export function setAutoUpdate(enabled: boolean): void {
  if (!ready) return
  if (timer) clearInterval(timer)
  timer = null
  if (!enabled) return
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 15_000)
  timer = setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), EVERY)
}

export async function checkForUpdatesNow(window: () => BrowserWindow | null): Promise<void> {
  if (!updatesSupported()) {
    await box(window, { type: 'info', message: tr(app.isPackaged ? 'updateUnavailable' : 'updateDevBuild') })
    return
  }
  if (!ready) initUpdater(window, false)
  manual = true
  await autoUpdater.checkForUpdates().catch(() => undefined)
}
