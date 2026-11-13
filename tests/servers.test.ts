import { Client as FtpClient } from 'basic-ftp'
import dgram from 'node:dgram'
import { mkdtempSync, promises as fs, symlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalServers } from '../src/main/servers'

const root = mkdtempSync(join(tmpdir(), 'mys-share-'))
const outside = mkdtempSync(join(tmpdir(), 'mys-outside-'))
writeFileSync(join(root, 'hello.txt'), 'hello world\n')
writeFileSync(join(outside, 'secret.txt'), 'top secret\n')
symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'))
const firmware = Buffer.alloc(1500, 7)
writeFileSync(join(root, 'fw.bin'), firmware)

const servers = new LocalServers(() => undefined)
afterEach(() => servers.stopAll())

function freePort(udp = false): Promise<number> {
  return new Promise((resolve) => {
    if (udp) {
      const sock = dgram.createSocket('udp4').bind(0, '127.0.0.1', () => {
        const { port } = sock.address()
        sock.close(() => resolve(port))
      })
      return
    }
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

describe('HTTP server', () => {
  it('lists and serves files, refuses traversal and symlinks out of the root', async () => {
    const port = await freePort()
    await servers.start('http', { root, port, lanAccess: false, allowWrite: false })
    const base = `http://127.0.0.1:${port}`
    const listing = await (await fetch(`${base}/`)).text()
    expect(listing).toContain('hello.txt')
    expect(await (await fetch(`${base}/hello.txt`)).text()).toBe('hello world\n')
    expect((await fetch(`${base}/escape.txt`)).status).toBe(404)
    expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404)
    expect((await fetch(`${base}/hello.txt`, { method: 'POST' })).status).toBe(405)
  })
})

describe('TFTP server', () => {
  /** Minimal RFC 1350 client: RRQ, ACK every block. */
  function tftpGet(port: number, file: string): Promise<Buffer | string> {
    return new Promise((resolve) => {
      const sock = dgram.createSocket('udp4')
      const parts: Buffer[] = []
      sock.on('message', (msg, peer) => {
        const op = msg.readUInt16BE(0)
        if (op === 5) {
          sock.close()
          resolve(`error ${msg.readUInt16BE(2)}`)
          return
        }
        const block = msg.readUInt16BE(2)
        parts.push(msg.subarray(4))
        sock.send(Buffer.from([0, 4, block >> 8, block & 255]), peer.port, peer.address)
        if (msg.length - 4 < 512) {
          sock.close()
          resolve(Buffer.concat(parts))
        }
      })
      sock.send(Buffer.concat([Buffer.from([0, 1]), Buffer.from(`${file}\0octet\0`)]), port, '127.0.0.1')
    })
  }

  it('serves a multi-block file and rejects escapes and uploads when read-only', async () => {
    const port = await freePort(true)
    await servers.start('tftp', { root, port, lanAccess: false, allowWrite: false })
    expect(await tftpGet(port, 'fw.bin')).toEqual(firmware)
    expect(await tftpGet(port, '../' + join(outside, 'secret.txt'))).toBe('error 1')
    expect(await tftpGet(port, 'escape.txt')).toBe('error 1')
    const refused = await new Promise<number>((resolve) => {
      const sock = dgram.createSocket('udp4')
      sock.on('message', (msg) => { sock.close(); resolve(msg.readUInt16BE(0)) })
      sock.send(Buffer.concat([Buffer.from([0, 2]), Buffer.from('new.bin\0octet\0')]), port, '127.0.0.1')
    })
    expect(refused).toBe(5)
  })
})

describe('FTP server', () => {
  async function connect(port: number, user = 'anonymous', password = 'guest') {
    const client = new FtpClient(10_000)
    await client.access({ host: '127.0.0.1', port, user, password })
    return client
  }
  const read = async (client: FtpClient, file: string) => {
    const chunks: Buffer[] = []
    await client.downloadTo(new Writable({ write(chunk, _e, cb) { chunks.push(Buffer.from(chunk)); cb() } }), file)
    return Buffer.concat(chunks).toString()
  }

  it('lets anonymous users list and download but not upload by default', async () => {
    const port = await freePort()
    await servers.start('ftp', { root, port, lanAccess: false, allowWrite: false })
    const client = await connect(port)
    expect((await client.list()).map((item) => item.name)).toContain('hello.txt')
    expect(await read(client, 'hello.txt')).toBe('hello world\n')
    await expect(read(client, 'escape.txt')).rejects.toThrow()
    await expect(client.cd('../../..')).resolves.toBeTruthy()
    expect(await client.pwd()).toBe('/')
    await expect(client.uploadFrom(Readable.from(['x']), 'up.txt')).rejects.toThrow()
    client.close()
  })

  it('requires the configured user and allows writes when enabled', async () => {
    const port = await freePort()
    await servers.start('ftp', { root, port, lanAccess: false, allowWrite: true, user: 'mys', password: 'pw' })
    await expect(connect(port)).rejects.toThrow()
    const client = await connect(port, 'mys', 'pw')
    await client.uploadFrom(Readable.from(['uploaded\n']), 'up.txt')
    expect(await fs.readFile(join(root, 'up.txt'), 'utf8')).toBe('uploaded\n')
    await client.remove('up.txt')
    client.close()
  })
})
