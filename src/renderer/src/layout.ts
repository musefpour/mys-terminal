import type { OpenSpec, Protocol } from '../../shared/types'

export const HOME_TAB_ID = 'mys-home'

export interface Tab {
  instanceId: string
  title: string
  protocol: Protocol
  spec: OpenSpec
  showFiles: boolean
  home?: boolean
  /** Automatic reconnect attempts made since the link was last up. */
  attempt?: number
  /** Tint chosen from the tab menu (#rrggbb). */
  color?: string
  /** Pinned tabs sit first, have no close button and survive "close all". */
  pinned?: boolean
  /** The connection is already open (handed over from another window); do not open it again. */
  adopted?: boolean
}

export type BulkClose = 'before' | 'after' | 'others' | 'all'

export interface Leaf {
  kind: 'leaf'
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

export interface Split {
  kind: 'split'
  id: string
  dir: 'h' | 'v'
  ratio: number
  a: Layout
  b: Layout
}

export type Layout = Leaf | Split

export function homeTab(title = 'Home'): Tab {
  return {
    instanceId: HOME_TAB_ID,
    title,
    protocol: 'local',
    spec: { instanceId: HOME_TAB_ID, protocol: 'local', cols: 80, rows: 24 },
    showFiles: false,
    home: true,
  }
}

export function emptyLayout(): Leaf {
  const tab = homeTab()
  return { kind: 'leaf', id: 'root', tabs: [tab], activeTabId: tab.instanceId }
}

export function isHomeTab(tab: Tab | null | undefined): boolean {
  return Boolean(tab?.home || tab?.instanceId === HOME_TAB_ID)
}

export function findLeaf(layout: Layout, id: string): Leaf | null {
  if (layout.kind === 'leaf') return layout.id === id ? layout : null
  return findLeaf(layout.a, id) || findLeaf(layout.b, id)
}

export function firstLeaf(layout: Layout): Leaf {
  return layout.kind === 'leaf' ? layout : firstLeaf(layout.a)
}

export function mapLayout(layout: Layout, fn: (leaf: Leaf) => Leaf): Layout {
  if (layout.kind === 'leaf') return fn(layout)
  return { ...layout, a: mapLayout(layout.a, fn), b: mapLayout(layout.b, fn) }
}

export function addTab(layout: Layout, leafId: string, tab: Tab, afterId?: string): Layout {
  return mapLayout(layout, (leaf) => {
    if (leaf.id !== leafId) return leaf
    if (isHomeTab(tab)) return leaf
    const rest = leaf.tabs.filter((item) => !isHomeTab(item))
    const home = leaf.tabs.find(isHomeTab) ?? homeTab()
    const at = afterId ? rest.findIndex((item) => item.instanceId === afterId) : -1
    if (at >= 0) rest.splice(at + 1, 0, tab)
    else rest.push(tab)
    return { ...leaf, tabs: [home, ...rest], activeTabId: tab.instanceId }
  })
}

/** Pin or unpin a tab; pinned tabs are kept together right after Home. */
export function pinTab(layout: Layout, tabId: string, pinned: boolean): Layout {
  return mapLayout(layout, (leaf) => {
    if (!leaf.tabs.some((tab) => tab.instanceId === tabId)) return leaf
    const tabs = leaf.tabs.map((tab) => (tab.instanceId === tabId ? { ...tab, pinned } : tab))
    const home = tabs.filter(isHomeTab)
    const rest = tabs.filter((tab) => !isHomeTab(tab))
    return { ...leaf, tabs: [...home, ...rest.filter((tab) => tab.pinned), ...rest.filter((tab) => !tab.pinned)] }
  })
}

/** Tabs a "close …" menu item would close. Home and pinned tabs are never included. */
export function bulkCloseIds(leaf: Leaf, tabId: string, which: BulkClose): string[] {
  const index = leaf.tabs.findIndex((tab) => tab.instanceId === tabId)
  return leaf.tabs
    .filter((tab, at) => {
      if (isHomeTab(tab) || tab.pinned) return false
      if (which === 'before') return at < index
      if (which === 'after') return at > index
      if (which === 'others') return tab.instanceId !== tabId
      return true
    })
    .map((tab) => tab.instanceId)
}

export function closeTabs(layout: Layout, leafId: string, tabIds: string[]): Layout {
  return tabIds.reduce((current, id) => closeTab(current, leafId, id), layout)
}

export function closeTab(layout: Layout, leafId: string, tabId: string): Layout {
  return mapLayout(layout, (leaf) => {
    if (leaf.id !== leafId) return leaf
    if (tabId === HOME_TAB_ID || leaf.tabs.some((tab) => tab.instanceId === tabId && isHomeTab(tab))) return leaf
    const tabs = leaf.tabs.filter((tab) => tab.instanceId !== tabId)
    let active = leaf.activeTabId
    if (active === tabId) {
      const index = leaf.tabs.findIndex((tab) => tab.instanceId === tabId)
      active = tabs[Math.min(index, tabs.length - 1)]?.instanceId ?? tabs[index - 1]?.instanceId ?? null
    }
    if (!tabs.some(isHomeTab)) {
      const home = homeTab()
      return { ...leaf, tabs: [home, ...tabs], activeTabId: active && active !== tabId ? active : home.instanceId }
    }
    return { ...leaf, tabs, activeTabId: active }
  })
}

export function setActiveTab(layout: Layout, leafId: string, tabId: string): Layout {
  return mapLayout(layout, (leaf) => (leaf.id === leafId ? { ...leaf, activeTabId: tabId } : leaf))
}

export function updateTab(layout: Layout, tabId: string, fn: (tab: Tab) => Tab): Layout {
  return mapLayout(layout, (leaf) => ({
    ...leaf,
    tabs: leaf.tabs.map((tab) => (tab.instanceId === tabId ? fn(tab) : tab)),
  }))
}

export function replaceTab(layout: Layout, tabId: string, next: Tab): Layout {
  return mapLayout(layout, (leaf) => ({
    ...leaf,
    activeTabId: leaf.activeTabId === tabId ? next.instanceId : leaf.activeTabId,
    tabs: leaf.tabs.map((tab) => (tab.instanceId === tabId ? next : tab)),
  }))
}

function freshLeaf(): Leaf {
  const home = homeTab()
  return { kind: 'leaf', id: crypto.randomUUID(), tabs: [home], activeTabId: home.instanceId }
}

export function splitLeaf(layout: Layout, leafId: string, dir: 'h' | 'v'): { layout: Layout; leafId: string } {
  const created = crypto.randomUUID()
  const walk = (node: Layout): Layout => {
    if (node.kind === 'leaf') {
      if (node.id !== leafId) return node
      const fresh = { ...freshLeaf(), id: created }
      return { kind: 'split', id: crypto.randomUUID(), dir, ratio: 0.5, a: node, b: fresh }
    }
    return { ...node, a: walk(node.a), b: walk(node.b) }
  }
  return { layout: walk(layout), leafId: created }
}

/** Replace one leaf with a 2×2 grid. Current pane stays top-start. */
export function splitQuad(layout: Layout, leafId: string): { layout: Layout; leafId: string } {
  const walk = (node: Layout): Layout => {
    if (node.kind === 'leaf') {
      if (node.id !== leafId) return node
      const topEnd = freshLeaf()
      const bottomStart = freshLeaf()
      const bottomEnd = freshLeaf()
      const startCol: Split = { kind: 'split', id: crypto.randomUUID(), dir: 'h', ratio: 0.5, a: node, b: bottomStart }
      const endCol: Split = { kind: 'split', id: crypto.randomUUID(), dir: 'h', ratio: 0.5, a: topEnd, b: bottomEnd }
      return { kind: 'split', id: crypto.randomUUID(), dir: 'v', ratio: 0.5, a: startCol, b: endCol }
    }
    return { ...node, a: walk(node.a), b: walk(node.b) }
  }
  return { layout: walk(layout), leafId }
}

export function closeLeaf(layout: Layout, leafId: string): Layout {
  if (layout.kind === 'leaf') {
    if (layout.id !== leafId) return layout
    const home = homeTab()
    return { ...layout, tabs: [home], activeTabId: home.instanceId }
  }
  if (layout.a.kind === 'leaf' && layout.a.id === leafId) return layout.b
  if (layout.b.kind === 'leaf' && layout.b.id === leafId) return layout.a
  return { ...layout, a: closeLeaf(layout.a, leafId), b: closeLeaf(layout.b, leafId) }
}

export function setRatio(layout: Layout, splitId: string, ratio: number): Layout {
  if (layout.kind === 'leaf') return layout
  if (layout.id === splitId) return { ...layout, ratio }
  return { ...layout, a: setRatio(layout.a, splitId, ratio), b: setRatio(layout.b, splitId, ratio) }
}

export function allTabs(layout: Layout): Tab[] {
  if (layout.kind === 'leaf') return layout.tabs
  return [...allTabs(layout.a), ...allTabs(layout.b)]
}

export function cycleTab(layout: Layout, leafId: string, delta: number): Layout {
  const leaf = findLeaf(layout, leafId)
  if (!leaf || leaf.tabs.length < 2) return layout
  const index = Math.max(0, leaf.tabs.findIndex((tab) => tab.instanceId === leaf.activeTabId))
  const next = leaf.tabs[(index + delta + leaf.tabs.length) % leaf.tabs.length]
  return setActiveTab(layout, leafId, next.instanceId)
}

const SECRET_KEYS = ['password', 'passphrase', 'proxyPassword', 'forceHostKey'] as const

/** Layout with secrets removed, for restoring tabs on the next launch. */
export function persistableLayout(layout: Layout): Layout {
  return mapLayout(layout, (leaf) => ({
    ...leaf,
    tabs: leaf.tabs.map((tab) => {
      if (isHomeTab(tab)) return tab
      const spec = { ...tab.spec }
      for (const key of SECRET_KEYS) delete spec[key]
      const { adopted: _adopted, ...rest } = tab
      return { ...rest, spec, attempt: 0 }
    }),
  }))
}

/** Rebuild a saved layout with fresh connection ids so every tab reconnects. */
export function reviveLayout(value: unknown): Layout | null {
  const walk = (node: unknown): Layout | null => {
    if (!node || typeof node !== 'object') return null
    const item = node as Layout
    if (item.kind === 'split') {
      const a = walk(item.a)
      const b = walk(item.b)
      if (!a || !b) return a || b
      return { kind: 'split', id: String(item.id || crypto.randomUUID()), dir: item.dir === 'h' ? 'h' : 'v', ratio: Math.min(0.8, Math.max(0.2, Number(item.ratio) || 0.5)), a, b }
    }
    if (item.kind !== 'leaf' || !Array.isArray(item.tabs)) return null
    let active: string | null = null
    const tabs: Tab[] = [homeTab()]
    for (const raw of item.tabs) {
      if (!raw || typeof raw !== 'object' || isHomeTab(raw) || !raw.spec || typeof raw.spec.protocol !== 'string') continue
      const instanceId = crypto.randomUUID()
      if (raw.instanceId === item.activeTabId) active = instanceId
      tabs.push({
        instanceId,
        title: String(raw.title || ''),
        protocol: raw.spec.protocol,
        spec: { ...raw.spec, instanceId },
        showFiles: Boolean(raw.showFiles),
        ...(typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? { color: raw.color } : {}),
        ...(raw.pinned ? { pinned: true } : {}),
      })
    }
    return { kind: 'leaf', id: String(item.id || crypto.randomUUID()), tabs, activeTabId: active ?? tabs[tabs.length - 1].instanceId }
  }
  const layout = walk(value)
  return layout && allTabs(layout).some((tab) => !isHomeTab(tab)) ? layout : null
}
