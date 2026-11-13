import { existsSync } from 'node:fs'
import net from 'node:net'
import { userInfo } from 'node:os'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'

const WIN_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

export function defaultShell(): string {
  if (isWin) return process.env.MYS_SHELL || 'powershell.exe'
  return process.env.SHELL || (isMac ? '/bin/zsh' : '/bin/bash')
}

export function localUser(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USER || process.env.USERNAME || ''
  }
}

/** SSH agent for ssh2: unix socket, Windows OpenSSH agent pipe, or Pageant. */
export function sshAgent(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK
  if (!isWin) return undefined
  return existsSync(WIN_AGENT_PIPE) ? WIN_AGENT_PIPE : 'pageant'
}

/**
 * Connect to the local X server named by DISPLAY.
 * `:0` → unix socket (fallback TCP 6000), `host:1` → TCP 6001,
 * `/private/tmp/…/org.xquartz:0` (macOS launchd) → that socket path.
 */
export function connectX11(display = process.env.DISPLAY || ':0'): Promise<net.Socket> {
  const value = display.trim() || ':0'
  const colon = value.lastIndexOf(':')
  const hostPart = colon >= 0 ? value.slice(0, colon) : ''
  const number = Number(value.slice(colon + 1).split('.')[0]) || 0
  const attempts: net.NetConnectOpts[] = []
  if (value.startsWith('/')) attempts.push({ path: value })
  else if (!isWin && (!hostPart || hostPart === 'unix')) attempts.push({ path: `/tmp/.X11-unix/X${number}` })
  const tcpHost = !hostPart || hostPart === 'unix' || hostPart.startsWith('/') ? '127.0.0.1' : hostPart
  attempts.push({ host: tcpHost, port: 6000 + number })
  return tryEach(attempts)
}

function tryEach(list: net.NetConnectOpts[]): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const next = (index: number, last?: Error) => {
      const opts = list[index]
      if (!opts) {
        reject(last || new Error('no X server'))
        return
      }
      const socket = net.connect(opts)
      socket.once('connect', () => {
        socket.removeAllListeners('error')
        resolve(socket)
      })
      socket.once('error', (error) => {
        socket.destroy()
        next(index + 1, error)
      })
    }
    next(0)
  })
}

/** `COM3` → `\\.\COM3` on Windows; Unix device paths pass through. */
export function serialDevice(value: string): string | null {
  const raw = value.trim()
  if (isWin) {
    const match = raw.match(/^(?:\\\\\.\\)?(COM\d{1,3})$/i)
    return match ? `\\\\.\\${match[1].toUpperCase()}` : null
  }
  return raw.startsWith('/dev/') ? raw : null
}
