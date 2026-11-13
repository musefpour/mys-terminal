import { useEffect, useState } from 'react'
import type { ServerStats } from '../../../shared/types'
import { useI18n } from '../i18n'

/** Live CPU / RAM / disk / network / uptime of the server behind an SSH tab. */
export function MonitorBar({ instanceId }: { instanceId: string }) {
  const { t } = useI18n()
  const [stats, setStats] = useState<ServerStats | null>(null)

  useEffect(() => {
    const off = window.mys.subscribe((event) => {
      if (event.type === 'monitor' && event.instanceId === instanceId) setStats(event.stats)
    })
    void window.mys.monitor.start(instanceId).catch(() => undefined)
    return () => {
      off()
      void window.mys.monitor.stop(instanceId).catch(() => undefined)
    }
  }, [instanceId])

  if (!stats) return <div className="monitor-bar" dir="ltr" aria-busy="true"><span className="monitor-wait">{t('monitorWaiting')}</span></div>
  const mem = ratio(stats.memUsed, stats.memTotal)
  const disk = ratio(stats.diskUsed, stats.diskTotal)
  return (
    <div className="monitor-bar" dir="ltr" role="status" aria-label={t('serverMonitor')}>
      {stats.cpu !== null && <Meter label="CPU" value={stats.cpu} text={`${Math.round(stats.cpu)}%`} />}
      {mem !== null && <Meter label="RAM" value={mem} text={`${size(stats.memUsed!)} / ${size(stats.memTotal!)}`} />}
      {disk !== null && <Meter label={t('monitorDisk')} value={disk} text={`${size(stats.diskUsed!)} / ${size(stats.diskTotal!)}`} />}
      {stats.load !== null && <span className="monitor-item"><b>{t('monitorLoad')}</b> {stats.load.toFixed(2)}</span>}
      {stats.rxRate !== null && stats.txRate !== null && (
        <span className="monitor-item"><b>↓</b> {size(stats.rxRate)}/s <b>↑</b> {size(stats.txRate)}/s</span>
      )}
      {stats.uptime !== null && <span className="monitor-item"><b>{t('monitorUptime')}</b> {uptime(stats.uptime)}</span>}
    </div>
  )
}

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
  const level = value >= 90 ? 'hot' : value >= 70 ? 'warm' : 'ok'
  return (
    <span className="monitor-item" title={`${label} ${Math.round(value)}%`}>
      <b>{label}</b>
      <span className={`monitor-meter ${level}`}><i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></span>
      {text}
    </span>
  )
}

function ratio(used: number | null, total: number | null): number | null {
  if (used === null || !total) return null
  return (used / total) * 100
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
