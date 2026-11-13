import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HubEvent, TransferInfo } from '../src/shared/types'
import { makeHub, until } from './helpers/hub'
import { listen, targetServer } from './helpers/servers'

const remoteRoot = mkdtempSync(join(tmpdir(), 'mys-remote-'))
const localRoot = mkdtempSync(join(tmpdir(), 'mys-local-'))
// ~3 ms per 32 KB SFTP request keeps a 3 MB file in flight long enough to pause it.
const target = targetServer({ root: remoteRoot, ioDelayMs: 3 })
let port = 0

beforeAll(async () => {
  port = await listen(target.server as never)
})
afterAll(() => target.server.close())

const digest = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex')

async function connect(id: string) {
  const ctx = makeHub()
  const result = await ctx.hub.open({ instanceId: id, protocol: 'sftp', host: '127.0.0.1', port, username: 'u', password: 'pw', cols: 80, rows: 24, useAgent: false })
  expect(result).toEqual({ ok: true })
  const latest = (): TransferInfo[] => {
    const last = [...ctx.events].reverse().find((e): e is Extract<HubEvent, { type: 'transfers' }> => e.type === 'transfers' && e.connId === id)
    return last?.items ?? []
  }
  const runningCounts = () => ctx.events
    .filter((e): e is Extract<HubEvent, { type: 'transfers' }> => e.type === 'transfers' && e.connId === id)
    .map((e) => e.items.filter((item) => item.state === 'running').length)
  return { ...ctx, latest, runningCounts }
}

describe('transfer queue over SFTP', () => {
  it('pauses an upload mid-file and resumes it to an identical copy', async () => {
    const source = join(localRoot, 'big.bin')
    await fs.writeFile(source, randomBytes(3 * 1024 * 1024))
    const { hub, latest } = await connect('xfer-conn-001')
    await hub.filesUpload('xfer-conn-001', '/', [source])
    await until(() => (latest()[0]?.transferred ?? 0) > 256 * 1024)
    const id = latest()[0].id
    hub.transfers.pause(id)
    await until(() => latest()[0]?.state === 'paused')
    const paused = latest()[0]
    expect(paused.transferred).toBeGreaterThan(0)
    expect(paused.transferred).toBeLessThan(paused.size)
    hub.transfers.resume(id)
    await until(() => latest()[0]?.state === 'done', 20_000)
    expect(await digest(join(remoteRoot, 'big.bin'))).toBe(await digest(source))
    hub.dispose()
  })

  it('cancels a running download and removes the partial file', async () => {
    await fs.writeFile(join(remoteRoot, 'down.bin'), randomBytes(3 * 1024 * 1024))
    const dest = join(localRoot, 'down.bin')
    const { hub, latest } = await connect('xfer-conn-002')
    await hub.filesDownload('xfer-conn-002', '/down.bin', dest, false)
    await until(() => (latest()[0]?.transferred ?? 0) > 128 * 1024)
    expect(latest()[0].size).toBe(3 * 1024 * 1024)
    hub.transfers.cancel(latest()[0].id)
    await until(() => latest()[0]?.state === 'canceled')
    await until(() => !existsSync(dest))
    hub.transfers.clear('xfer-conn-002')
    await until(() => latest().length === 0)
    hub.dispose()
  })

  it('expands a folder into one job per file and runs them one at a time', async () => {
    const folder = join(localRoot, 'project')
    await fs.mkdir(join(folder, 'src'), { recursive: true })
    await fs.writeFile(join(folder, 'a.txt'), 'alpha')
    await fs.writeFile(join(folder, 'src', 'b.txt'), 'beta')
    await fs.writeFile(join(folder, 'src', 'c.txt'), 'gamma')
    const { hub, latest, runningCounts } = await connect('xfer-conn-003')
    await hub.filesUpload('xfer-conn-003', '/', [folder])
    await until(() => latest().length === 3 && latest().every((item) => item.state === 'done'))
    expect(Math.max(...runningCounts())).toBeLessThanOrEqual(1)
    expect(await fs.readFile(join(remoteRoot, 'project', 'src', 'c.txt'), 'utf8')).toBe('gamma')

    const back = join(localRoot, 'project-copy')
    await hub.filesDownload('xfer-conn-003', '/project', back, true)
    await until(() => latest().length === 6 && latest().every((item) => item.state === 'done'))
    expect(await fs.readFile(join(back, 'src', 'b.txt'), 'utf8')).toBe('beta')
    hub.dispose()
  })

  it('drops queued work when the connection closes', async () => {
    const { hub, latest } = await connect('xfer-conn-004')
    await fs.writeFile(join(localRoot, 'one.bin'), randomBytes(2 * 1024 * 1024))
    await fs.writeFile(join(localRoot, 'two.bin'), randomBytes(1024))
    await hub.filesUpload('xfer-conn-004', '/', [join(localRoot, 'one.bin'), join(localRoot, 'two.bin')])
    await until(() => latest().some((item) => item.state === 'running'))
    hub.close('xfer-conn-004')
    expect(hub.transfers.list('xfer-conn-004')).toEqual([])
    hub.dispose()
  })
})
