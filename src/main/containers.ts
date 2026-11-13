import { execFile } from 'node:child_process'
import type { OpenSpec } from '../shared/types'
import { tr } from './i18n'

export type CommandProtocol = 'wsl' | 'docker' | 'k8s' | 'powershell'

/** Prefer bash, fall back to sh: containers often ship only one of them. */
const SHELL_BOOT = ['sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash -l || exec sh -l']

/**
 * Container / pod / distro / context names. Spawned without a shell, so the only
 * risk is option injection: nothing may start with "-".
 */
function name(value: string | undefined, required: boolean): string {
  const v = (value ?? '').trim()
  if (!v) {
    if (required) throw new Error(tr('requiredFields'))
    return ''
  }
  if (v.startsWith('-') || !/^[\w.:/@+-]{1,253}$/.test(v)) throw new Error(tr('invalidName', { name: v }))
  return v
}

function shellArgs(shell: string | undefined): string[] {
  const value = shell?.trim()
  if (!value) return SHELL_BOOT
  if (value.startsWith('-')) throw new Error(tr('invalidName', { name: value }))
  return value.split(/\s+/)
}

/**
 * Program + arguments for a command session. Field use (shared with the dialog):
 * docker: host=container, username=user, domain=context, cwd=workdir
 * k8s:    host=pod, domain=namespace, username=container, url=kube context
 * wsl:    host=distribution, username=user, cwd=start dir
 */
export function commandFor(protocol: CommandProtocol, spec: OpenSpec, binary: string): { file: string; args: string[] } {
  if (protocol === 'docker') {
    const context = name(spec.domain, false)
    const user = name(spec.username, false)
    const args = [...(context ? ['--context', context] : []), 'exec', '-it']
    if (user) args.push('-u', user)
    if (spec.cwd?.trim()) args.push('-w', spec.cwd.trim())
    args.push(name(spec.host, true), ...shellArgs(spec.shell))
    return { file: binary, args }
  }
  if (protocol === 'k8s') {
    const context = name(spec.url, false)
    const namespace = name(spec.domain, false)
    const container = name(spec.username, false)
    const args = [...(context ? ['--context', context] : []), ...(namespace ? ['-n', namespace] : []), 'exec', '-it', name(spec.host, true)]
    if (container) args.push('-c', container)
    args.push('--', ...shellArgs(spec.shell))
    return { file: binary, args }
  }
  if (protocol === 'wsl') {
    const distro = name(spec.host, false)
    const user = name(spec.username, false)
    const args = [...(distro ? ['-d', distro] : []), ...(user ? ['-u', user] : []), '--cd', spec.cwd?.trim() || '~']
    return { file: binary, args }
  }
  return { file: spec.shell?.trim() || binary, args: ['-NoLogo'] }
}

/** Names to offer in the session dialog (running containers, pods, WSL distros). */
export function listTargets(protocol: 'docker' | 'k8s' | 'wsl', binary: string, scope: { context?: string; namespace?: string }): Promise<string[]> {
  let args: string[]
  if (protocol === 'docker') {
    const context = name(scope.context, false)
    args = [...(context ? ['--context', context] : []), 'ps', '--format', '{{.Names}}']
  } else if (protocol === 'k8s') {
    const context = name(scope.context, false)
    const namespace = name(scope.namespace, false)
    args = [...(context ? ['--context', context] : []), ...(namespace ? ['-n', namespace] : []), 'get', 'pods', '-o', 'jsonpath={.items[*].metadata.name}']
  } else {
    args = ['-l', '-q']
  }
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout: 15_000, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(decode(stderr).trim().split('\n')[0] || error.message))
        return
      }
      resolve(parseTargets(protocol, stdout))
    })
  })
}

export function parseTargets(protocol: 'docker' | 'k8s' | 'wsl', output: Buffer): string[] {
  const text = decode(output)
  const items = protocol === 'k8s' ? text.split(/\s+/) : text.split(/\r?\n/)
  return [...new Set(items.map((item) => item.replace(/\0/g, '').trim()).filter(Boolean))].sort()
}

/** `wsl.exe -l` answers in UTF-16LE (with or without BOM); everything else is UTF-8. */
function decode(buf: Buffer): string {
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0))) {
    return buf.toString('utf16le').replace(/^﻿/, '')
  }
  return buf.toString('utf8')
}
