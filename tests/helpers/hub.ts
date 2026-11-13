import { Hub } from '../../src/main/hub'
import { blankSession, type HubEvent, type Session } from '../../src/shared/types'

/** Hub over an in-memory store; every emitted event lands in `events`. */
export function makeHub(sessions: Session[] = [], secrets: Record<string, { password?: string }> = {}) {
  const known: Record<string, string> = {}
  const events: HubEvent[] = []
  const store = {
    data: { sessions, settings: { logAll: false } },
    secretsFor: (id: string) => secrets[id] ?? {},
    knownHost: (id: string) => known[id],
    setKnownHost: async (id: string, fingerprint: string) => {
      known[id] = fingerprint
    },
    recordSessionError: async () => undefined,
    recordSessionUsage: async () => undefined,
    addConnectionLog: async () => undefined,
    logsDir: () => '/tmp',
  }
  const contents = { isDestroyed: () => false, send: (_channel: string, event: HubEvent) => events.push(event) }
  const hub = new Hub(store as never, () => contents as never)
  return { hub, events, known }
}

export function sshSession(id: string, port: number, extra: Partial<Session> = {}): Session {
  return { ...blankSession('ssh', id), host: '127.0.0.1', port, username: 'hop', ...extra }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function until(check: () => boolean, timeout = 10_000, step = 20): Promise<void> {
  const end = Date.now() + timeout
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await sleep(step)
  }
}
