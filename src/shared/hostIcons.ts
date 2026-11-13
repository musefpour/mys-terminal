/**
 * Preset icons a host can wear instead of its protocol glyph. 24×24 stroke paths, drawn in the
 * same line style as renderer/src/protocols.tsx. Ids are stored on the session, so never rename one.
 */
export type HostIconGroup = 'infra' | 'data' | 'apps' | 'env' | 'places'

export interface HostIcon {
  id: string
  group: HostIconGroup
  /** English search words; the picker also matches the id. */
  tags: string
  paths: string[]
}

export const HOST_ICON_GROUPS: HostIconGroup[] = ['infra', 'data', 'apps', 'env', 'places']

export const HOST_ICONS: HostIcon[] = [
  // ── infrastructure ──
  { id: 'server', group: 'infra', tags: 'server rack machine vps', paths: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01', 'M12 7h4', 'M12 17h4'] },
  { id: 'rack', group: 'infra', tags: 'rack datacenter cluster', paths: ['M5 3h14v18H5z', 'M5 9h14', 'M5 15h14', 'M8.5 6h.01', 'M8.5 12h.01', 'M8.5 18h.01'] },
  { id: 'cloud', group: 'infra', tags: 'cloud aws azure gcp', paths: ['M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.4 4.4 0 0 0 7 18z'] },
  { id: 'cpu', group: 'infra', tags: 'cpu chip compute processor', paths: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M10 3v4', 'M14 3v4', 'M10 17v4', 'M14 17v4', 'M3 10h4', 'M3 14h4', 'M17 10h4', 'M17 14h4'] },
  { id: 'disk', group: 'infra', tags: 'disk drive storage nas hdd ssd', paths: ['M3 13l2.5-7h13l2.5 7v5H3z', 'M3 13h18', 'M16.5 15.5h.01', 'M7 15.5h5'] },
  { id: 'box', group: 'infra', tags: 'container package box docker', paths: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'] },
  { id: 'layers', group: 'infra', tags: 'layers stack platform', paths: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'] },
  { id: 'helm', group: 'infra', tags: 'kubernetes helm wheel orchestration', paths: ['M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4', 'M4.9 4.9l2.85 2.85', 'M16.25 16.25l2.85 2.85', 'M4.9 19.1l2.85-2.85', 'M16.25 7.75l2.85-2.85'] },
  { id: 'router', group: 'infra', tags: 'router network gateway', paths: ['M3 14h18v6H3z', 'M7 17h.01', 'M11 17h.01', 'M15 17h3', 'M12 14V9', 'M8.5 7a5 5 0 0 1 7 0', 'M6 4.5a8.5 8.5 0 0 1 12 0'] },
  { id: 'network', group: 'infra', tags: 'network topology nodes mesh vpn', paths: ['M12 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M19 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M10.8 8.2l-4.6 7.6', 'M13.2 8.2l4.6 7.6', 'M7.5 18h9'] },
  { id: 'shield', group: 'infra', tags: 'shield firewall security waf', paths: ['M12 3l8 3v5.5c0 4.7-3.3 8.4-8 9.5-4.7-1.1-8-4.8-8-9.5V6z', 'M8.5 12l2.5 2.5 4.5-5'] },
  { id: 'lock', group: 'infra', tags: 'lock vault secure secret', paths: ['M5 11h14v10H5z', 'M8 11V7.5a4 4 0 0 1 8 0V11', 'M12 15v2.5'] },
  { id: 'key', group: 'infra', tags: 'key auth bastion ssh', paths: ['M8 10.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M11.2 11.8L20 3', 'M16.5 6.5l2.5 2.5', 'M14 9l2 2'] },
  { id: 'terminal', group: 'infra', tags: 'terminal shell console cli', paths: ['M3 5h18v14H3z', 'M7 10l3 2.5L7 15', 'M12.5 15H17'] },
  { id: 'gpu', group: 'infra', tags: 'gpu graphics card ml', paths: ['M2 7h18v10H2z', 'M20 10h2', 'M9 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M15 10v4', 'M5 17v3', 'M9 17v3'] },
  { id: 'satellite', group: 'infra', tags: 'satellite remote edge iot', paths: ['M13 7l4 4-6 6-4-4z', 'M10 4l3 3', 'M17 11l3 3', 'M4.5 13.5a6 6 0 0 0 6 6', 'M4 18l2-2'] },

  // ── data ──
  { id: 'database', group: 'data', tags: 'database db sql postgres mysql', paths: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'] },
  { id: 'cache', group: 'data', tags: 'cache redis memory fast', paths: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3', 'M20 6v4', 'M15.5 13L13 17.5h4L14.5 22'] },
  { id: 'table', group: 'data', tags: 'table sheet grid data', paths: ['M3 4h18v16H3z', 'M3 9h18', 'M3 14.5h18', 'M9 4v16'] },
  { id: 'chart', group: 'data', tags: 'chart metrics grafana analytics', paths: ['M4 4v16h16', 'M8 15l3.5-4 3 2.5L20 7'] },
  { id: 'pulse', group: 'data', tags: 'monitor pulse health uptime', paths: ['M3 12h4l2.5-6 4 12 2.5-6H21'] },
  { id: 'archive', group: 'data', tags: 'archive backup cold', paths: ['M3 4h18v5H3z', 'M5 9v11h14V9', 'M10 13h4'] },
  { id: 'backup', group: 'data', tags: 'backup sync restore', paths: ['M20 12a8 8 0 1 1-2.35-5.65', 'M20 4v5h-5', 'M12 8v4l3 2'] },
  { id: 'folder', group: 'data', tags: 'folder files share', paths: ['M3 6h6l2 2h10v11H3z'] },
  { id: 'logs', group: 'data', tags: 'logs file text elk', paths: ['M6 3h9l4 4v14H6z', 'M15 3v4h4', 'M9 11h7', 'M9 14.5h7', 'M9 18h4'] },
  { id: 'queue', group: 'data', tags: 'queue kafka rabbitmq stream', paths: ['M3 7h4v10H3z', 'M10 7h4v10h-4z', 'M17 7h4v10h-4z'] },

  // ── apps ──
  { id: 'globe', group: 'apps', tags: 'web website globe internet', paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z'] },
  { id: 'code', group: 'apps', tags: 'code api backend', paths: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M13.5 5l-3 14'] },
  { id: 'git', group: 'apps', tags: 'git repo gitlab ci', paths: ['M6 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M6 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M18 6.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M6 7.5v9', 'M18 10.5c0 4-6 3-11 6.5'] },
  { id: 'mail', group: 'apps', tags: 'mail smtp email', paths: ['M3 5h18v14H3z', 'M3 6l9 7 9-7'] },
  { id: 'chat', group: 'apps', tags: 'chat message bot', paths: ['M4 4h16v12H9l-5 4z', 'M8 9h8', 'M8 12h5'] },
  { id: 'rocket', group: 'apps', tags: 'rocket deploy launch', paths: ['M12 15l-3-3c1.5-4.5 4.5-8 10-9-1 5.5-4.5 8.5-9 10z', 'M9 12l-4 .5L3 15l4.5 1.5', 'M12 15l-.5 4L9 21l-1.5-4.5', 'M15 7.5h.01'] },
  { id: 'bolt', group: 'apps', tags: 'bolt fast function lambda serverless', paths: ['M13 2L4 14h7l-1 8 9-12h-7z'] },
  { id: 'cart', group: 'apps', tags: 'shop store cart ecommerce', paths: ['M3 4h2.5l2.2 10.5h10.6L20.5 7H6.6', 'M9 18.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z', 'M17 18.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z'] },
  { id: 'card', group: 'apps', tags: 'payment billing card finance', paths: ['M3 6h18v12H3z', 'M3 10h18', 'M7 14.5h4'] },
  { id: 'media', group: 'apps', tags: 'media video stream play', paths: ['M3 5h18v14H3z', 'M10 9v6l5-3z'] },
  { id: 'music', group: 'apps', tags: 'music audio', paths: ['M9 18V5l11-2v13', 'M6.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M17.5 13.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'] },
  { id: 'camera', group: 'apps', tags: 'camera cctv nvr', paths: ['M3 7h4l2-2.5h6L17 7h4v12H3z', 'M12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'] },
  { id: 'game', group: 'apps', tags: 'game server minecraft', paths: ['M6 8h12a4 4 0 0 1 3.8 5.3l-1.1 3.3a2.5 2.5 0 0 1-4.2.9L14.5 15h-5l-2 2.5a2.5 2.5 0 0 1-4.2-.9l-1.1-3.3A4 4 0 0 1 6 8z', 'M8 10.5v3', 'M6.5 12h3', 'M15.5 11h.01', 'M17.5 13h.01'] },
  { id: 'robot', group: 'apps', tags: 'robot ai bot llm automation', paths: ['M5 8h14v11H5z', 'M12 4v4', 'M12 3.5h.01', 'M9 13h.01', 'M15 13h.01', 'M9.5 16h5', 'M2.5 12v3', 'M21.5 12v3'] },
  { id: 'phone', group: 'apps', tags: 'phone mobile voip sip', paths: ['M7 2.5h10v19H7z', 'M11 18.5h2'] },
  { id: 'printer', group: 'apps', tags: 'printer print office', paths: ['M7 9V3h10v6', 'M4 9h16v8h-3', 'M7 17H4', 'M7 14h10v7H7z'] },

  // ── environments ──
  { id: 'flame', group: 'env', tags: 'production prod live hot fire', paths: ['M12 21c-3.9 0-7-2.7-7-6.5 0-3 1.8-4.9 3.3-6.4.5 1.6 1.4 2.6 2.7 3C11 7.5 12.5 4.6 15 3c-.2 3 1.2 4.6 2.6 6.4C18.9 11 19 12.4 19 14.5c0 3.8-3.1 6.5-7 6.5z'] },
  { id: 'flask', group: 'env', tags: 'staging lab test experiment', paths: ['M9 3h6', 'M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3', 'M7.5 15h9'] },
  { id: 'bug', group: 'env', tags: 'debug test qa bug', paths: ['M8 9h8v6a4 4 0 0 1-8 0z', 'M9.5 9a2.5 2.5 0 0 1 5 0', 'M12 12v7', 'M4 11l4 1', 'M20 11l-4 1', 'M4 17l4-1.5', 'M20 17l-4-1.5', 'M9 4.5L10 6', 'M15 4.5L14 6'] },
  { id: 'wrench', group: 'env', tags: 'maintenance tools ops dev', paths: ['M14.5 4a5 5 0 0 0-5.3 6.6L3.5 16.3a1.8 1.8 0 0 0 2.5 2.5l5.7-5.7A5 5 0 0 0 18.3 7.8l-3 3-2.4-.6-.6-2.4 3-3a5 5 0 0 0-.8-.8z'] },
  { id: 'gear', group: 'env', tags: 'settings config service', paths: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M12 2.5l1.6 2.6 3-.6.8 3 2.6 1.6-1.3 2.9 1.3 2.9-2.6 1.6-.8 3-3-.6L12 21.5l-1.6-2.6-3 .6-.8-3-2.6-1.6L5.3 12 4 9.1l2.6-1.6.8-3 3 .6z'] },
  { id: 'beaker', group: 'env', tags: 'sandbox playground dev', paths: ['M6 3h12', 'M7 3v15a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V3', 'M7 12h10'] },
  { id: 'star', group: 'env', tags: 'star favorite important', paths: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'] },
  { id: 'heart', group: 'env', tags: 'heart personal love', paths: ['M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z'] },
  { id: 'flag', group: 'env', tags: 'flag milestone release', paths: ['M5 21V4', 'M5 4h12l-2.5 4L17 12H5'] },
  { id: 'crown', group: 'env', tags: 'crown primary master main', paths: ['M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z'] },
  { id: 'leaf', group: 'env', tags: 'leaf green eco low', paths: ['M5 19c0-8 5-13.5 15-14-.5 10-6 15-14 15', 'M5 19l7-7'] },
  { id: 'snow', group: 'env', tags: 'cold freeze archive frozen', paths: ['M12 2v20', 'M3.3 7l17.4 10', 'M3.3 17L20.7 7', 'M9.5 3.5L12 6l2.5-2.5', 'M9.5 20.5L12 18l2.5 2.5'] },

  // ── places & people ──
  { id: 'home', group: 'places', tags: 'home homelab house', paths: ['M3.5 11L12 4l8.5 7', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'] },
  { id: 'office', group: 'places', tags: 'office building company work', paths: ['M4 21V4h11v17', 'M15 9h5v12', 'M3 21h18', 'M7.5 8h.01', 'M11.5 8h.01', 'M7.5 12h.01', 'M11.5 12h.01', 'M7.5 16h.01', 'M11.5 16h.01'] },
  { id: 'factory', group: 'places', tags: 'factory plant industrial ot', paths: ['M3 21V11l6 3.5V11l6 3.5V5h4v16z', 'M3 21h18', 'M7 17.5h2', 'M12 17.5h2'] },
  { id: 'school', group: 'places', tags: 'school university education', paths: ['M2 9l10-5 10 5-10 5z', 'M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5', 'M22 9v5'] },
  { id: 'hospital', group: 'places', tags: 'hospital clinic health', paths: ['M4 4h16v17H4z', 'M12 8v6', 'M9 11h6', 'M10 21v-3h4v3'] },
  { id: 'pin', group: 'places', tags: 'location region site branch', paths: ['M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z', 'M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'] },
  { id: 'user', group: 'places', tags: 'user person personal client', paths: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'] },
  { id: 'team', group: 'places', tags: 'team group users shared', paths: ['M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 5.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.5a6.5 6.5 0 0 1 3.5 5.5'] },
  { id: 'wifi', group: 'places', tags: 'wifi wireless access point', paths: ['M2.5 9a14 14 0 0 1 19 0', 'M5.5 12.5a9.5 9.5 0 0 1 13 0', 'M8.7 16a5 5 0 0 1 6.6 0', 'M12 19.5h.01'] },
  { id: 'laptop', group: 'places', tags: 'laptop workstation desktop pc', paths: ['M5 5h14v10H5z', 'M2.5 19h19l-2.5-4H5z'] },
]

export const HOST_ICON_IDS = new Set(HOST_ICONS.map((icon) => icon.id))

export function hostIcon(id: string | undefined): HostIcon | undefined {
  return id ? HOST_ICONS.find((icon) => icon.id === id) : undefined
}

/** Tints offered next to the icons. '' means "use the protocol colour". */
export const HOST_COLORS = [
  '#3ad6b4', '#5fd38d', '#9be38a', '#f5d76e', '#ffb86b', '#ff8a7a',
  '#ff6b9a', '#d39af0', '#a48bff', '#74a9ff', '#4cc9f0', '#8ea0a6',
]

export const isHostColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
