const TERMINAL_PROTOCOLS = new Set(['local', 'ssh', 'telnet', 'raw', 'serial', 'mosh', 'wsl', 'docker', 'k8s', 'powershell'])

export function isTerminalProtocol(protocol: string): boolean {
  return TERMINAL_PROTOCOLS.has(protocol)
}

/** Tabs whose side panel (files / scripts / history / theme) can open. */
export const SIDE_PANEL_PROTOCOLS = ['ssh', 'local', 'sftp', 'ftp', 's3']

export const FONT_MIN = 10
export const FONT_MAX = 24
export const FONT_DEFAULT = 13
