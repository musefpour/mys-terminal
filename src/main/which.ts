import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Capabilities } from '../shared/types'
import { join } from 'node:path'
import { tr } from './i18n'
import { defaultShell, isMac, isWin } from './platform'

// FreeRDP 3 ships sdl-freerdp / xfreerdp3; FreeRDP 2 ships xfreerdp / wfreerdp.
const FREERDP_NAMES = isWin
  ? ['wfreerdp', 'sdl-freerdp', 'sdl-freerdp3', 'wfreerdp3']
  : ['sdl-freerdp3', 'xfreerdp3', 'sdl-freerdp', 'xfreerdp', 'wlfreerdp3', 'wlfreerdp', 'freerdp']
const FREERDP_DIRS = isWin
  ? [join(process.env.ProgramFiles || 'C:\\Program Files', 'FreeRDP')]
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
const FREERDP_CANDIDATES = [
  ...FREERDP_NAMES,
  ...FREERDP_DIRS.flatMap((dir) => FREERDP_NAMES.map((name) => join(dir, isWin ? `${name}.exe` : name))),
]

const RDP_APPS = [
  'Windows App',
  'Microsoft Remote Desktop',
  'Microsoft Remote Desktop Beta',
]

export function which(command: string): Promise<string | null> {
  if (/[\\/]/.test(command)) return Promise.resolve(existsSync(command) ? command : null)
  return new Promise((resolve) => {
    execFile(isWin ? 'where' : 'which', [command], { windowsHide: true }, (error, stdout) => {
      if (error) resolve(null)
      else resolve(stdout.split(/\r?\n/)[0]?.trim() || null)
    })
  })
}

export async function findFreerdp(): Promise<string | null> {
  for (const candidate of FREERDP_CANDIDATES) {
    if (/[\\/]/.test(candidate)) {
      if (existsSync(candidate)) return candidate
      continue
    }
    const found = await which(candidate)
    if (found) return found
  }
  return null
}

/** macOS app name, or `mstsc` on Windows. */
export function findRdpApp(): string | null {
  if (isWin) return 'mstsc'
  if (!isMac) return null
  for (const name of RDP_APPS) {
    if (existsSync(`/Applications/${name}.app`)) return name
  }
  return null
}

export async function capabilities(): Promise<Capabilities> {
  const [mosh, freerdp, docker, kubectl, wsl, pwsh] = await Promise.all([
    which('mosh'),
    findFreerdp(),
    which('docker'),
    which('kubectl'),
    isWin ? which('wsl') : Promise.resolve(null),
    which('pwsh'),
  ])
  return {
    mosh,
    freerdp,
    xquartz: existsSync('/Applications/XQuartz.app') || existsSync('/opt/X11/bin/Xquartz'),
    display: process.env.DISPLAY || '',
    shell: defaultShell(),
    home: homedir(),
    platform: process.platform,
    docker,
    kubectl,
    wsl,
    pwsh: pwsh || (isWin ? 'powershell.exe' : null),
  }
}

export function assertUser(value: string | undefined): string {
  const user = (value ?? '').trim()
  if (!user) return ''
  if (!/^[\w.+@-]+$/.test(user)) throw new Error(tr('invalidUser'))
  return user
}
