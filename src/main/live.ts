import type { Client } from 'ssh2'
import type { Client as FtpClient } from 'basic-ftp'
import type { SFTPWrapper } from 'ssh2'
import type { S3Auth } from './s3'
import type { Protocol } from '../shared/types'

export interface LiveConn {
  id: string
  protocol: Protocol
  sessionId?: string
  disposed: boolean
  ready: boolean
  cleaned: boolean
  cleaners: Array<() => void>
  fileMode: 'sftp' | 'ftp' | 's3' | 'local' | 'none'
  cwd: string
  sftp?: SFTPWrapper
  ftp?: FtpClient
  s3?: S3Auth
  ssh?: Client
  ptyPid?: number
  /** PID of the remote login shell, reported by the SSH exec wrapper. */
  remotePid?: number
  bytesIn: number
  bytesOut: number
  startedAt: number
  addClean: (fn: () => void) => void
  cleanup: () => void
}

export function createLive(id: string, protocol: Protocol, sessionId?: string): LiveConn {
  const conn: LiveConn = {
    id,
    protocol,
    sessionId,
    disposed: false,
    ready: false,
    cleaned: false,
    cleaners: [],
    fileMode: 'none',
    cwd: '',
    bytesIn: 0,
    bytesOut: 0,
    startedAt: Date.now(),
    addClean(fn) {
      this.cleaners.push(fn)
    },
    cleanup() {
      if (this.cleaned) return
      this.cleaned = true
      for (const fn of this.cleaners) {
        try {
          fn()
        } catch {
          /* already closing */
        }
      }
    },
  }
  return conn
}
