import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.MYS_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'mys-store-'))
const { Store } = await import('../src/main/store')
const { importMobaXterm, importSshConfig } = await import('../src/main/importers')

describe('Store.importDrafts', () => {
  it('saves drafts once, links jump hosts and builds nested folders', async () => {
    const store = new Store()
    await store.init()
    const ssh = await importSshConfig(join(__dirname, 'fixtures', 'ssh', 'config'))
    const added = await store.importDrafts(ssh)
    expect(added).toBe(ssh.length)
    const named = (name: string) => store.data.sessions.find((s) => s.name === name)
    expect(named('web-1')?.jumpSessionId).toBe(named('bastion')?.id)
    expect(named('db')?.jumpSessionId).toBe(named('bastion')?.id)
    expect(store.data.folders.filter((f) => f.name === 'SSH config')).toHaveLength(1)
    expect(named('web-1')?.tunnels.every((t) => t.id.length > 10)).toBe(true)

    expect(await store.importDrafts(ssh)).toBe(0)

    await store.importDrafts(await importMobaXterm(join(__dirname, 'fixtures', 'sessions.mxtsessions')))
    const acme = store.data.folders.find((f) => f.id === named('acme-sftp')?.folderId)
    const clients = store.data.folders.find((f) => f.id === acme?.parentId)
    expect([acme?.name, clients?.name, store.data.folders.find((f) => f.id === clients?.parentId)?.name]).toEqual(['Acme', 'Clients', 'MobaXterm'])
  })

  it('clears jump references when the jump session is deleted', async () => {
    const store = new Store()
    await store.init()
    const bastion = store.data.sessions.find((s) => s.name === 'bastion')!
    await store.removeSession(bastion.id)
    expect(store.data.sessions.filter((s) => s.jumpSessionId === bastion.id)).toEqual([])
  })

  it('keeps the proxy password secret and reports only that one exists', async () => {
    const store = new Store()
    await store.init()
    const session = store.data.sessions.find((s) => s.name === 'web-1')!
    const saved = await store.saveSession({ ...session, proxyType: 'socks5', proxyHost: 'p' }, { proxyPassword: 'hunter2' })
    expect(saved.hasProxyPassword).toBe(true)
    expect(store.secretsFor(session.id).proxyPassword).toBe('hunter2')
    expect(JSON.stringify(store.data.sessions)).not.toContain('hunter2')
  })
  it('keeps a known preset icon and colour, drops unknown ones', async () => {
    const store = new Store()
    await store.init()
    const session = store.data.sessions.find((s) => s.name === 'web-1')!
    const good = await store.saveSession({ ...session, icon: 'database', color: '#A48BFF' }, {})
    expect(good.icon).toBe('database')
    expect(good.color).toBe('#a48bff')
    const bad = await store.saveSession({ ...session, icon: '../evil', color: 'red; background: url(x)' }, {})
    expect(bad.icon).toBe('')
    expect(bad.color).toBe('')
  })

  it('exports a mix of picked hosts and folders with their parents, never secrets', async () => {
    const store = new Store()
    await store.init()
    const named = (name: string) => store.data.sessions.find((s) => s.name === name)!
    const folder = (name: string) => store.data.folders.find((f) => f.name === name)!
    const web = named('web-1')
    const clients = folder('Clients')
    const out = JSON.parse(store.exportSelection([web.id], [clients.id], 'json')) as { folders: { name: string }[]; sessions: { name: string; folderId: string; hasProxyPassword: boolean }[] }
    const inClients = store.data.sessions.filter((s) => s.folderId === clients.id || s.folderId === folder('Acme').id)
    expect(out.sessions.map((s) => s.name).sort()).toEqual(['web-1', ...inClients.map((s) => s.name)].sort())
    expect(out.folders.map((f) => f.name).sort()).toEqual(['Acme', 'Clients', 'MobaXterm', 'SSH config'])
    expect(out.sessions.every((s) => !s.hasProxyPassword)).toBe(true)

    const csv = store.exportSelection([web.id], [], 'csv').trim().split('\r\n')
    expect(csv).toHaveLength(2)
    expect(csv[1]).toContain('web-1')
    expect(csv[1]).toContain('SSH config')
  })
})

describe('Store.exportPasswords', () => {
  it('writes every vault password as CSV with quoting, or one per line as text', async () => {
    const store = new Store()
    await store.init()
    for (const item of store.listPasswords()) await store.removePassword(item.id)
    await store.rememberPassword('plain-Secret1')
    const [tricky] = await store.rememberPassword('a,"b"')
    await store.keepPassword(tricky.id, 'db root')
    const csv = store.exportPasswords('csv').replace(/^﻿/, '').trim().split('\r\n')
    expect(csv[0]).toBe('label,password,created,saved')
    expect(csv).toContain(`db root,"a,""b""",${new Date(tricky.createdAt).toISOString()},yes`)
    expect(csv.some((line) => line.startsWith(',plain-Secret1,') && line.endsWith(',no'))).toBe(true)
    expect(store.exportPasswords('txt').trim().split('\n').sort()).toEqual(['a,"b"', 'plain-Secret1'])
  })
})

describe('host icon presets', () => {
  it('has unique ids, known groups and drawable paths', async () => {
    const { HOST_ICONS, HOST_ICON_GROUPS } = await import('../src/shared/hostIcons')
    const ids = HOST_ICONS.map((icon) => icon.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const icon of HOST_ICONS) {
      expect(HOST_ICON_GROUPS).toContain(icon.group)
      expect(icon.paths.length).toBeGreaterThan(0)
      for (const path of icon.paths) expect(path).toMatch(/^M[\d.\s,a-zA-Z-]+$/)
    }
  })
})
