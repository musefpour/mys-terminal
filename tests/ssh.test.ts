import { mkdtempSync } from 'node:fs'
import net from 'node:net'
import WebSocket from 'ws'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HubEvent, OpenSpec } from '../src/shared/types'
import { makeHub, sleep, sshSession, until } from './helpers/hub'
import { httpProxy, jumpServer, listen, socksProxy, targetServer } from './helpers/servers'

const target = targetServer({ root: mkdtempSync(join(tmpdir(), 'mys-sftp-')) })
const jump = jumpServer()
const socks = socksProxy()
const http = httpProxy()
let targetPort = 0
let jumpPort = 0
let socksPort = 0
let httpPort = 0

beforeAll(async () => {
  targetPort = await listen(target.server as never)
  jumpPort = await listen(jump.server as never)
  socksPort = await listen(socks.server)
  httpPort = await listen(http.server)
})

afterAll(() => {
  target.server.close()
  jump.server.close()
  socks.server.close()
  http.server.close()
})

function setup() {
  const sessions = [
    sshSession('hop-1', jumpPort, { name: 'Hop' }),
    sshSession('loop-a', jumpPort, { jumpSessionId: 'loop-b' }),
    sshSession('loop-b', jumpPort, { jumpSessionId: 'loop-a' }),
  ]
  const ctx = makeHub(sessions, { 'hop-1': { password: 'hp' }, 'loop-a': { password: 'hp' }, 'loop-b': { password: 'hp' } })
  const base: Omit<OpenSpec, 'instanceId'> = { protocol: 'ssh', host: '127.0.0.1', port: targetPort, username: 'u', password: 'pw', cols: 80, rows: 24, useAgent: false }
  const text = (id: string) => ctx.events.filter((e): e is Extract<HubEvent, { type: 'data' }> => e.type === 'data' && e.instanceId === id).map((e) => e.data).join('')
  const exitOf = (id: string) => ctx.events.find((e): e is Extract<HubEvent, { type: 'exit' }> => e.type === 'exit' && e.instanceId === id)
  return { ...ctx, base, text, exitOf }
}

describe('SSH routing', () => {
  it('connects through a saved jump host and reports the remote shell PID', async () => {
    const { hub, base, text } = setup()
    const result = await hub.open({ ...base, instanceId: 'jump-conn-01', jumpSessionId: 'hop-1' })
    expect(result).toEqual({ ok: true })
    expect(jump.state.forwards).toBeGreaterThan(0)
    await until(() => text('jump-conn-01').includes('hello from target'))
    expect(text('jump-conn-01')).not.toContain('7337')
    expect(hub.get('jump-conn-01')?.remotePid).toBe(4242)
    expect(await hub.filesTerminalCwd('jump-conn-01')).toBe('/srv/data')
    hub.dispose()
  })

  it('tells a clean shell exit apart from a dropped link', async () => {
    const { hub, base, exitOf } = setup()
    await hub.open({ ...base, instanceId: 'exit-conn-01' })
    await until(() => target.shells.length > 0)
    const shell = target.shells.pop()!
    shell.exit(0)
    shell.end()
    await until(() => Boolean(exitOf('exit-conn-01')))
    expect(exitOf('exit-conn-01')?.reason).toBe('ended')

    await hub.open({ ...base, instanceId: 'drop-conn-01' })
    const ssh = hub.get('drop-conn-01')?.ssh as unknown as { _sock: { destroy: () => void } }
    ssh._sock.destroy()
    await until(() => Boolean(exitOf('drop-conn-01')))
    expect(exitOf('drop-conn-01')?.reason).toBe('lost')
    hub.dispose()
  })

  it('goes through SOCKS5 with credentials and rejects a wrong password', async () => {
    const { hub, base } = setup()
    const proxy = { proxyType: 'socks5' as const, proxyHost: '127.0.0.1', proxyPort: socksPort, proxyUser: 'su' }
    expect(await hub.open({ ...base, ...proxy, instanceId: 'socks-conn-1', proxyPassword: 'sp' })).toEqual({ ok: true })
    expect(socks.state.used).toBe(1)
    const bad = await hub.open({ ...base, ...proxy, instanceId: 'socks-conn-2', proxyPassword: 'nope' })
    expect(bad.ok).toBe(false)
    expect(bad.ok ? '' : bad.message).toMatch(/SOCKS authentication rejected/)
    hub.dispose()
  })

  it('goes through an HTTP CONNECT proxy', async () => {
    const { hub, base } = setup()
    expect(await hub.open({ ...base, instanceId: 'http-conn-01', proxyType: 'http', proxyHost: '127.0.0.1', proxyPort: httpPort })).toEqual({ ok: true })
    expect(http.state.used).toBe(1)
    hub.dispose()
  })

  it('rejects jump loops and missing jump sessions', async () => {
    const { hub, base } = setup()
    expect((await hub.open({ ...base, instanceId: 'loop-conn-01', jumpSessionId: 'loop-a' })).ok).toBe(false)
    expect((await hub.open({ ...base, instanceId: 'miss-conn-01', jumpSessionId: 'missing' })).ok).toBe(false)
    hub.dispose()
  })

  it('flags a changed jump host key and accepts it when forced', async () => {
    const { hub, base, known } = setup()
    known[`127.0.0.1:${jumpPort}`] = 'not-the-real-key'
    const changed = await hub.open({ ...base, instanceId: 'hkey-conn-01', jumpSessionId: 'hop-1' })
    expect(changed.ok ? '' : changed.code).toBe('hostkey')
    expect(await hub.open({ ...base, instanceId: 'hkey-conn-02', jumpSessionId: 'hop-1', forceHostKey: true })).toEqual({ ok: true })
    hub.dispose()
  })
})

describe('desktop through SSH', () => {
  it('bridges noVNC over a tunnel session to the desktop host', async () => {
    // Stand-in VNC server: echoes whatever arrives.
    const echo = net.createServer((socket) => socket.pipe(socket))
    const echoPort = await listen(echo)
    const { hub } = setup()
    const before = jump.state.forwards
    const result = await hub.open({ instanceId: 'vnc-tunnel-01', protocol: 'vnc', host: '127.0.0.1', port: echoPort, jumpSessionId: 'hop-1', cols: 80, rows: 24 })
    expect(result.ok).toBe(true)
    const ws = new WebSocket(`ws://127.0.0.1:${result.ok ? result.vncListen : 0}`)
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once('open', () => ws.send(Buffer.from('RFB 003.008\n')))
      ws.once('message', (data) => resolve(String(data)))
      ws.once('error', reject)
    })
    expect(reply).toBe('RFB 003.008\n')
    expect(jump.state.forwards).toBe(before + 1)
    ws.close()
    hub.dispose()
    echo.close()
  })
})

describe('server monitor', () => {
  it('turns two /proc samples into CPU, memory, disk and network figures', async () => {
    let tick = 0
    const sample = () => {
      tick += 1
      const busy = tick * 100
      return [
        `cpu  ${busy} 0 0 ${tick * 300} 0 0 0 0 0 0`,
        '@@',
        'MemTotal:        8000000 kB',
        'MemAvailable:    2000000 kB',
        '@@',
        '/dev/sda1 100000000 25000000 75000000 25% /',
        '@@',
        '3600.5 7000.1',
        '@@',
        '0.42 0.30 0.20 1/100 999',
        '@@',
        'Inter-|   Receive',
        ' face |bytes packets errs drop fifo frame compressed multicast|bytes',
        `  eth0: ${tick * 30000} 0 0 0 0 0 0 0 ${tick * 3000} 0 0 0 0 0 0 0`,
        '    lo: 999999 0 0 0 0 0 0 0 999999 0 0 0 0 0 0 0',
        '',
      ].join('\n')
    }
    const local = targetServer({ root: tmpdir(), monitor: sample })
    const port = await listen(local.server as never)
    const { hub, events } = makeHub()
    await hub.open({ instanceId: 'mon-conn-0001', protocol: 'ssh', host: '127.0.0.1', port, username: 'u', password: 'pw', cols: 80, rows: 24, useAgent: false })
    hub.monitorStart('mon-conn-0001')
    const stats = () => events.filter((e): e is Extract<HubEvent, { type: 'monitor' }> => e.type === 'monitor').map((e) => e.stats)
    await until(() => stats().length >= 2, 10_000)
    const [first, second] = stats()
    expect(first.cpu).toBeNull()
    expect(second.cpu).toBe(25)
    expect(second.memTotal).toBe(8000000 * 1024)
    expect(second.memUsed).toBe(6000000 * 1024)
    expect(second.diskTotal).toBe(100000000 * 1024)
    expect(second.diskUsed).toBe(25000000 * 1024)
    expect(second.uptime).toBe(3601)
    expect(second.load).toBe(0.42)
    expect(second.rxRate).toBeGreaterThan(0)
    hub.monitorStop('mon-conn-0001')
    const count = stats().length
    await sleep(3500)
    expect(stats().length).toBe(count)
    hub.dispose()
    local.server.close()
  })
})
