import { existsSync, mkdtempSync, promises as fs, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandFor, parseTargets } from '../src/main/containers'
import { importSecureCrt } from '../src/main/importers'
import { createLive } from '../src/main/live'
import { Recorder } from '../src/main/recorder'
import { planSync } from '../src/main/sync'
import { Transfers } from '../src/main/transfers'
import { parseCast } from '../src/renderer/src/cast'
import { findHighlights, lineText } from '../src/renderer/src/highlight'
import { isMultiline, quotePath } from '../src/renderer/src/paste'
import { navSequence } from '../src/renderer/src/terminal-keys'
import { diffLines, pairRows } from '../src/shared/diff'
import type { OpenSpec, TransferInfo } from '../src/shared/types'
import { until } from './helpers/hub'

describe('session recording', () => {
  it('writes asciicast v2 that the player parses, keeping split UTF-8 intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mys-rec-'))
    let clock = 1_000_000
    const recorder = new Recorder(() => dir, () => clock)
    const file = await recorder.start('conn-1', { title: 'web01', cols: 100, rows: 30 })
    const smile = Buffer.from('سلام 🙂\r\n', 'utf8')
    recorder.output('conn-1', smile.subarray(0, 5))
    clock += 1500
    recorder.output('conn-1', smile.subarray(5))
    clock += 10_000
    recorder.resize('conn-1', 120, 40)
    recorder.output('conn-1', Buffer.from('done\r\n'))
    recorder.stop('conn-1')
    await until(() => existsSync(file) && readFileSync(file, 'utf8').includes('done'))
    const cast = parseCast(readFileSync(file, 'utf8'))
    expect(cast).toMatchObject({ cols: 100, rows: 30, title: 'web01' })
    expect(cast.events.filter((e) => e.kind === 'o').map((e) => e.data).join('')).toBe('سلام 🙂\r\ndone\r\n')
    // The 10 s pause is squeezed to the 2 s idle limit.
    expect(cast.duration).toBeCloseTo(3.5, 1)
    expect(cast.events.some((e) => e.kind === 'r' && e.data === '120x40')).toBe(true)
    expect((await recorder.list())[0]).toMatchObject({ title: 'web01', active: false })
  })

  it('only reads and deletes files inside the recordings folder', async () => {
    const recorder = new Recorder(() => mkdtempSync(join(tmpdir(), 'mys-rec-')))
    await expect(recorder.read('/etc/passwd')).rejects.toThrow()
    await expect(recorder.remove(join(tmpdir(), 'x.cast'))).rejects.toThrow()
  })
})

describe('line diff', () => {
  it('produces an edit script that rebuilds both sides', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\n'
    const b = 'zero\none\nthree\nfour\nFIVE\nsix\n'
    const ops = diffLines(a, b)!
    expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text).join('\n') + '\n').toBe(a)
    expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text).join('\n') + '\n').toBe(b)
    expect(ops.filter((o) => o.kind !== 'same')).toHaveLength(5)
  })

  it('handles identical, empty and CRLF input', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')!.every((o) => o.kind === 'same')).toBe(true)
    expect(diffLines('', 'x\n')).toEqual([{ kind: 'add', text: 'x', b: 1 }])
    expect(diffLines('', '')).toEqual([])
  })

  it('folds long unchanged runs into context', () => {
    const a = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const b = a.replace('line 50', 'changed 50')
    const rows = pairRows(diffLines(a, b)!)
    expect(rows.length).toBeLessThan(15)
    expect(rows.some((row) => row.kind === 'change' && row.left?.text === 'line 50' && row.right?.text === 'changed 50')).toBe(true)
  })
})

describe('terminal helpers', () => {
  it('maps keyword hits to cells, counting wide characters', () => {
    const cells = [...'錯x error'].map((ch) => ({ chars: ch, width: ch === '錯' ? 2 : 1 }))
    cells.splice(1, 0, { chars: '', width: 0 })
    const { text, column } = lineText(cells)
    const hits = findHighlights(text, column)
    expect(hits).toEqual([{ x: 4, width: 5, color: expect.any(String) }])
    expect(findHighlights('terror errorlevel', [...'terror errorlevel'].map((_, i) => i))).toEqual([])
  })

  it('colors the parts of docker ps, prompts and Persian output that matter', () => {
    const tones = (line: string, colored: boolean[] = []) => {
      const column = [...line].map((_, i) => i)
      return findHighlights(line, column, undefined, colored).map((hit) => line.slice(hit.x, hit.x + hit.width))
    }
    const row = '002c9ddc0692   plakin-backend   "java -jar target/pl…"   About an hour ago   Up About an hour   0.0.0.0:1800->1000/tcp'
    expect(tones(row)).toEqual(['002c9ddc0692', '"java -jar target/pl…"', 'About an hour ago', 'Up', 'About an hour', '0.0.0.0:1800', '1000/tcp'])
    expect(tones('589391e74e20   usefpour-next:v.1.0.1   Restarting (1) 55 seconds ago')).toEqual(['589391e74e20', 'Restarting', '55 seconds ago'])
    expect(tones('postgres:15   Up 3 days (healthy)   5432/tcp')).toEqual(['Up', '3 days', 'healthy', '5432/tcp'])
    expect(tones('root@mahdi-virtual-machine:/home/mahdi/IdeaProjects# docker ps -a')).toEqual(['root', 'mahdi-virtual-machine', '/home/mahdi/IdeaProjects', '#'])
    expect(tones('اتصال با خطا مواجه شد')).toEqual(['خطا'])
    expect(tones('Exited (137) 2 hours ago')).toEqual(['Exited (137)', '2 hours ago'])
    // Text the program colored itself (git diff, ls --color) is never repainted.
    const line = ' 12 files changed, 1788 insertions(+), 189 deletions(-) error'
    expect(tones(line, [...line].map((_, i) => i < 56))).toEqual(['error'])
  })

  it('warns only for real multi-line pastes', () => {
    expect(isMultiline('ls -la\n')).toBe(false)
    expect(isMultiline('rm -rf /tmp/x\nreboot\n')).toBe(true)
  })

  it('quotes dropped paths for the target shell', () => {
    expect(quotePath('/Users/me/projects', 'posix')).toBe('/Users/me/projects')
    expect(quotePath('/Volumes/My Data/it\'s', 'posix')).toBe(`'/Volumes/My Data/it'\\''s'`)
    expect(quotePath('C:\\Program Files\\App', 'windows')).toBe('"C:\\Program Files\\App"')
    expect(quotePath('C:\\tools', 'windows')).toBe('C:\\tools')
  })
})

describe('container sessions', () => {
  const spec = (extra: Partial<OpenSpec>): OpenSpec => ({ instanceId: 'x', protocol: 'docker', cols: 80, rows: 24, ...extra })
  it('builds docker, kubectl and wsl commands', () => {
    expect(commandFor('docker', spec({ host: 'web', username: 'app', domain: 'prod', cwd: '/srv' }), 'docker')).toEqual({
      file: 'docker',
      args: ['--context', 'prod', 'exec', '-it', '-u', 'app', '-w', '/srv', 'web', 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash -l || exec sh -l'],
    })
    expect(commandFor('k8s', spec({ protocol: 'k8s', host: 'api-7d9', domain: 'shop', username: 'app', url: 'eks', shell: 'bash' }), 'kubectl').args)
      .toEqual(['--context', 'eks', '-n', 'shop', 'exec', '-it', 'api-7d9', '-c', 'app', '--', 'bash'])
    expect(commandFor('wsl', spec({ protocol: 'wsl', host: 'Ubuntu', username: 'me' }), 'wsl.exe').args).toEqual(['-d', 'Ubuntu', '-u', 'me', '--cd', '~'])
  })

  it('refuses names that would become options', () => {
    expect(() => commandFor('docker', spec({ host: '--privileged' }), 'docker')).toThrow()
    expect(() => commandFor('k8s', spec({ protocol: 'k8s', host: 'pod', domain: '-A' }), 'kubectl')).toThrow()
    expect(() => commandFor('docker', spec({ host: '' }), 'docker')).toThrow()
  })

  it('reads wsl -l output in UTF-16', () => {
    const out = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')])
    expect(parseTargets('wsl', out)).toEqual(['Debian', 'Ubuntu'])
    expect(parseTargets('k8s', Buffer.from('api-1 api-2 api-1'))).toEqual(['api-1', 'api-2'])
  })
})

describe('folder sync', () => {
  it('plans new and changed files one way and copies them through the queue', async () => {
    const left = mkdtempSync(join(tmpdir(), 'mys-sync-a-'))
    const right = mkdtempSync(join(tmpdir(), 'mys-sync-b-'))
    await fs.mkdir(join(left, 'src', 'deep'), { recursive: true })
    writeFileSync(join(left, 'same.txt'), 'same')
    writeFileSync(join(right, 'same.txt'), 'same')
    await fs.utimes(join(right, 'same.txt'), new Date(), new Date())
    await fs.utimes(join(left, 'same.txt'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    writeFileSync(join(left, 'changed.txt'), 'new content')
    writeFileSync(join(right, 'changed.txt'), 'old')
    writeFileSync(join(left, 'src', 'deep', 'new.txt'), 'brand new')
    writeFileSync(join(right, 'only-remote.txt'), 'keep me')

    const conn = createLive('sync-conn-1', 'local')
    conn.fileMode = 'local'
    const plan = await planSync(conn, left, right, 'up')
    expect(plan).toEqual([
      { rel: 'changed.txt', size: 11, reason: 'changed' },
      { rel: 'src/deep/new.txt', size: 9, reason: 'new' },
    ])
    let items: TransferInfo[] = []
    const transfers = new Transfers(() => conn, (_id, next) => { items = next })
    await transfers.sync(conn, left, right, 'up', plan.map((item) => item.rel))
    await until(() => items.length === 2 && items.every((item) => item.state === 'done'))
    expect(readFileSync(join(right, 'src', 'deep', 'new.txt'), 'utf8')).toBe('brand new')
    expect(readFileSync(join(right, 'changed.txt'), 'utf8')).toBe('new content')
    expect(readFileSync(join(right, 'only-remote.txt'), 'utf8')).toBe('keep me')
    expect(await planSync(conn, left, right, 'up')).toEqual([])
    await expect(transfers.sync(conn, left, right, 'up', ['../escape.txt'])).rejects.toThrow()
  })
})

describe('SecureCRT import', () => {
  it('reads a Sessions folder of .ini files', async () => {
    const drafts = await importSecureCrt(join(__dirname, 'fixtures', 'securecrt', 'Sessions'))
    expect(drafts.map((d) => d.name).sort()).toEqual(['router', 'web01'])
    expect(drafts.find((d) => d.name === 'web01')).toMatchObject({ protocol: 'ssh', host: '10.2.0.11', port: 22, username: 'deploy', folder: ['SecureCRT', 'Prod'] })
    expect(drafts.find((d) => d.name === 'web01')?.privateKeyPath).toMatch(/\.ssh[\\/]id_ed25519$/)
    expect(drafts.find((d) => d.name === 'router')).toMatchObject({ protocol: 'telnet', port: 23 })
  })

  it('reads an XML settings export', async () => {
    const drafts = await importSecureCrt(join(__dirname, 'fixtures', 'securecrt', 'export.xml'))
    expect(drafts).toEqual([expect.objectContaining({ name: 'db & cache', host: 'db.lab.local', port: 2222, username: 'postgres', folder: ['SecureCRT', 'Lab'] })])
  })
})

describe('terminal word jumps', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })

  it('maps macOS Option/Command keys to readline moves', () => {
    expect(navSequence(key('ArrowLeft', { altKey: true }), 'darwin', 'posix')).toBe('\x1bb')
    expect(navSequence(key('ArrowRight', { altKey: true }), 'darwin', 'posix')).toBe('\x1bf')
    expect(navSequence(key('Backspace', { altKey: true }), 'darwin', 'posix')).toBe('\x1b\x7f')
    expect(navSequence(key('ArrowLeft', { metaKey: true }), 'darwin', 'posix')).toBe('\x01')
    expect(navSequence(key('ArrowRight', { metaKey: true }), 'darwin', 'posix')).toBe('\x05')
    expect(navSequence(key('Backspace', { metaKey: true }), 'darwin', 'posix')).toBe('\x15')
  })

  it('maps Ctrl keys on Windows/Linux, keeping native sequences for Windows shells', () => {
    expect(navSequence(key('ArrowLeft', { ctrlKey: true }), 'linux', 'posix')).toBe('\x1bb')
    expect(navSequence(key('Delete', { ctrlKey: true }), 'win32', 'posix')).toBe('\x1bd')
    expect(navSequence(key('ArrowRight', { ctrlKey: true }), 'win32', 'windows')).toBe('\x1b[1;5C')
    expect(navSequence(key('Backspace', { ctrlKey: true }), 'win32', 'windows')).toBeNull()
  })

  it('leaves plain keys and Shift selections alone', () => {
    expect(navSequence(key('ArrowLeft'), 'darwin', 'posix')).toBeNull()
    expect(navSequence(key('ArrowLeft', { altKey: true, shiftKey: true }), 'darwin', 'posix')).toBeNull()
    expect(navSequence(key('a', { ctrlKey: true }), 'linux', 'posix')).toBeNull()
  })
})
