import type { CSSProperties } from 'react'
import type { Protocol } from '../../shared/types'
import { hostIcon } from '../../shared/hostIcons'

export type ProtocolGroup = 'shell' | 'files' | 'desktop' | 'cloud'

interface ProtocolMeta {
  color: string
  group: ProtocolGroup
  icon: string[]
}

/** One colour + glyph per protocol. styles.css `.p-*` badges use the same hues. */
export const PROTOCOLS: Record<Protocol, ProtocolMeta> = {
  ssh: { color: '#3ad6b4', group: 'shell', icon: ['M4 5h16v14H4z', 'M8 10l2.5 2L8 14', 'M13 14h3'] },
  mosh: { color: '#74e3a6', group: 'shell', icon: ['M5 13a7 7 0 0 1 14 0', 'M8.5 13a3.5 3.5 0 0 1 7 0', 'M12 13v6'] },
  telnet: { color: '#f2c66d', group: 'shell', icon: ['M9 3v5', 'M15 3v5', 'M7 8h10v3a5 5 0 0 1-10 0z', 'M12 16v5'] },
  raw: { color: '#ec9f5e', group: 'shell', icon: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M13.5 5l-3 14'] },
  serial: { color: '#d39af0', group: 'shell', icon: ['M4 8h16v8H4z', 'M8 11h.01', 'M12 11h.01', 'M16 11h.01', 'M10 13.5h.01', 'M14 13.5h.01'] },
  powershell: { color: '#74a9ff', group: 'shell', icon: ['M7 5h14l-3 14H4z', 'M9 9l3 3-3 3', 'M13 15h3'] },
  wsl: { color: '#ffb86b', group: 'shell', icon: ['M4 5h16v14H4z', 'M4 9h16', 'M8 12.5l2 1.5-2 1.5'] },
  local: { color: '#9be38a', group: 'shell', icon: ['M3 5h18v11H3z', 'M8 20h8', 'M12 16v4'] },
  sftp: { color: '#4cc9f0', group: 'files', icon: ['M3 6h6l2 2h10v11H3z', 'M12 11v5', 'M9.5 13.5L12 16l2.5-2.5'] },
  ftp: { color: '#8ea9ff', group: 'files', icon: ['M3 6h6l2 2h10v11H3z', 'M8 14h7', 'M13 11.5l2.5 2.5-2.5 2.5'] },
  s3: { color: '#ff9f68', group: 'files', icon: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6l1.8 12.5c.3 1.4 2.9 2.5 6.2 2.5s5.9-1.1 6.2-2.5L20 6'] },
  rdp: { color: '#ff8a7a', group: 'desktop', icon: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4', 'M7 8h5v4H7z'] },
  vnc: { color: '#f5d76e', group: 'desktop', icon: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4', 'M9 10l3-3 3 3', 'M12 7v6'] },
  browser: { color: '#f38bc0', group: 'desktop', icon: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z'] },
  docker: { color: '#4fb4ff', group: 'cloud', icon: ['M3 12h18c0 4.2-3.6 7-9 7s-9-2.8-9-7z', 'M6 9h3v3H6z', 'M9 9h3v3H9z', 'M12 9h3v3h-3z', 'M9 6h3v3H9z'] },
  k8s: { color: '#97a6ff', group: 'cloud', icon: ['M12 3l7.5 3.6 1.8 8.1-5.2 6.3H7.9l-5.2-6.3 1.8-8.1z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M12 6v3.5', 'M12 14.5V18', 'M6.8 10.3l2.8 1', 'M14.4 12.7l2.8 1', 'M17.2 10.3l-2.8 1', 'M9.6 12.7l-2.8 1'] },
}

export const PROTOCOL_GROUPS: ProtocolGroup[] = ['shell', 'files', 'desktop', 'cloud']

export function protocolColor(protocol: Protocol): string {
  return PROTOCOLS[protocol]?.color ?? '#8ea0a6'
}

/** `--pc` drives tinted tiles/badges in CSS so a protocol looks the same everywhere. A host's own colour wins. */
export function protocolStyle(protocol: Protocol, color?: string): CSSProperties {
  return { ['--pc' as string]: color || protocolColor(protocol) }
}

/** The protocol glyph, or the host's chosen preset icon when it has one. */
export function ProtocolIcon({ protocol, size = 16, icon }: { protocol: Protocol; size?: number; icon?: string }) {
  const paths = hostIcon(icon)?.paths ?? PROTOCOLS[protocol]?.icon ?? PROTOCOLS.ssh.icon
  return (
    <svg className="proto-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {paths.map((path) => <path key={path} d={path} />)}
    </svg>
  )
}

/** Rounded tinted square holding the glyph. */
export function ProtocolMark({ protocol, size = 32, icon, color }: { protocol: Protocol; size?: number; icon?: string; color?: string }) {
  return (
    <i className="proto-mark" style={{ ...protocolStyle(protocol, color), width: size, height: size }} aria-hidden="true">
      <ProtocolIcon protocol={protocol} icon={icon} size={Math.round(size * 0.55)} />
    </i>
  )
}

/** Small list badge: the protocol's short label ("SSH"), or the host's icon when one is picked. */
export function HostBadge({ protocol, label, icon, color }: { protocol: Protocol; label: string; icon?: string; color?: string }) {
  const glyph = hostIcon(icon)
  return (
    <i
      className={`badge p-${protocol}${glyph ? ' has-icon' : ''}`}
      style={color ? protocolStyle(protocol, color) : undefined}
      title={glyph ? label : undefined}
    >
      {glyph ? <ProtocolIcon protocol={protocol} icon={icon} size={14} /> : label}
    </i>
  )
}
