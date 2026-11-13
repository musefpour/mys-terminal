import { describe, expect, it } from 'vitest'
import { parseMonitor } from '../src/main/monitor'

describe('parseMonitor', () => {
  it('reads disk, load and uptime from a non-Linux server (no /proc)', () => {
    const text = [
      '@@',
      '@@',
      '/dev/disk3s1 488245288 200000000 280000000 42% /',
      '@@',
      '@@',
      '10:15  up 3 days,  4:05, 2 users, load averages: 1.52 1.20 1.01',
      '@@',
    ].join('\n')
    const { stats } = parseMonitor(text, null)
    expect(stats.cpu).toBeNull()
    expect(stats.memTotal).toBeNull()
    expect(stats.diskTotal).toBe(488245288 * 1024)
    expect(stats.load).toBe(1.52)
    expect(stats.uptime).toBe(3 * 86400 + 4 * 3600 + 5 * 60)
  })

  it('falls back to MemFree + Buffers + Cached without MemAvailable', () => {
    const text = ['@@', 'MemTotal: 1000 kB', 'MemFree: 100 kB', 'Buffers: 50 kB', 'Cached: 250 kB', '@@'].join('\n')
    const { stats } = parseMonitor(text, null)
    expect(stats.memUsed).toBe(600 * 1024)
  })

  it('returns all nulls for empty output', () => {
    const { stats } = parseMonitor('', null)
    expect(Object.values(stats).every((value) => value === null)).toBe(true)
  })
})
