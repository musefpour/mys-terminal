import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { tr } from './i18n'

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>
const COST = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export interface LockConfig {
  salt: string
  hash: string
  /** Idle minutes before locking; 0 = only on start and on demand. */
  minutes: number
}

export interface LockStore {
  lockConfig: LockConfig | undefined
  setLockConfig(config: LockConfig | undefined): Promise<void>
}

export const LOCK_MINUTES = [0, 1, 5, 10, 15, 30, 60]

/**
 * Master password gate. While locked the main process refuses every IPC call
 * except the lock screen's own, so the UI overlay is not the only barrier.
 */
export class AppLock {
  locked: boolean
  private lastActivity = Date.now()
  private failures = 0
  private blockedUntil = 0
  private timer: NodeJS.Timeout

  constructor(private store: LockStore, private onChange: (locked: boolean) => void, private now = () => Date.now()) {
    this.locked = Boolean(store.lockConfig)
    this.timer = setInterval(() => this.checkIdle(), 15_000)
    this.timer.unref?.()
  }

  get enabled(): boolean {
    return Boolean(this.store.lockConfig)
  }

  get minutes(): number {
    return this.store.lockConfig?.minutes ?? 0
  }

  retryIn(): number {
    return Math.max(0, this.blockedUntil - this.now())
  }

  touch(): void {
    if (!this.locked) this.lastActivity = this.now()
  }

  lock(): void {
    if (!this.enabled || this.locked) return
    this.locked = true
    this.onChange(true)
  }

  async unlock(password: string): Promise<{ ok: true } | { ok: false; code: 'wrong' | 'wait'; retryIn: number }> {
    if (!this.locked) return { ok: true }
    if (this.retryIn() > 0) return { ok: false, code: 'wait', retryIn: this.retryIn() }
    if (await this.verify(password)) {
      this.failures = 0
      this.blockedUntil = 0
      this.locked = false
      this.lastActivity = this.now()
      this.onChange(false)
      return { ok: true }
    }
    this.failures += 1
    // 1s, 2s, 4s … capped at 30s after repeated misses.
    this.blockedUntil = this.now() + Math.min(30_000, 1000 * 2 ** (this.failures - 1))
    return { ok: false, code: 'wrong', retryIn: this.retryIn() }
  }

  /** Turn the lock on, or change the password (then `current` must match). */
  async setPassword(next: string, minutes: number, current?: string): Promise<void> {
    if (this.enabled && !(await this.verify(current || ''))) throw new Error(tr('lockWrongPassword'))
    if (next.length < 4) throw new Error(tr('lockTooShort'))
    const salt = randomBytes(16)
    const hash = await scrypt(next, salt, 32, COST)
    await this.store.setLockConfig({ salt: salt.toString('base64'), hash: hash.toString('base64'), minutes: normalizeMinutes(minutes) })
    this.lastActivity = this.now()
  }

  async setMinutes(minutes: number): Promise<void> {
    const config = this.store.lockConfig
    if (!config) return
    await this.store.setLockConfig({ ...config, minutes: normalizeMinutes(minutes) })
  }

  async disable(current: string): Promise<void> {
    if (!this.enabled) return
    if (!(await this.verify(current))) throw new Error(tr('lockWrongPassword'))
    await this.store.setLockConfig(undefined)
    this.locked = false
  }

  checkIdle(): void {
    const minutes = this.minutes
    if (!this.enabled || this.locked || minutes <= 0) return
    if (this.now() - this.lastActivity >= minutes * 60_000) this.lock()
  }

  dispose(): void {
    clearInterval(this.timer)
  }

  private async verify(password: string): Promise<boolean> {
    const config = this.store.lockConfig
    if (!config) return true
    const expected = Buffer.from(config.hash, 'base64')
    const actual = await scrypt(password, Buffer.from(config.salt, 'base64'), expected.length, COST)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
}

function normalizeMinutes(value: number): number {
  const n = Math.round(Number(value) || 0)
  return LOCK_MINUTES.includes(n) ? n : 15
}
