import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Importers expand ~ and Include relative to the home directory.
const home = mkdtempSync(join(tmpdir(), 'mys-home-'))
vi.mock('node:os', async (original) => ({ ...(await original<typeof import('node:os')>()), homedir: () => home }))

const { importMobaXterm, importPuttyReg, importSshConfig } = await import('../src/main/importers')
const fixtures = join(__dirname, 'fixtures')
const regFile = join(home, 'putty.reg')

beforeAll(() => {
  cpSync(join(fixtures, 'ssh'), join(home, '.ssh'), { recursive: true })
  // regedit writes UTF-16LE with a BOM and CRLF line ends.
  const text = readFileSync(join(fixtures, 'putty.reg.txt'), 'utf8').replace(/\n/g, '\r\n')
  writeFileSync(regFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
})

describe('OpenSSH config', () => {
  it('reads concrete hosts with first-match-wins options, Include and forwards', async () => {
    expect(homedir()).toBe(home)
    const drafts = await importSshConfig(join(home, '.ssh', 'config'))
    const by = (alias: string) => drafts.find((d) => d.alias === alias)
    expect(drafts.map((d) => d.alias).sort()).toEqual(['admin@gw.example.com:2200', 'bastion', 'db', 'included', 'web-1'])
    expect(by('included')?.host).toBe('inc.example.com')
    expect(by('bastion')).toMatchObject({ host: 'bastion.example.com', username: 'ops', port: 2222, privateKeyPath: join(home, '.ssh', 'id_ed25519') })
    expect(by('web-1')).toMatchObject({ username: 'deploy', agentForward: true, jumpAlias: 'bastion' })
    expect(by('db')?.username).toBe('fallback')
    expect(by('web-1')?.tunnels).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'local', listenPort: 8080, targetHost: '127.0.0.1', targetPort: 80 }),
      expect.objectContaining({ mode: 'dynamic', listenPort: 1080 }),
    ]))
    expect(by('db')?.tunnels).toEqual([expect.objectContaining({ mode: 'remote', listenPort: 9000, targetHost: 'localhost', targetPort: 9000 })])
  })

  it('turns a ProxyJump chain into hops ending at the last one', async () => {
    const drafts = await importSshConfig(join(home, '.ssh', 'config'))
    expect(drafts.find((d) => d.alias === 'db')?.jumpAlias).toBe('bastion')
    expect(drafts.find((d) => d.alias === 'admin@gw.example.com:2200')).toMatchObject({ host: 'gw.example.com', port: 2200, username: 'admin' })
  })
})

describe('PuTTY .reg export', () => {
  it('decodes UTF-16, skips defaults and maps ssh and serial sessions', async () => {
    const drafts = await importPuttyReg(regFile)
    expect(drafts.map((d) => d.name).sort()).toEqual(['Console', 'My Router'])
    const router = drafts.find((d) => d.name === 'My Router')
    expect(router).toMatchObject({ host: '192.168.1.1', username: 'admin', port: 22, privateKeyPath: 'C:\\Users\\me\\key.ppk', agentForward: true })
    expect(router?.tunnels?.map((t) => t.mode).sort()).toEqual(['dynamic', 'local', 'remote'])
    expect(drafts.find((d) => d.name === 'Console')).toMatchObject({ protocol: 'serial', serialPath: 'COM3', baudRate: 9600, parity: 'even', stopBits: 2 })
  })
})

describe('MobaXterm bookmarks', () => {
  it('maps session types and folders, skipping unsupported ones', async () => {
    const drafts = await importMobaXterm(join(fixtures, 'sessions.mxtsessions'))
    expect(drafts.find((d) => d.name === 'prod-web')).toMatchObject({ protocol: 'ssh', host: '10.1.1.5', port: 22, username: 'root' })
    expect(drafts.find((d) => d.name === 'win-box')?.protocol).toBe('rdp')
    expect(drafts.find((d) => d.name === 'acme-sftp')).toMatchObject({ protocol: 'sftp', folder: ['MobaXterm', 'Clients', 'Acme'] })
    expect(drafts.some((d) => d.name === 'acme-xdmcp')).toBe(false)
  })
})
