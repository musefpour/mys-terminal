import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, promises as fs, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Zmodem from 'zmodem.js'
import { Hub } from '../src/main/hub'
import { TerminalTransfer } from '../src/main/termxfer'
import type { HubEvent } from '../src/shared/types'
import { until } from './helpers/hub'

const later = (fn: () => void) => setImmediate(fn)
// zmodem.js exposes Header at runtime; the local typings only cover what the app uses.
const ZRQINIT = () => Buffer.from((Zmodem as unknown as { Header: { build(name: string): { to_hex(): number[] } } }).Header.build('ZRQINIT').to_hex())

describe('ZMODEM', () => {
  it('receives a file the remote sends with sz', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mys-zrecv-'))
    const payload = randomBytes(200_000)
    const screen: Buffer[] = []
    let remote: Zmodem.Sentry
    const ours = new TerminalTransfer({
      toTerminal: (data) => screen.push(data),
      toServer: (data) => later(() => remote.consume(Uint8Array.from(data))),
      pickFiles: async () => undefined,
      pickDirectory: async () => dir,
      columns: 80,
      windowsShell: false,
    })
    // Remote "sz": answers our ZRINIT with an offer for one file.
    remote = new Zmodem.Sentry({
      to_terminal: () => undefined,
      sender: (octets) => later(() => ours.output(Buffer.from(octets))),
      on_detect: (detection) => {
        const session = detection.confirm()
        void session.send_offer({ name: '../evil/../hello.bin', size: payload.length, mtime: new Date(), files_remaining: 1, bytes_remaining: payload.length }).then(async (xfer) => {
          xfer!.send(new Uint8Array(payload))
          await xfer!.end()
          await session.close()
        })
      },
      on_retract: () => undefined,
    })
    ours.output(Buffer.concat([Buffer.from('rz\r'), ZRQINIT()]))
    await until(() => existsSync(join(dir, 'hello.bin')) && readFileSync(join(dir, 'hello.bin')).length === payload.length)
    expect(readFileSync(join(dir, 'hello.bin')).equals(payload)).toBe(true)
    expect(Buffer.concat(screen).toString()).toContain('hello.bin')
    await until(() => !ours.busy)
  })

  it('sends a picked file when the remote runs rz', async () => {
    const source = join(mkdtempSync(join(tmpdir(), 'mys-zsend-')), 'upload.bin')
    const payload = randomBytes(150_000)
    await fs.writeFile(source, payload)
    const received: Buffer[] = []
    let done = false
    let remote: Zmodem.Sentry
    const ours = new TerminalTransfer({
      toTerminal: () => undefined,
      toServer: (data) => later(() => remote.consume(Uint8Array.from(data))),
      pickFiles: async () => [source],
      pickDirectory: async () => undefined,
      columns: 80,
      windowsShell: false,
    })
    // Remote "rz": a receive session that accepts every offer.
    remote = new Zmodem.Sentry({
      to_terminal: () => undefined,
      sender: (octets) => later(() => ours.output(Buffer.from(octets))),
      on_detect: (detection) => {
        const session = detection.confirm()
        session.on('offer', (xfer) => {
          xfer.on('input', (chunk) => received.push(Buffer.from(chunk)))
          void xfer.accept()
        })
        session.on('session_end', () => { done = true })
        session.start()
      },
      on_retract: () => undefined,
    })
    remote.consume(Uint8Array.from(ZRQINIT()))
    await until(() => done)
    expect(Buffer.concat(received).equals(payload)).toBe(true)
  })

  it('passes ordinary output straight through', () => {
    const screen: Buffer[] = []
    const ours = new TerminalTransfer({ toTerminal: (d) => screen.push(d), toServer: () => undefined, pickFiles: async () => undefined, pickDirectory: async () => undefined, columns: 80, windowsShell: false })
    ours.output(Buffer.from('ls -la\r\ntotal 0\r\n', 'utf8'))
    expect(Buffer.concat(screen).toString()).toBe('ls -la\r\ntotal 0\r\n')
  })
})

describe('trzsz through a real shell', () => {
  const tool = (name: string) => join(__dirname, '..', 'node_modules', 'trzsz', 'lib', `${name}.js`)
  const store = { data: { sessions: [], settings: { logAll: false, recordAll: false } }, secretsFor: () => ({}), recordSessionError: async () => undefined, recordSessionUsage: async () => undefined, addConnectionLog: async () => undefined, logsDir: () => tmpdir(), recordingsDir: () => tmpdir() }

  function makeHub(pickers: { files: string[]; dir: string }) {
    const events: HubEvent[] = []
    const hub = new Hub(store as never, () => ({ isDestroyed: () => false, send: (_c: string, e: HubEvent) => events.push(e) }) as never, {
      files: async () => pickers.files,
      directory: async () => pickers.dir,
    })
    const screen = () => events.filter((e): e is Extract<HubEvent, { type: 'data' }> => e.type === 'data').map((e) => e.data).join('')
    return { hub, screen }
  }

  it('downloads with tsz into the chosen folder', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'mys-tsz-remote-'))
    const local = mkdtempSync(join(tmpdir(), 'mys-tsz-local-'))
    const payload = randomBytes(300_000)
    await fs.writeFile(join(remote, 'report.bin'), payload)
    const { hub, screen } = makeHub({ files: [], dir: local })
    const result = await hub.open({ instanceId: 'tsz-conn-0001', protocol: 'local', shell: '/bin/sh', cwd: remote, startupCommand: `"${process.execPath}" "${tool('tsz')}" report.bin`, cols: 100, rows: 30 })
    expect(result).toEqual({ ok: true })
    await until(() => existsSync(join(local, 'report.bin')) && readFileSync(join(local, 'report.bin')).length === payload.length, 20_000)
    expect(readFileSync(join(local, 'report.bin')).equals(payload)).toBe(true)
    expect(screen()).toContain('report.bin')
    hub.dispose()
  })

  it('uploads with trz from a picked file', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'mys-trz-remote-'))
    const source = join(mkdtempSync(join(tmpdir(), 'mys-trz-local-')), 'notes.txt')
    await fs.writeFile(source, 'uploaded through trzsz\n')
    const { hub } = makeHub({ files: [source], dir: '' })
    await hub.open({ instanceId: 'trz-conn-0001', protocol: 'local', shell: '/bin/sh', cwd: remote, startupCommand: `"${process.execPath}" "${tool('trz')}"`, cols: 100, rows: 30 })
    await until(() => existsSync(join(remote, 'notes.txt')) && readFileSync(join(remote, 'notes.txt'), 'utf8').includes('trzsz'), 20_000)
    hub.dispose()
  })
})
