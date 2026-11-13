import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { TrzszFilter } from 'trzsz'
import Zmodem from 'zmodem.js'
import { tr } from './i18n'

export interface TerminalSide {
  /** Bytes for the user's terminal (renderer). */
  toTerminal: (data: Buffer) => void
  /** Bytes for the remote shell. */
  toServer: (data: Buffer) => void
  /** `directory`: trzsz `trz -d` sends folders too. */
  pickFiles: (directory?: boolean) => Promise<string[] | undefined>
  pickDirectory: () => Promise<string | undefined>
  columns: number
  windowsShell: boolean
}

const CHUNK = 64 * 1024

/**
 * In-band file transfer for a terminal: ZMODEM (`rz` / `sz`) and trzsz
 * (`trz` / `tsz`). Output goes through the ZMODEM sentry, then the trzsz
 * filter; input goes to trzsz (and is held back while ZMODEM runs).
 */
export class TerminalTransfer {
  private trzsz: TrzszFilter
  private sentry: Zmodem.Sentry
  private zsession: Zmodem.Session | null = null
  private closed = false

  constructor(private side: TerminalSide) {
    this.trzsz = new TrzszFilter({
      writeToTerminal: (output) => {
        if (typeof output === 'string') side.toTerminal(Buffer.from(output, 'utf8'))
        else if (output instanceof Uint8Array) side.toTerminal(Buffer.from(output))
        else if (output instanceof ArrayBuffer) side.toTerminal(Buffer.from(new Uint8Array(output)))
      },
      sendToServer: (input) => side.toServer(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)),
      chooseSendFiles: (directory) => side.pickFiles(Boolean(directory)),
      chooseSaveDirectory: () => side.pickDirectory(),
      terminalColumns: side.columns,
      isWindowsShell: side.windowsShell,
    })
    this.sentry = new Zmodem.Sentry({
      to_terminal: (octets: number[] | Uint8Array) => this.trzsz.processServerOutput(Uint8Array.from(octets)),
      sender: (octets: number[] | Uint8Array) => side.toServer(Buffer.from(octets)),
      on_detect: (detection: Zmodem.Detection) => void this.zmodem(detection),
      on_retract: () => undefined,
    })
  }

  get busy(): boolean {
    return Boolean(this.zsession) || this.trzsz.isTransferringFiles()
  }

  output(data: Buffer): void {
    if (this.closed) {
      this.side.toTerminal(data)
      return
    }
    try {
      this.sentry.consume(data)
    } catch (error) {
      // A garbled ZMODEM stream must not swallow the terminal.
      this.zsession = null
      this.note(tr('zmodemFailed', { message: error instanceof Error ? error.message : String(error) }))
      this.trzsz.processServerOutput(new Uint8Array(data))
    }
  }

  input(data: string): void {
    if (this.zsession) {
      // Ctrl+C cancels a running ZMODEM transfer; other keys are dropped meanwhile.
      if (data.includes('\x03')) this.abortZmodem()
      return
    }
    this.trzsz.processTerminalInput(data)
  }

  resize(columns: number): void {
    this.trzsz.setTerminalColumns(columns)
  }

  dispose(): void {
    this.closed = true
    if (this.trzsz.isTransferringFiles()) this.trzsz.stopTransferringFiles()
    this.abortZmodem()
  }

  private abortZmodem(): void {
    const session = this.zsession
    this.zsession = null
    if (!session) return
    try {
      session.abort()
    } catch {
      /* already over */
    }
    this.note(tr('zmodemCanceled'))
  }

  private note(text: string): void {
    this.side.toTerminal(Buffer.from(`\r\n\x1b[36m[ZMODEM]\x1b[0m ${text}\r\n`, 'utf8'))
  }

  private async zmodem(detection: Zmodem.Detection): Promise<void> {
    const session = detection.confirm()
    this.zsession = session
    session.on('session_end', () => {
      if (this.zsession === session) this.zsession = null
    })
    try {
      if (session.type === 'receive') await this.zmodemReceive(session)
      else await this.zmodemSend(session)
    } catch (error) {
      this.note(tr('zmodemFailed', { message: error instanceof Error ? error.message : String(error) }))
      try {
        session.abort()
      } catch {
        /* ended */
      }
      if (this.zsession === session) this.zsession = null
    }
  }

  /** Remote ran `sz`: save every offered file into a chosen folder. */
  private async zmodemReceive(session: Zmodem.Session): Promise<void> {
    const dir = await this.side.pickDirectory()
    if (!dir) {
      session.abort()
      this.zsession = null
      this.note(tr('zmodemCanceled'))
      return
    }
    session.on('offer', (xfer: Zmodem.Transfer) => {
      const details = xfer.get_details()
      const name = path.basename(String(details.name || 'file').replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_') || 'file'
      const target = path.join(dir, name)
      const out = createWriteStream(target)
      this.note(tr('zmodemReceiving', { name, size: details.size ?? 0 }))
      xfer.on('input', (payload: Uint8Array) => out.write(Buffer.from(payload)))
      void xfer.accept().then(() => {
        out.end()
        this.note(tr('zmodemSaved', { name: target }))
      }, () => out.destroy())
    })
    session.start()
  }

  /** Remote ran `rz`: offer files picked locally, one after another. */
  private async zmodemSend(session: Zmodem.Session): Promise<void> {
    const files = await this.side.pickFiles()
    if (!files?.length) {
      session.close().catch(() => undefined)
      this.zsession = null
      this.note(tr('zmodemCanceled'))
      return
    }
    const stats = await Promise.all(files.map((file) => fs.stat(file)))
    let remaining = stats.reduce((sum, stat) => sum + stat.size, 0)
    for (let i = 0; i < files.length; i += 1) {
      if (session.aborted()) throw new Error('aborted')
      const stat = stats[i]
      if (!stat.isFile()) continue
      const name = path.basename(files[i])
      const xfer = await session.send_offer({ name, size: stat.size, mtime: stat.mtime, files_remaining: files.length - i, bytes_remaining: remaining })
      remaining -= stat.size
      if (!xfer) {
        this.note(tr('zmodemSkipped', { name }))
        continue
      }
      this.note(tr('zmodemSending', { name, size: stat.size }))
      for await (const chunk of createReadStream(files[i], { highWaterMark: CHUNK })) {
        if (session.aborted()) throw new Error('aborted')
        xfer.send(new Uint8Array(chunk as Buffer))
      }
      await xfer.end()
    }
    await session.close()
    this.note(tr('zmodemDone'))
  }
}
