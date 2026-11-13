import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { DEFAULT_PORT, type Parity, type Protocol, type TunnelTemplate } from '../shared/types'

/** A session found in another tool's config, before it becomes a saved Session. */
export interface ImportDraft {
  /** Key other drafts use to name this one as their jump host. */
  alias: string
  name: string
  folder: string[]
  protocol: Protocol
  host: string
  port: number
  username: string
  privateKeyPath?: string
  certificatePath?: string
  agentForward?: boolean
  x11?: boolean
  tunnels?: TunnelTemplate[]
  jumpAlias?: string
  serialPath?: string
  baudRate?: number
  dataBits?: 7 | 8
  parity?: Parity
  stopBits?: 1 | 2
  url?: string
}

/* ───────────────────────── OpenSSH ~/.ssh/config ───────────────────────── */

interface SshBlock {
  patterns: string[]
  options: [string, string][]
}

const MULTI = new Set(['identityfile', 'localforward', 'remoteforward', 'dynamicforward'])

export function defaultSshConfigPath(): string {
  return path.join(homedir(), '.ssh', 'config')
}

export async function importSshConfig(file: string): Promise<ImportDraft[]> {
  const blocks: SshBlock[] = []
  await readSshConfig(file, blocks, 0)
  const aliases: string[] = []
  for (const block of blocks) {
    for (const pattern of block.patterns) {
      if (!/[*?!]/.test(pattern) && !aliases.includes(pattern)) aliases.push(pattern)
    }
  }
  const drafts: ImportDraft[] = []
  const extra: ImportDraft[] = []
  for (const alias of aliases) {
    const opts = new Map<string, string[]>()
    for (const block of blocks) {
      if (!hostMatches(block.patterns, alias)) continue
      for (const [key, value] of block.options) {
        const list = opts.get(key)
        if (!list) opts.set(key, [value])
        else if (MULTI.has(key)) list.push(value)
      }
    }
    const one = (key: string) => opts.get(key)?.[0]
    const host = (one('hostname') || alias).replace(/%h/g, alias)
    const draft: ImportDraft = {
      alias,
      name: alias,
      folder: ['SSH config'],
      protocol: 'ssh',
      host,
      port: Number(one('port')) || 22,
      username: one('user') || '',
      privateKeyPath: expandHome(one('identityfile') || ''),
      certificatePath: expandHome(one('certificatefile') || ''),
      agentForward: yes(one('forwardagent')),
      x11: yes(one('forwardx11')),
      tunnels: sshForwards(opts),
    }
    const jump = one('proxyjump')
    if (jump && jump.toLowerCase() !== 'none') {
      // "a,b" means a first, then b; the target hangs off the last hop.
      const hops = jump.split(',').map((item) => item.trim()).filter(Boolean)
      let previous: string | undefined
      for (const hop of hops) {
        if (!aliases.includes(hop) && !extra.some((item) => item.alias === hop)) {
          const parsed = parseUserHost(hop)
          if (parsed) extra.push({ alias: hop, name: `Jump ${parsed.host}`, folder: ['SSH config'], protocol: 'ssh', ...parsed, jumpAlias: previous })
        }
        previous = hop
      }
      draft.jumpAlias = previous
    }
    drafts.push(draft)
  }
  return [...extra, ...drafts]
}

async function readSshConfig(file: string, blocks: SshBlock[], depth: number): Promise<void> {
  if (depth > 4) return
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    if (depth === 0) throw new Error(`cannot read ${file}`)
    return
  }
  let current: SshBlock | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(\S+?)\s*(?:=|\s)\s*(.*)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = unquote(match[2].replace(/\s+#.*$/, ''))
    if (key === 'include') {
      for (const pattern of value.split(/\s+/)) {
        for (const included of await expandInclude(pattern)) await readSshConfig(included, blocks, depth + 1)
      }
      continue
    }
    if (key === 'host') {
      current = { patterns: value.split(/\s+/).filter(Boolean), options: [] }
      blocks.push(current)
      continue
    }
    if (key === 'match') {
      // Match rules depend on runtime state; their options are skipped.
      current = { patterns: [], options: [] }
      blocks.push(current)
      continue
    }
    if (!current) {
      current = { patterns: ['*'], options: [] }
      blocks.push(current)
    }
    current.options.push([key, value])
  }
}

async function expandInclude(pattern: string): Promise<string[]> {
  const full = path.isAbsolute(expandHome(pattern)) ? expandHome(pattern) : path.join(homedir(), '.ssh', pattern)
  if (!/[*?]/.test(path.basename(full))) return [full]
  const dir = path.dirname(full)
  const test = globRegex(path.basename(full))
  try {
    const names = await fs.readdir(dir)
    return names.filter((name) => test.test(name)).sort().map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

function hostMatches(patterns: string[], alias: string): boolean {
  let hit = false
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (globRegex(pattern.slice(1)).test(alias)) return false
      continue
    }
    if (globRegex(pattern).test(alias)) hit = true
  }
  return hit
}

function globRegex(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${body}$`, 'i')
}

function sshForwards(opts: Map<string, string[]>): TunnelTemplate[] {
  const out: TunnelTemplate[] = []
  const add = (mode: TunnelTemplate['mode'], value: string) => {
    const [listen, target] = value.split(/\s+/)
    const bind = splitBind(listen || '')
    if (!bind) return
    if (mode === 'dynamic') {
      out.push({ id: '', mode, listenPort: bind.port, targetHost: '', targetPort: 0, bindAddress: bind.address })
      return
    }
    const dest = splitBind(target || '')
    if (!dest?.address) return
    out.push({ id: '', mode, listenPort: bind.port, targetHost: dest.address, targetPort: dest.port, bindAddress: bind.address })
  }
  for (const value of opts.get('localforward') ?? []) add('local', value)
  for (const value of opts.get('remoteforward') ?? []) add('remote', value)
  for (const value of opts.get('dynamicforward') ?? []) add('dynamic', value)
  return out
}

/** `8080`, `127.0.0.1:8080`, `[::1]:8080`, `host:80` */
function splitBind(value: string): { address?: string; port: number } | null {
  const v6 = value.match(/^\[([^\]]+)\]:(\d+)$/)
  if (v6) return { address: v6[1], port: Number(v6[2]) }
  const at = value.lastIndexOf(':')
  const port = Number(at >= 0 ? value.slice(at + 1) : value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { address: at >= 0 ? value.slice(0, at) || undefined : undefined, port }
}

function parseUserHost(value: string): { host: string; port: number; username: string } | null {
  const match = value.match(/^(?:ssh:\/\/)?(?:([^@\s]+)@)?(\[[^\]]+\]|[^:\s]+)(?::(\d+))?$/)
  if (!match) return null
  return { username: match[1] || '', host: match[2].replace(/^\[|\]$/g, ''), port: Number(match[3]) || 22 }
}

/* ───────────────────────── PuTTY ───────────────────────── */

const PUTTY_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions'

/** Sessions straight from the Windows registry. */
export function readPuttyRegistry(): Promise<ImportDraft[]> {
  return new Promise((resolve, reject) => {
    execFile('reg', ['query', PUTTY_KEY, '/s'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error('PuTTY sessions not found in the registry'))
        return
      }
      const sessions = new Map<string, Map<string, string>>()
      let current: Map<string, string> | null = null
      for (const line of stdout.split(/\r?\n/)) {
        if (/^HKEY_/i.test(line)) {
          const name = line.split('\\').pop() || ''
          current = new Map()
          sessions.set(name, current)
          continue
        }
        const value = line.match(/^\s+(\S+)\s+(REG_\w+)\s+(.*)$/)
        if (!value || !current) continue
        current.set(value[1], value[2] === 'REG_DWORD' ? String(parseInt(value[3], 16)) : value[3])
      }
      resolve(puttyDrafts(sessions))
    })
  })
}

/** Sessions from a `regedit` export (.reg), usually UTF-16 with BOM. */
export async function importPuttyReg(file: string): Promise<ImportDraft[]> {
  const text = decodeText(await fs.readFile(file))
  const sessions = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const head = line.match(/^\[HKEY_[^\]]*\\SimonTatham\\PuTTY\\Sessions\\([^\]\\]+)\]$/i)
    if (head) {
      current = new Map()
      sessions.set(head[1], current)
      continue
    }
    if (line.startsWith('[')) {
      current = null
      continue
    }
    const value = line.match(/^"([^"]+)"=(.*)$/)
    if (!value || !current) continue
    const data = value[2]
    if (data.startsWith('dword:')) current.set(value[1], String(parseInt(data.slice(6), 16)))
    else if (data.startsWith('"')) current.set(value[1], data.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"'))
  }
  return puttyDrafts(sessions)
}

function puttyDrafts(sessions: Map<string, Map<string, string>>): ImportDraft[] {
  const out: ImportDraft[] = []
  for (const [rawName, values] of sessions) {
    const name = safeDecode(rawName)
    if (!name || name === 'Default Settings') continue
    const kind = (values.get('Protocol') || 'ssh').toLowerCase()
    const protocol: Protocol | null = kind === 'ssh' ? 'ssh' : kind === 'telnet' ? 'telnet' : kind === 'raw' ? 'raw' : kind === 'serial' ? 'serial' : null
    if (!protocol) continue
    let host = values.get('HostName') || ''
    let username = values.get('UserName') || ''
    const at = host.lastIndexOf('@')
    if (at > 0) {
      username = username || host.slice(0, at)
      host = host.slice(at + 1)
    }
    if (protocol !== 'serial' && !host) continue
    const draft: ImportDraft = {
      alias: `putty:${name}`,
      name,
      folder: ['PuTTY'],
      protocol,
      host,
      port: Number(values.get('PortNumber')) || DEFAULT_PORT[protocol],
      username,
      privateKeyPath: values.get('PublicKeyFile') || '',
      certificatePath: values.get('DetachedCertificate') || '',
      agentForward: values.get('AgentFwd') === '1',
      x11: values.get('X11Forward') === '1',
      tunnels: puttyForwards(values.get('PortForwardings') || ''),
    }
    if (protocol === 'serial') {
      const parity = values.get('SerialParity')
      draft.serialPath = values.get('SerialLine') || ''
      draft.baudRate = Number(values.get('SerialSpeed')) || 9600
      draft.dataBits = values.get('SerialDataBits') === '7' ? 7 : 8
      draft.stopBits = values.get('SerialStopHalfbits') === '4' ? 2 : 1
      draft.parity = parity === '1' ? 'odd' : parity === '2' ? 'even' : 'none'
    }
    out.push(draft)
  }
  return out
}

/** `L8080=localhost:80,R2222=host:22,D1080`, optionally `4L…`/`6L…` and `L127.0.0.1:8080=…`. */
function puttyForwards(value: string): TunnelTemplate[] {
  const out: TunnelTemplate[] = []
  for (const raw of value.split(',')) {
    const item = raw.trim().replace(/^[46]/, '')
    const kind = item[0]
    const [listen, target = ''] = item.slice(1).split('=')
    const bind = splitBind(listen || '')
    if (!bind) continue
    if (kind === 'D') {
      out.push({ id: '', mode: 'dynamic', listenPort: bind.port, targetHost: '', targetPort: 0, bindAddress: bind.address })
      continue
    }
    const dest = splitBind(target)
    if (!dest?.address || (kind !== 'L' && kind !== 'R')) continue
    out.push({ id: '', mode: kind === 'L' ? 'local' : 'remote', listenPort: bind.port, targetHost: dest.address, targetPort: dest.port, bindAddress: bind.address })
  }
  return out
}

/* ───────────────────────── MobaXterm .mxtsessions / MobaXterm.ini ───────────────────────── */

// Order of the session-type buttons in MobaXterm: SSH, Telnet, Rsh, Xdmcp, RDP, VNC, FTP, SFTP, Serial, File, Shell, Browser, Mosh, S3, WSL.
const MOBA_TYPES: Record<string, Protocol> = {
  '0': 'ssh',
  '1': 'telnet',
  '4': 'rdp',
  '5': 'vnc',
  '6': 'ftp',
  '7': 'sftp',
  '11': 'browser',
  '12': 'mosh',
  '14': 'wsl',
}

export async function importMobaXterm(file: string): Promise<ImportDraft[]> {
  const text = decodeText(await fs.readFile(file))
  const out: ImportDraft[] = []
  let inBookmarks = false
  let folder: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';')) continue
    const section = line.match(/^\[(.+)\]$/)
    if (section) {
      inBookmarks = /^Bookmarks(_\d+)?$/i.test(section[1])
      folder = []
      continue
    }
    if (!inBookmarks) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'SubRep') {
      folder = value.split('\\').map((part) => part.trim()).filter(Boolean)
      continue
    }
    if (key === 'ImgNum' || !value.startsWith('#')) continue
    const fields = (value.split('#')[2] || '').split('%')
    const protocol = MOBA_TYPES[fields[0]]
    if (!protocol) continue
    const host = fields[1] || ''
    if (!host) continue
    const draft: ImportDraft = {
      alias: `moba:${[...folder, key].join('/')}`,
      name: key,
      folder: ['MobaXterm', ...folder],
      protocol,
      host: protocol === 'browser' ? '' : host,
      port: Number(fields[2]) || DEFAULT_PORT[protocol],
      username: protocol === 'browser' ? '' : fields[3] || '',
    }
    if (protocol === 'browser') draft.url = /^https?:\/\//i.test(host) ? host : `https://${host}`
    out.push(draft)
  }
  return out
}

/* ───────────────────────── SecureCRT ───────────────────────── */

type CrtValues = Map<string, string>

/** SecureCRT: a `Config/Sessions` folder of .ini files, or an XML settings export. */
export async function importSecureCrt(source: string): Promise<ImportDraft[]> {
  const stat = await fs.stat(source)
  const sessions: { folder: string[]; name: string; values: CrtValues }[] = []
  if (stat.isDirectory()) await walkCrtFolder(source, [], sessions)
  else if (/\.xml$/i.test(source)) collectCrtXml(decodeText(await fs.readFile(source)), sessions)
  else sessions.push({ folder: [], name: path.basename(source, path.extname(source)), values: parseCrtIni(decodeText(await fs.readFile(source))) })
  return sessions.map(crtDraft).filter((draft): draft is ImportDraft => Boolean(draft))
}

async function walkCrtFolder(dir: string, folder: string[], out: { folder: string[]; name: string; values: CrtValues }[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walkCrtFolder(full, [...folder, entry.name], out)
    else if (/\.ini$/i.test(entry.name) && !/^(__FolderData__|Default)\.ini$/i.test(entry.name)) {
      out.push({ folder, name: entry.name.replace(/\.ini$/i, ''), values: parseCrtIni(decodeText(await fs.readFile(full))) })
    }
  }
}

/** `S:"Hostname"=example.com`, `D:"[SSH2] Port"=00000016` (hex dword). */
function parseCrtIni(text: string): CrtValues {
  const values: CrtValues = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([SDB]):"([^"]+)"=(.*)$/)
    if (!match) continue
    values.set(match[2], match[1] === 'D' ? String(parseInt(match[3], 16)) : match[3].trim())
  }
  return values
}

/** VanDyke XML: nested <key name="Sessions"> … <key name="host"><string name="Hostname">…</string>. */
function collectCrtXml(xml: string, out: { folder: string[]; name: string; values: CrtValues }[]): void {
  const stack: { name: string; values: CrtValues }[] = []
  const token = /<key\s+name="([^"]*)"\s*(\/?)>|<\/key>|<(string|dword)\s+name="([^"]*)"\s*(?:\/>|>([\s\S]*?)<\/\3>)/g
  let match: RegExpExecArray | null
  while ((match = token.exec(xml))) {
    if (match[1] !== undefined) {
      if (match[2] !== '/') stack.push({ name: unescapeXml(match[1]), values: new Map() })
      continue
    }
    if (match[0] === '</key>') {
      const node = stack.pop()
      const inSessions = stack.findIndex((item) => item.name === 'Sessions')
      if (node && inSessions >= 0 && node.values.has('Hostname')) {
        out.push({ folder: stack.slice(inSessions + 1).map((item) => item.name), name: node.name, values: node.values })
      }
      continue
    }
    stack[stack.length - 1]?.values.set(unescapeXml(match[4]), unescapeXml(match[5] ?? ''))
  }
}

function crtDraft(item: { folder: string[]; name: string; values: CrtValues }): ImportDraft | null {
  const values = item.values
  const kind = (values.get('Protocol Name') || 'SSH2').toLowerCase()
  const protocol: Protocol | null = kind.startsWith('ssh') ? 'ssh' : kind === 'telnet' ? 'telnet' : kind === 'rdp' ? 'rdp' : kind === 'serial' ? 'serial' : kind === 'raw' ? 'raw' : null
  if (!protocol) return null
  const host = values.get('Hostname') || ''
  if (protocol !== 'serial' && !host) return null
  const port = Number(values.get(kind.startsWith('ssh') ? `[${values.get('Protocol Name') || 'SSH2'}] Port` : 'Port')) || DEFAULT_PORT[protocol]
  const draft: ImportDraft = {
    alias: `crt:${[...item.folder, item.name].join('/')}`,
    name: item.name,
    folder: ['SecureCRT', ...item.folder],
    protocol,
    host,
    port,
    username: values.get('Username') || '',
    privateKeyPath: (values.get('Identity Filename V2') || '').replace(/^\$\{VDS_SSH_KEY_DIR\}/, path.join(homedir(), '.ssh')).split(':')[0] || '',
  }
  if (protocol === 'serial') {
    draft.serialPath = values.get('Com Port') || ''
    draft.baudRate = Number(values.get('Baud Rate')) || 9600
  }
  return draft
}

function unescapeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/* ───────────────────────── helpers ───────────────────────── */

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

function expandHome(value: string): string {
  if (!value) return ''
  const home = homedir()
  return unquote(value).replace(/^~(?=$|[\\/])/, home).replace(/%d/g, home)
}

function unquote(value: string): string {
  const v = value.trim()
  return v.length > 1 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v
}

function yes(value?: string): boolean {
  return value?.toLowerCase() === 'yes'
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
