import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { RecordingInfo } from '../shared/types'
import { tr } from './i18n'

interface Active {
  stream: WriteStream
  decoder: StringDecoder
  started: number
  path: string
}

const MAX_READ = 64 * 1024 * 1024

/**
 * Terminal output as asciicast v2 (.cast), playable here or with asciinema.
 * Only output is kept: typed passwords are never echoed, so they are never recorded.
 */
export class Recorder {
  private active = new Map<string, Active>()

  constructor(private dir: () => string, private now = () => Date.now()) {}

  isRecording(id: string): boolean {
    return this.active.has(id)
  }

  async start(id: string, meta: { title: string; cols: number; rows: number }): Promise<string> {
    const existing = this.active.get(id)
    if (existing) return existing.path
    await fs.mkdir(this.dir(), { recursive: true })
    const started = this.now()
    const stamp = new Date(started).toISOString().replace(/[:.]/g, '-')
    const safe = meta.title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'session'
    const file = path.join(this.dir(), `${stamp}_${safe}.cast`)
    const stream = createWriteStream(file, { flags: 'wx', mode: 0o600 })
    stream.on('error', () => this.active.delete(id))
    const header = { version: 2, width: meta.cols, height: meta.rows, timestamp: Math.floor(started / 1000), title: meta.title, env: { TERM: 'xterm-256color' } }
    stream.write(`${JSON.stringify(header)}\n`)
    this.active.set(id, { stream, decoder: new StringDecoder('utf8'), started, path: file })
    return file
  }

  output(id: string, chunk: Buffer): void {
    const rec = this.active.get(id)
    if (!rec) return
    // StringDecoder holds back a split UTF-8 sequence until the next chunk.
    const text = rec.decoder.write(chunk)
    if (text) rec.stream.write(`${JSON.stringify([this.elapsed(rec), 'o', text])}\n`)
  }

  resize(id: string, cols: number, rows: number): void {
    const rec = this.active.get(id)
    if (rec) rec.stream.write(`${JSON.stringify([this.elapsed(rec), 'r', `${cols}x${rows}`])}\n`)
  }

  stop(id: string): string | null {
    const rec = this.active.get(id)
    if (!rec) return null
    this.active.delete(id)
    const tail = rec.decoder.end()
    if (tail) rec.stream.write(`${JSON.stringify([this.elapsed(rec), 'o', tail])}\n`)
    rec.stream.end()
    return rec.path
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id)
  }

  async list(): Promise<RecordingInfo[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.dir())).filter((name) => name.endsWith('.cast'))
    } catch {
      return []
    }
    const out: RecordingInfo[] = []
    for (const name of names) {
      const file = path.join(this.dir(), name)
      try {
        const stat = await fs.stat(file)
        const header = await firstLine(file)
        const meta = JSON.parse(header) as { title?: string; timestamp?: number; width?: number; height?: number }
        out.push({
          path: file,
          name,
          title: String(meta.title || name),
          startedAt: (Number(meta.timestamp) || 0) * 1000 || stat.mtimeMs,
          size: stat.size,
          cols: Number(meta.width) || 80,
          rows: Number(meta.height) || 24,
          active: [...this.active.values()].some((rec) => rec.path === file),
        })
      } catch {
        /* not a cast file */
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }

  async read(file: string): Promise<string> {
    const target = this.inside(file)
    const stat = await fs.stat(target)
    if (stat.size > MAX_READ) throw new Error(tr('recordingTooLarge'))
    return fs.readFile(target, 'utf8')
  }

  async remove(file: string): Promise<void> {
    const target = this.inside(file)
    if ([...this.active.values()].some((rec) => rec.path === target)) throw new Error(tr('recordingBusy'))
    await fs.unlink(target)
  }

  /** Only files in the recordings folder may be read or deleted through IPC. */
  inside(file: string): string {
    const root = path.resolve(this.dir())
    const target = path.resolve(file)
    if (path.dirname(target) !== root || !target.endsWith('.cast')) throw new Error(tr('invalidPath'))
    return target
  }

  private elapsed(rec: Active): number {
    return Math.round(this.now() - rec.started) / 1000
  }
}

async function firstLine(file: string): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    const text = buf.subarray(0, bytesRead).toString('utf8')
    return text.split('\n')[0]
  } finally {
    await handle.close()
  }
}
