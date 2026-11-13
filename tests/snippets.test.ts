import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Macro } from '../src/shared/types'

process.env.MYS_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'mys-snip-'))
const { Store } = await import('../src/main/store')
const { matchesSnippet, moveSnippet, orderSnippets, tokenizeShell } = await import('../src/renderer/src/snippets')

const macro = (id: string, extra: Partial<Macro> = {}): Macro => ({ id, name: id, command: `echo ${id}`, sendEnter: true, ...extra })

describe('snippet helpers', () => {
  it('tints commands, flags, paths, strings and operators', () => {
    const kinds = tokenizeShell('sudo docker logs -f --tail 50 web | grep "err" > /tmp/out.log')
      .filter((token) => token.kind !== 'space')
      .map((token) => `${token.kind}:${token.text}`)
    expect(kinds).toEqual([
      'cmd:sudo', 'cmd:docker', 'text:logs', 'flag:-f', 'flag:--tail', 'text:50', 'text:web',
      'op:|', 'cmd:grep', 'str:"err"', 'op:>', 'path:/tmp/out.log',
    ])
    expect(tokenizeShell('a && b').map((token) => token.text).join('')).toBe('a && b')
  })

  it('puts pinned first and moves a snippet before another', () => {
    const list = [macro('a'), macro('b', { pinned: true }), macro('c')]
    expect(orderSnippets(list).map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(moveSnippet(list, 'c', 'a').map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(moveSnippet(list, 'a', null).map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('filters by name, command or tag', () => {
    const item = macro('deploy', { tags: ['Docker'] })
    expect(matchesSnippet(item, 'dock', null)).toBe(true)
    expect(matchesSnippet(item, 'echo', null)).toBe(true)
    expect(matchesSnippet(item, '', 'Git')).toBe(false)
  })
})

describe('secret snippets', () => {
  it('keeps the command out of the plain database and reveals it on demand', async () => {
    const dir = process.env.MYS_TEST_USERDATA!
    const store = new Store()
    await store.init()
    await store.saveMacros([macro('db', { name: 'DB login', command: 'mysql -p hunter2-secret', secret: true, tags: ['db'] })])
    expect(store.data.macros[0].command).toBe('')
    expect(store.revealMacro('db')).toBe('mysql -p hunter2-secret')
    // An empty command on save means "unchanged".
    await store.saveMacros([{ ...store.data.macros[0], uses: 3 }])
    expect(store.revealMacro('db')).toBe('mysql -p hunter2-secret')

    const files = ['sessions.json', 'secrets.bin'].map((name) => {
      return readFileSync(join(dir, name), 'utf8')
    })
    expect(files.join('')).not.toContain('hunter2-secret')

    const again = new Store()
    await again.init()
    expect(again.revealMacro('db')).toBe('mysql -p hunter2-secret')
    expect(again.data.macros[0].uses).toBe(3)

    await again.saveMacros([{ ...again.data.macros[0], secret: false, command: 'mysql' }])
    expect(again.revealMacro('db')).toBe('mysql')
    await again.saveMacros([])
    expect(again.revealMacro('db')).toBe('')
  })
})
