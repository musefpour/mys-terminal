import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SyncDirection, SyncItem } from '../shared/types'
import { listFiles, MAX_FILES } from './files'
import { tr } from './i18n'
import type { LiveConn } from './live'

interface Meta {
  size: number
  mtime: number
}

// Remote mtimes are often whole seconds; FAT and some servers round to 2 s.
const MTIME_SLACK = 2000

/**
 * One-way sync plan: files that are missing on the target or differ in size,
 * or are newer on the source. Nothing is ever deleted on the target.
 */
export async function planSync(conn: LiveConn, localDir: string, remoteDir: string, direction: SyncDirection): Promise<SyncItem[]> {
  const local = new Map<string, Meta>()
  const remote = new Map<string, Meta>()
  await walkLocal(localDir, '', local)
  await walkRemote(conn, remoteDir, '', remote)
  const [source, target] = direction === 'up' ? [local, remote] : [remote, local]
  const items: SyncItem[] = []
  for (const [rel, meta] of source) {
    const have = target.get(rel)
    if (!have) items.push({ rel, size: meta.size, reason: 'new' })
    else if (have.size !== meta.size || meta.mtime - have.mtime > MTIME_SLACK) items.push({ rel, size: meta.size, reason: 'changed' })
  }
  return items.sort((a, b) => a.rel.localeCompare(b.rel))
}

async function walkLocal(root: string, rel: string, out: Map<string, Meta>): Promise<void> {
  for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) await walkLocal(root, child, out)
    else if (entry.isFile()) {
      const stat = await fs.stat(path.join(root, child))
      out.set(child, { size: stat.size, mtime: stat.mtimeMs })
    }
    if (out.size > MAX_FILES * 5) throw new Error(tr('tooManyFiles'))
  }
}

async function walkRemote(conn: LiveConn, root: string, rel: string, out: Map<string, Meta>): Promise<void> {
  let listing: Awaited<ReturnType<typeof listFiles>>
  try {
    listing = await listFiles(conn, rel ? joinRemote(conn, root, rel) : root)
  } catch (error) {
    // A target folder that does not exist yet simply has no files.
    if (rel === '') return
    throw error
  }
  for (const entry of listing.entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDir) await walkRemote(conn, root, child, out)
    else if (!entry.isLink) out.set(child, { size: entry.size, mtime: entry.mtime })
    if (out.size > MAX_FILES * 5) throw new Error(tr('tooManyFiles'))
  }
}

/** `rel` uses "/" separators; keep them for remote paths, convert for local ones. */
export function joinRemote(conn: LiveConn, root: string, rel: string): string {
  if (conn.fileMode === 'local') return path.join(root, ...rel.split('/'))
  return path.posix.join(root || '/', rel)
}
