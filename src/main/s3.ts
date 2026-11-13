import { createHash, createHmac } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { FileEntry } from '../shared/types'

export interface S3Auth {
  bucket: string
  region: string
  accessKey: string
  secretKey: string
  endpoint: string
}

export function s3Auth(input: { bucket: string; region?: string; accessKey: string; secretKey: string; endpoint?: string }): S3Auth {
  return {
    bucket: input.bucket.trim(),
    region: (input.region || 'us-east-1').trim() || 'us-east-1',
    accessKey: input.accessKey.trim(),
    secretKey: input.secretKey,
    endpoint: (input.endpoint || '').trim().replace(/\/$/, ''),
  }
}

export function s3Key(displayPath: string): string {
  return displayPath.replace(/^\/+/, '').replace(/\/+$/, '')
}

export async function s3List(auth: S3Auth, displayPath: string): Promise<{ path: string; entries: FileEntry[] }> {
  const folder = s3Key(displayPath)
  const prefix = folder ? `${folder}/` : ''
  const entries: FileEntry[] = []
  let token = ''
  do {
    const query: Record<string, string> = { 'list-type': '2', delimiter: '/', 'max-keys': '1000', prefix }
    if (token) query['continuation-token'] = token
    const xml = (await s3Send(auth, 'GET', '', query)).toString('utf8')
    for (const block of blocks(xml, 'CommonPrefixes')) {
      const name = text(block, 'Prefix').slice(prefix.length).replace(/\/$/, '')
      if (name) entries.push({ name, size: 0, mtime: 0, isDir: true, isLink: false, mode: '' })
    }
    for (const block of blocks(xml, 'Contents')) {
      const key = text(block, 'Key')
      if (!key || key === prefix) continue
      const name = key.slice(prefix.length)
      if (!name || name.includes('/')) continue
      entries.push({
        name,
        size: Number(text(block, 'Size')) || 0,
        mtime: Date.parse(text(block, 'LastModified')) || 0,
        isDir: false,
        isLink: false,
        mode: '',
      })
    }
    token = text(xml, 'NextContinuationToken')
  } while (token)
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return { path: folder ? `/${folder}` : '/', entries }
}

export async function s3Put(auth: S3Auth, key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  await s3Send(auth, 'PUT', key, {}, Buffer.from(body), { 'content-type': contentType })
}

export async function s3Get(auth: S3Auth, key: string): Promise<Buffer> {
  return s3Send(auth, 'GET', key, {})
}

export async function s3Delete(auth: S3Auth, key: string): Promise<void> {
  await s3Send(auth, 'DELETE', key, {})
}

export async function s3Keys(auth: S3Auth, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token = ''
  do {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000', prefix }
    if (token) query['continuation-token'] = token
    const xml = (await s3Send(auth, 'GET', '', query)).toString('utf8')
    for (const block of blocks(xml, 'Contents')) {
      const key = text(block, 'Key')
      if (key) keys.push(key)
    }
    token = text(xml, 'NextContinuationToken')
  } while (token)
  return keys
}

export async function s3Copy(auth: S3Auth, from: string, to: string): Promise<void> {
  const source = `/${auth.bucket}/${from.split('/').map(encodeURIComponent).join('/')}`
  await s3Send(auth, 'PUT', to, {}, Buffer.alloc(0), { 'x-amz-copy-source': source })
}

async function s3Send(auth: S3Auth, method: string, key: string, query: Record<string, string>, body: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}): Promise<Buffer> {
  const custom = auth.endpoint ? new URL(auth.endpoint) : null
  const host = custom ? custom.host : `${auth.bucket}.s3.${auth.region}.amazonaws.com`
  const base = custom ? `/${auth.bucket}${key ? `/${encodePath(key)}` : ''}` : `/${encodePath(key)}`
  const path = base || '/'
  const queryText = Object.keys(query).sort().map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`).join('&')
  const now = new Date()
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amz.slice(0, 8)
  const payload = sha256(body)
  const headers: Record<string, string> = {
    host,
    'x-amz-date': amz,
    'x-amz-content-sha256': payload,
    ...extra,
  }
  const signed = Object.keys(headers).map((name) => name.toLowerCase()).sort()
  const canonical = [
    method,
    path,
    queryText,
    ...signed.map((name) => `${name}:${headers[name].trim()}`),
    '',
    signed.join(';'),
    payload,
  ].join('\n')
  const scope = `${day}/${auth.region}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256(canonical)}`
  const kDate = hmac(`AWS4${auth.secretKey}`, day)
  const kRegion = hmac(kDate, auth.region)
  const kService = hmac(kRegion, 's3')
  const signature = createHmac('sha256', hmac(kService, 'aws4_request')).update(stringToSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${auth.accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`
  const target = `${custom?.protocol || 'https:'}//${host}${path}${queryText ? `?${queryText}` : ''}`
  const result = await rawRequest(target, method, headers, body)
  if (result.status >= 400) {
    const message = text(result.body.toString('utf8'), 'Message') || `S3 ${result.status}`
    throw new Error(message)
  }
  return result.body
}

function rawRequest(target: string, method: string, headers: Record<string, string>, body: Buffer): Promise<{ status: number; body: Buffer }> {
  const url = new URL(target)
  const send = url.protocol === 'http:' ? httpRequest : httpsRequest
  return new Promise((resolve, reject) => {
    const req = send(url, { method, headers: { ...headers, 'content-length': String(body.length) } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    if (body.length) req.write(body)
    req.end()
  })
}

function encodePath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function blocks(xml: string, tag: string): string[] {
  const found: string[] = []
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  let match = re.exec(xml)
  while (match) {
    found.push(match[1])
    match = re.exec(xml)
  }
  return found
}

function text(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match ? decodeXml(match[1]) : ''
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
