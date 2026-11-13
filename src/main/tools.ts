import { spawn, type ChildProcess } from 'node:child_process'
import { createSocket, type Socket as DgramSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { assertSafeHost, type ToolRequest } from '../shared/types'
import { explain, tr } from './i18n'

const COMMON_PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995, 1433, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017]

type Emit = (event: { type: 'tool'; runId: string; stream: 'stdout' | 'stderr' | 'done'; data?: string; code?: number }) => void

export class ToolRunner {
  private jobs = new Map<string, ChildProcess | DgramSocket>()

  constructor(private emit: Emit) {}

  cancel(runId: string): void {
    const job = this.jobs.get(runId)
    if (!job) return
    if ('kill' in job) job.kill()
    else job.close()
    this.jobs.delete(runId)
  }

  async run(request: ToolRequest): Promise<void> {
    let host = ''
    try {
      host = request.tool === 'wol' ? '' : assertSafeHost(request.host)
    } catch (error) {
      this.emit({ type: 'tool', runId: request.runId, stream: 'stderr', data: `${explain(error, 'invalidHost')}\n` })
      this.emit({ type: 'tool', runId: request.runId, stream: 'done', code: 1 })
      return
    }
    if (request.tool === 'ports') {
      await this.scan(request.runId, host)
      return
    }
    if (request.tool === 'wol') {
      await this.wol(request.runId, request.mac || request.host)
      return
    }
    if (request.tool === 'nslookup') {
      await this.nslookup(request.runId, host)
      return
    }

    const win = process.platform === 'win32'
    const binary = request.tool === 'ping' ? 'ping' : request.tool === 'traceroute' ? (win ? 'tracert' : 'traceroute') : 'whois'
    const args =
      request.tool === 'ping'
        ? [win ? '-n' : '-c', '5', host]
        : request.tool === 'traceroute'
          ? [win ? '-h' : '-m', '20', host]
          : [host]
    await this.spawn(request.runId, binary, args)
  }

  private spawn(runId: string, command: string, args: string[]): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      this.jobs.set(runId, child)
      const send = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        this.emit({ type: 'tool', runId, stream, data: chunk.toString('utf8') })
      }
      child.stdout?.on('data', (chunk: Buffer) => send('stdout', chunk))
      child.stderr?.on('data', (chunk: Buffer) => send('stderr', chunk))
      child.on('error', (error) => {
        this.emit({ type: 'tool', runId, stream: 'stderr', data: `${error.message}\n` })
        this.emit({ type: 'tool', runId, stream: 'done', code: 1 })
        this.jobs.delete(runId)
        resolve()
      })
      child.on('close', (code) => {
        this.emit({ type: 'tool', runId, stream: 'done', code: code ?? 0 })
        this.jobs.delete(runId)
        resolve()
      })
    })
  }

  private async nslookup(runId: string, host: string): Promise<void> {
    try {
      const v4 = await lookup(host, { all: true })
      const lines = v4.map((item) => `${item.address}  (${item.family === 6 ? 'AAAA' : 'A'})\n`).join('')
      this.emit({ type: 'tool', runId, stream: 'stdout', data: lines || tr('whoisEmpty') })
      this.emit({ type: 'tool', runId, stream: 'done', code: 0 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'tool', runId, stream: 'stderr', data: `${message}\n` })
      this.emit({ type: 'tool', runId, stream: 'done', code: 1 })
    }
  }

  private async scan(runId: string, host: string): Promise<void> {
    const lines: string[] = []
    await Promise.all(
      COMMON_PORTS.map(async (port) => {
        const open = await probe(host, port)
        lines.push(`${String(port).padStart(5, ' ')}  ${open ? tr('portOpen') : tr('portClosed')}\n`)
      }),
    )
    lines.sort()
    this.emit({ type: 'tool', runId, stream: 'stdout', data: lines.join('') })
    this.emit({ type: 'tool', runId, stream: 'done', code: 0 })
  }

  private wol(runId: string, mac: string): Promise<void> {
    const parts = mac.trim().split(/[:\-]/).map((part) => Number.parseInt(part, 16))
    if (parts.length !== 6 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      this.emit({ type: 'tool', runId, stream: 'stderr', data: tr('invalidMac') })
      this.emit({ type: 'tool', runId, stream: 'done', code: 1 })
      return Promise.resolve()
    }
    const packet = Buffer.alloc(6 + 16 * 6, 0xff)
    for (let i = 0; i < 16; i += 1) {
      for (let j = 0; j < 6; j += 1) packet[6 + i * 6 + j] = parts[j]
    }
    return new Promise((resolve) => {
      const socket = createSocket('udp4')
      this.jobs.set(runId, socket)
      socket.once('error', (error) => {
        this.emit({ type: 'tool', runId, stream: 'stderr', data: `${error.message}\n` })
        this.emit({ type: 'tool', runId, stream: 'done', code: 1 })
        this.jobs.delete(runId)
        resolve()
      })
      socket.bind(() => {
        socket.setBroadcast(true)
        socket.send(packet, 9, '255.255.255.255', (error) => {
          socket.close()
          this.jobs.delete(runId)
          if (error) {
            this.emit({ type: 'tool', runId, stream: 'stderr', data: `${error.message}\n` })
            this.emit({ type: 'tool', runId, stream: 'done', code: 1 })
          } else {
            this.emit({ type: 'tool', runId, stream: 'stdout', data: tr('wolSent', { mac }) })
            this.emit({ type: 'tool', runId, stream: 'done', code: 0 })
          }
          resolve()
        })
      })
    })
  }

  stopAll(): void {
    for (const id of this.jobs.keys()) this.cancel(id)
  }
}

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(800)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}
