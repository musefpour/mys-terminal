import type { ServerStats } from '../shared/types'

/**
 * One round trip per sample. Wrapped in `sh -c` so it works whatever the login
 * shell is (fish, csh…). Linux gives everything via /proc; other Unixes still
 * report disk and load through df/uptime.
 */
export const MONITOR_COMMAND = `sh -c 'head -n1 /proc/stat 2>/dev/null; echo @@; grep -E "^(MemTotal|MemAvailable|MemFree|Buffers|Cached):" /proc/meminfo 2>/dev/null; echo @@; df -Pk / 2>/dev/null | tail -n1; echo @@; cat /proc/uptime 2>/dev/null; echo @@; cat /proc/loadavg 2>/dev/null || uptime; echo @@; cat /proc/net/dev 2>/dev/null'`

/** Counters kept between samples to turn totals into rates. */
export interface MonitorState {
  cpuBusy: number
  cpuTotal: number
  rx: number
  tx: number
  at: number
}

export function parseMonitor(text: string, prev: MonitorState | null, now = Date.now()): { stats: ServerStats; state: MonitorState } {
  const [cpuPart = '', memPart = '', diskPart = '', upPart = '', loadPart = '', netPart = ''] = text.split(/^@@\s*$/m)
  const state: MonitorState = { cpuBusy: 0, cpuTotal: 0, rx: 0, tx: 0, at: now }
  const stats: ServerStats = {
    cpu: null,
    memUsed: null,
    memTotal: null,
    diskUsed: null,
    diskTotal: null,
    uptime: null,
    load: null,
    rxRate: null,
    txRate: null,
  }

  const cpu = cpuPart.trim().match(/^cpu\s+(.+)$/m)
  if (cpu) {
    const fields = cpu[1].trim().split(/\s+/).map(Number)
    // user nice system idle iowait irq softirq steal
    const idle = (fields[3] || 0) + (fields[4] || 0)
    const total = fields.slice(0, 8).reduce((sum, value) => sum + (value || 0), 0)
    state.cpuBusy = total - idle
    state.cpuTotal = total
    if (prev && total > prev.cpuTotal) {
      stats.cpu = clampPercent(((state.cpuBusy - prev.cpuBusy) / (total - prev.cpuTotal)) * 100)
    }
  }

  const mem = new Map<string, number>()
  for (const line of memPart.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/i)
    if (match) mem.set(match[1], Number(match[2]) * 1024)
  }
  const memTotal = mem.get('MemTotal')
  if (memTotal) {
    const available = mem.get('MemAvailable') ?? (mem.get('MemFree') ?? 0) + (mem.get('Buffers') ?? 0) + (mem.get('Cached') ?? 0)
    stats.memTotal = memTotal
    stats.memUsed = Math.max(0, memTotal - available)
  }

  // Filesystem 1024-blocks Used Available Capacity Mounted
  const disk = diskPart.trim().split('\n').pop()?.trim().split(/\s+/) ?? []
  if (disk.length >= 4 && /^\d+$/.test(disk[1]) && /^\d+$/.test(disk[2])) {
    stats.diskTotal = Number(disk[1]) * 1024
    stats.diskUsed = Number(disk[2]) * 1024
  }

  const uptime = Number(upPart.trim().split(/\s+/)[0])
  if (Number.isFinite(uptime) && uptime > 0) stats.uptime = Math.round(uptime)

  const load = loadPart.trim()
  const loadavg = load.match(/^(\d+(?:\.\d+)?)\s+\d/) || load.match(/load averages?:\s*(\d+(?:[.,]\d+)?)/i)
  if (loadavg) stats.load = Number(loadavg[1].replace(',', '.'))
  if (stats.uptime === null) stats.uptime = parseUptimeText(load)

  let rx = 0
  let tx = 0
  let seen = false
  for (const line of netPart.split('\n')) {
    const match = line.match(/^\s*([^:\s]+):\s*(.+)$/)
    if (!match || match[1] === 'lo') continue
    const cols = match[2].trim().split(/\s+/).map(Number)
    if (cols.length < 9) continue
    rx += cols[0] || 0
    tx += cols[8] || 0
    seen = true
  }
  if (seen) {
    state.rx = rx
    state.tx = tx
    if (prev && now > prev.at && rx >= prev.rx && tx >= prev.tx) {
      const seconds = (now - prev.at) / 1000
      stats.rxRate = Math.round((rx - prev.rx) / seconds)
      stats.txRate = Math.round((tx - prev.tx) / seconds)
    }
  }
  return { stats, state }
}

/** `up 3 days, 4:05` / `up 12 min` from BSD/macOS `uptime`. */
function parseUptimeText(text: string): number | null {
  const match = text.match(/up\s+(.+?),\s+\d+\s+users?/i) || text.match(/up\s+(.+?),\s+load/i)
  if (!match) return null
  let seconds = 0
  const part = match[1]
  const days = part.match(/(\d+)\s+days?/)
  if (days) seconds += Number(days[1]) * 86400
  const clock = part.match(/(\d+):(\d+)/)
  if (clock) seconds += Number(clock[1]) * 3600 + Number(clock[2]) * 60
  const mins = part.match(/(\d+)\s+mins?/)
  if (mins) seconds += Number(mins[1]) * 60
  const hours = part.match(/(\d+)\s+hrs?/)
  if (hours) seconds += Number(hours[1]) * 3600
  return seconds || null
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
}
