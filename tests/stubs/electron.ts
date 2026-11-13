import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = process.env.MYS_TEST_USERDATA || mkdtempSync(join(tmpdir(), 'mys-userdata-'))

export const app = {
  isPackaged: false,
  getPath: () => userData,
  getVersion: () => '0.0.0-test',
}

// Reversible stand-in so the sealed-secrets code path runs in tests.
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`stub:${text}`, 'utf8'),
  decryptString: (blob: Buffer) => blob.toString('utf8').replace(/^stub:/, ''),
}

export const shell = { openPath: async () => '', openExternal: async () => undefined, showItemInFolder: () => undefined }

export class Notification {
  static isSupported() {
    return false
  }
  show() {}
}

export const dialog = {
  showMessageBox: async () => ({ response: 1 }),
}

export type WebContents = { send: (channel: string, payload: unknown) => void; isDestroyed: () => boolean }
