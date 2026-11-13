import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HubEvent } from '../src/shared/types'
import { makeHub, until } from './helpers/hub'

// Real OpenSSH: a non-root sshd that trusts only a throwaway user CA.
const SSHD = '/usr/sbin/sshd'
const available = process.platform !== 'win32' && existsSync(SSHD) && existsSync('/usr/bin/ssh-keygen')
const dir = mkdtempSync(join(tmpdir(), 'mys-sshd-'))
const user = userInfo().username
let sshd: ChildProcess | null = null
let sshdLog = ''
let port = 0

const keygen = (...args: string[]) => execFileSync('ssh-keygen', ['-q', ...args], { cwd: dir, stdio: 'ignore' })

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = server.address() as net.AddressInfo
      server.close(() => resolve(p))
    })
  })
}

async function waitForPort(target: number, timeout = 10_000): Promise<void> {
  const end = Date.now() + timeout
  for (;;) {
    const up = await new Promise<boolean>((resolve) => {
      const probe = net.connect(target, '127.0.0.1')
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { probe.destroy(); resolve(false) })
    })
    if (up) return
    if (Date.now() > end) throw new Error(`sshd did not start:\n${sshdLog}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.skipIf(!available)('OpenSSH user certificates', () => {
  beforeAll(async () => {
    keygen('-t', 'ed25519', '-f', 'host', '-N', '')
    keygen('-t', 'ed25519', '-f', 'ca', '-N', '')
    for (const [name, type] of [['ed', 'ed25519'], ['ec', 'ecdsa'], ['rsa', 'rsa']]) {
      keygen('-t', type, '-f', name, '-N', '')
      keygen('-s', 'ca', '-I', `mys-${name}`, '-n', user, '-V', '+1h', `${name}.pub`)
    }
    keygen('-t', 'ed25519', '-f', 'plain', '-N', '')
    keygen('-t', 'ed25519', '-f', 'other', '-N', '')
    port = await freePort()
    writeFileSync(join(dir, 'cfg'), [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(dir, 'host')}`,
      `PidFile ${join(dir, 'sshd.pid')}`,
      'AuthorizedKeysFile none',
      `TrustedUserCAKeys ${join(dir, 'ca.pub')}`,
      'PubkeyAuthentication yes',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'UsePAM no',
      'StrictModes no',
      '',
    ].join('\n'))
    sshd = spawn(SSHD, ['-D', '-e', '-f', join(dir, 'cfg')], { stdio: ['ignore', 'ignore', 'pipe'] })
    sshd.stderr?.on('data', (chunk: Buffer) => { sshdLog += chunk.toString() })
    await waitForPort(port)
  })

  afterAll(() => {
    sshd?.kill()
  })

  async function login(id: string, key: string, certificatePath?: string) {
    const ctx = makeHub()
    const result = await ctx.hub.open({ instanceId: id, protocol: 'ssh', host: '127.0.0.1', port, username: user, privateKeyPath: join(dir, key), certificatePath, cols: 80, rows: 24, useAgent: false, forceHostKey: true })
    return { ...ctx, result }
  }

  it.each([
    ['ed25519', 'ed'],
    ['ECDSA', 'ec'],
    ['RSA (rsa-sha2-512-cert)', 'rsa'],
  ])('logs in with a %s certificate found next to the key', async (_label, key) => {
    const { hub, events, result } = await login(`cert-${key}-0001`, key)
    expect(result).toEqual({ ok: true })
    hub.write(`cert-${key}-0001`, 'echo MYS_$((6*7))\n')
    const output = () => events.filter((e): e is Extract<HubEvent, { type: 'data' }> => e.type === 'data').map((e) => e.data).join('')
    await until(() => output().includes('MYS_42'), 10_000)
    hub.dispose()
  })

  it('is refused for a key without a certificate', async () => {
    const { hub, result } = await login('cert-none-0001', 'plain')
    expect(result.ok ? 'ok' : result.code).toBe('auth')
    hub.dispose()
  })

  it('reports a certificate that belongs to another key', async () => {
    const { hub, result } = await login('cert-swap-0001', 'other', join(dir, 'ed-cert.pub'))
    expect(result.ok).toBe(false)
    hub.dispose()
  })
})
