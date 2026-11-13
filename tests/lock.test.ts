import { describe, expect, it } from 'vitest'
import { AppLock, type LockConfig } from '../src/main/lock'

function makeLock(start?: LockConfig) {
  let clock = 1_000_000
  const store = {
    lockConfig: start,
    async setLockConfig(config: LockConfig | undefined) {
      store.lockConfig = config
    },
  }
  const changes: boolean[] = []
  const lock = new AppLock(store, (locked) => changes.push(locked), () => clock)
  return { lock, store, changes, advance: (ms: number) => { clock += ms } }
}

describe('AppLock', () => {
  it('starts unlocked without a password and locked with one', async () => {
    const first = makeLock()
    expect(first.lock.locked).toBe(false)
    await first.lock.setPassword('correct horse', 5)
    expect(first.store.lockConfig?.hash).toBeTruthy()
    expect(JSON.stringify(first.store.lockConfig)).not.toContain('correct horse')
    const second = makeLock(first.store.lockConfig)
    expect(second.lock.locked).toBe(true)
    first.lock.dispose()
    second.lock.dispose()
  })

  it('unlocks with the right password and backs off after wrong ones', async () => {
    const setup = makeLock()
    await setup.lock.setPassword('s3cret!', 0)
    const { lock, advance, changes } = makeLock(setup.store.lockConfig)
    expect(await lock.unlock('nope')).toMatchObject({ ok: false, code: 'wrong', retryIn: 1000 })
    expect(await lock.unlock('s3cret!')).toMatchObject({ ok: false, code: 'wait' })
    advance(1000)
    expect(await lock.unlock('nope')).toMatchObject({ ok: false, retryIn: 2000 })
    advance(2000)
    expect(await lock.unlock('s3cret!')).toEqual({ ok: true })
    expect(lock.locked).toBe(false)
    expect(changes).toEqual([false])
    lock.dispose()
    setup.lock.dispose()
  })

  it('locks after the idle limit unless there was activity', async () => {
    const { lock, advance, changes } = makeLock()
    await lock.setPassword('pass', 5)
    advance(4 * 60_000)
    lock.touch()
    advance(4 * 60_000)
    lock.checkIdle()
    expect(lock.locked).toBe(false)
    advance(60_000)
    lock.checkIdle()
    expect(lock.locked).toBe(true)
    expect(changes).toEqual([true])
    lock.dispose()
  })

  it('needs the current password to change or disable it', async () => {
    const { lock, store } = makeLock()
    await lock.setPassword('first', 15)
    await expect(lock.setPassword('second', 15, 'wrong')).rejects.toThrow()
    await lock.setPassword('second', 15, 'first')
    await expect(lock.disable('first')).rejects.toThrow()
    await lock.disable('second')
    expect(store.lockConfig).toBeUndefined()
    lock.dispose()
  })

  it('rejects passwords shorter than four characters', async () => {
    const { lock } = makeLock()
    await expect(lock.setPassword('abc', 5)).rejects.toThrow()
    lock.dispose()
  })
})
