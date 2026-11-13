import { existsSync, promises as fs } from 'node:fs'
import { utils, type ParsedKey } from 'ssh2'
import { tr } from './i18n'

const CERT_SUFFIX = /-cert-v0[01]@openssh\.com$/

/** `~/.ssh/id_ed25519` → `~/.ssh/id_ed25519-cert.pub` when it exists (what OpenSSH loads too). */
export function certificateFor(privateKeyPath: string, explicit?: string): string | null {
  if (explicit?.trim()) return explicit.trim()
  if (!privateKeyPath.trim()) return null
  const guess = `${privateKeyPath.trim()}-cert.pub`
  return existsSync(guess) ? guess : null
}

/**
 * A private key that presents an OpenSSH user certificate instead of its bare
 * public key. ssh2 signs with the original key; the patched Protocol.authPK
 * writes the base algorithm into the signature blob.
 */
export function certifiedKey(privateKey: Buffer | string, passphrase: string | undefined, certText: string): ParsedKey {
  const parsed = utils.parseKey(privateKey, passphrase)
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key || key instanceof Error) throw new Error(tr('keyReadFailed', { message: key instanceof Error ? key.message : '' }))
  const match = certText.trim().match(/^(\S+-cert-v0[01]@openssh\.com)\s+([A-Za-z0-9+/=]+)/)
  if (!match) throw new Error(tr('certInvalid'))
  const blob = Buffer.from(match[2], 'base64')
  const nameLength = blob.length >= 4 ? blob.readUInt32BE(0) : 0
  if (blob.subarray(4, 4 + nameLength).toString('latin1') !== match[1]) throw new Error(tr('certInvalid'))
  if (match[1].replace(CERT_SUFFIX, '') !== key.type) throw new Error(tr('certKeyMismatch'))

  const rsa = key.type === 'ssh-rsa'
  const wrapper = Object.create(key) as ParsedKey
  // RSA certificates are offered as rsa-sha2-512-cert so servers that refuse SHA-1 accept them.
  Object.defineProperty(wrapper, 'type', { value: rsa ? 'rsa-sha2-512-cert-v01@openssh.com' : match[1] })
  Object.defineProperty(wrapper, 'getPublicSSH', { value: () => blob })
  Object.defineProperty(wrapper, 'sign', { value: (data: Buffer, algo?: string) => key.sign(data, rsa ? 'sha512' : algo) })
  return wrapper
}

export async function readCertificate(path: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    throw new Error(tr('certReadFailed', { message: error instanceof Error ? error.message : '' }))
  }
}
