import { utils } from 'ssh2'
import type { SshKeyAlgo } from '../shared/types'

export function generateSshKey(algo: SshKeyAlgo, passphrase = ''): Promise<{ privateKey: string; publicKey: string; keyType: SshKeyAlgo }> {
  if (algo === 'ml-dsa') return Promise.reject(new Error('ml-dsa-unsupported'))
  const type = algo === 'ecdsa' ? 'ecdsa' : algo === 'rsa' ? 'rsa' : 'ed25519'
  const options: { comment: string; passphrase?: string; bits?: number } = {
    comment: 'mys-terminal',
  }
  if (passphrase) options.passphrase = passphrase
  if (type === 'ecdsa') options.bits = 256
  if (type === 'rsa') options.bits = 2048
  return new Promise((resolve, reject) => {
    utils.generateKeyPair(type, options, (error, keys) => {
      if (error || !keys) {
        reject(error instanceof Error ? error : new Error('keygen-failed'))
        return
      }
      resolve({ privateKey: keys.private, publicKey: keys.public, keyType: algo })
    })
  })
}
