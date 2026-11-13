import { describe, expect, it, vi } from 'vitest'
import { addTab, allTabs, bulkCloseIds, closeTabs, emptyLayout, findLeaf, isHomeTab, persistableLayout, pinTab, reviveLayout, splitLeaf, type Layout, type Tab } from '../src/renderer/src/layout'

vi.stubGlobal('crypto', globalThis.crypto)

const tab = (id: string, extra: Partial<Tab['spec']> = {}): Tab => ({
  instanceId: id,
  title: `tab ${id}`,
  protocol: 'ssh',
  spec: { instanceId: id, protocol: 'ssh', host: 'h', cols: 80, rows: 24, ...extra },
  showFiles: true,
})

describe('tab restore', () => {
  it('strips secrets before saving', () => {
    const layout = addTab(emptyLayout(), 'root', tab('a', { password: 'pw', passphrase: 'pp', proxyPassword: 'xp', forceHostKey: true }))
    const saved = JSON.stringify(persistableLayout(layout))
    expect(saved).not.toMatch(/"pw"|"pp"|"xp"|forceHostKey/)
  })

  it('revives splits with fresh connection ids and keeps the active tab', () => {
    let layout = addTab(emptyLayout(), 'root', tab('a'))
    const split = splitLeaf(layout, 'root', 'v')
    layout = addTab(split.layout, split.leafId, tab('b'))
    const revived = reviveLayout(JSON.parse(JSON.stringify(persistableLayout(layout))))!
    expect(revived.kind).toBe('split')
    const tabs = allTabs(revived).filter((item) => !isHomeTab(item))
    expect(tabs.map((item) => item.title)).toEqual(['tab a', 'tab b'])
    expect(tabs.every((item) => item.instanceId !== 'a' && item.instanceId !== 'b' && item.spec.instanceId === item.instanceId)).toBe(true)
  })

  it('ignores garbage and layouts with only home tabs', () => {
    expect(reviveLayout(null)).toBeNull()
    expect(reviveLayout({ kind: 'leaf', tabs: 'nope' })).toBeNull()
    expect(reviveLayout(persistableLayout(emptyLayout()))).toBeNull()
  })
})

describe('tab menu', () => {
  const ids = (layout: Layout) => allTabs(layout).filter((item) => !isHomeTab(item)).map((item) => item.instanceId)
  const four = () => ['a', 'b', 'c', 'd'].reduce<Layout>((layout, id) => addTab(layout, 'root', tab(id)), emptyLayout())

  it('puts a duplicate right after its source', () => {
    expect(ids(addTab(four(), 'root', tab('x'), 'b'))).toEqual(['a', 'b', 'x', 'c', 'd'])
  })

  it('closes before / after / others / all, never pinned tabs or Home', () => {
    const layout = pinTab(four(), 'd', true)
    const leaf = findLeaf(layout, 'root')!
    expect(ids(layout)).toEqual(['d', 'a', 'b', 'c'])
    expect(bulkCloseIds(leaf, 'b', 'before')).toEqual(['a'])
    expect(bulkCloseIds(leaf, 'b', 'after')).toEqual(['c'])
    expect(bulkCloseIds(leaf, 'b', 'others')).toEqual(['a', 'c'])
    expect(bulkCloseIds(leaf, 'b', 'all')).toEqual(['a', 'b', 'c'])
    expect(ids(closeTabs(layout, 'root', bulkCloseIds(leaf, 'b', 'all')))).toEqual(['d'])
  })

  it('keeps tab color and pin across a restart, but not the handed-over flag', () => {
    let layout = pinTab(addTab(emptyLayout(), 'root', { ...tab('a'), color: '#0090ff', adopted: true }), 'a', true)
    layout = reviveLayout(JSON.parse(JSON.stringify(persistableLayout(layout))))!
    const [restored] = allTabs(layout).filter((item) => !isHomeTab(item))
    expect(restored.color).toBe('#0090ff')
    expect(restored.pinned).toBe(true)
    expect(restored.adopted).toBeUndefined()
  })
})
