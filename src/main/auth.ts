import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, Notification, shell } from 'electron'
import { normalizeHandle, type Account } from '../shared/types'

const scryptAsync = promisify(scrypt)

export type AuthFailure =
  | 'phone-invalid'
  | 'code-invalid'
  | 'code-expired'
  | 'google-failed'
  | 'google-client'
  | 'cancelled'
  | 'password-short'
  | 'password-mismatch'
  | 'account-exists'
  | 'account-missing'
  | 'password-wrong'
  | 'proof-invalid'
  | 'username-invalid'
  | 'username-taken'
  | 'username-missing'

interface PendingPhone {
  hash: Buffer
  expires: number
  attempts: number
  nextAt: number
  purpose: 'signup' | 'reset'
}

interface PhoneUser {
  salt: string
  hash: string
  username?: string
}

interface Profile {
  id: string
  name: string
  username: string
  email?: string
}

interface Proof {
  token: string
  expires: number
  purpose: 'signup' | 'reset'
}

const phones = new Map<string, PendingPhone>()
const proofs = new Map<string, Proof>()
let googleClientId = ''
let account: Account | null = null
let users: Record<string, PhoneUser> = {}
let profiles: Record<string, Profile> = {}
let emails: Record<string, { id: string; name: string }> = {}
let remembered = true

function configPath(): string {
  return join(app.getPath('userData'), 'auth.json')
}

export async function loadAuth(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(configPath(), 'utf8')) as {
      googleClientId?: string
      account?: Account | null
      users?: Record<string, PhoneUser>
      profiles?: Record<string, Profile>
      emails?: Record<string, { id: string; name: string }>
    }
    googleClientId = raw.googleClientId || process.env.MYS_GOOGLE_CLIENT_ID || ''
    account = raw.account ?? null
    users = raw.users ?? {}
    profiles = raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {}
    emails = raw.emails && typeof raw.emails === 'object' ? raw.emails : {}
    for (const [phone, user] of Object.entries(users)) {
      const username = normalizeHandle(user.username || '')
      if (!username) continue
      profiles[username] = { id: phone, name: profiles[username]?.name || phone, username, email: profiles[username]?.email }
    }
    if (account?.username) account = { ...account, username: normalizeHandle(account.username) || undefined }
    if (account?.email) rememberEmail(account.email, account.id, account.name)
    remembered = true
  } catch {
    googleClientId = process.env.MYS_GOOGLE_CLIENT_ID || ''
    account = null
  }
}

async function persist(): Promise<void> {
  await writeFile(configPath(), JSON.stringify({ googleClientId, users, profiles, emails, account: remembered ? account : null }, null, 2), 'utf8')
}

function rememberEmail(raw: string, id: string, name: string): void {
  const email = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
  emails[email] = { id, name: name || email }
}

export function currentAccount(): Account | null {
  return account
}

export function currentGoogleClient(): string {
  return googleClientId
}

export async function saveGoogleClient(clientId: string): Promise<void> {
  googleClientId = clientId.trim()
  await persist()
}

export async function signOut(): Promise<void> {
  account = null
  remembered = true
  await persist()
}

export function normalizePhone(input: string): string | null {
  let value = input.trim().replace(/[\s()-]/g, '')
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (value.startsWith('09')) value = `+98${value.slice(1)}`
  if (/^9\d{9}$/.test(value)) value = `+98${value}`
  if (value.startsWith('98') && !value.startsWith('+')) value = `+${value}`
  if (!value.startsWith('+')) value = `+${value.replace(/\D/g, '')}`
  if (!/^\+[1-9]\d{9,14}$/.test(value)) return null
  return value
}

export async function requestPhoneCode(input: string, purpose: 'signup' | 'reset'): Promise<{ ok: true; phone: string; delivery: 'sms' | 'device' } | { ok: false; code: AuthFailure }> {
  const phone = normalizePhone(input)
  if (!phone) return { ok: false, code: 'phone-invalid' }
  if (purpose === 'signup' && users[phone]) return { ok: false, code: 'account-exists' }
  if (purpose === 'reset' && !users[phone]) return { ok: false, code: 'account-missing' }
  const existing = phones.get(phone)
  if (existing && existing.purpose === purpose && existing.nextAt > Date.now() && existing.expires > Date.now()) {
    return { ok: true, phone, delivery: 'device' }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  phones.set(phone, {
    hash: createHash('sha256').update(`${phone}:${code}`).digest(),
    expires: Date.now() + 5 * 60 * 1000,
    attempts: 0,
    nextAt: Date.now() + 30_000,
    purpose,
  })
  const sent = await sendSms(phone, code)
  if (!sent) showCode(code)
  return { ok: true, phone, delivery: sent ? 'sms' : 'device' }
}

export async function verifyPhoneCode(input: string, code: string): Promise<{ ok: true; phone: string; proof: string } | { ok: false; code: AuthFailure }> {
  const phone = normalizePhone(input)
  if (!phone) return { ok: false, code: 'phone-invalid' }
  const pending = phones.get(phone)
  if (!pending || pending.expires < Date.now()) {
    phones.delete(phone)
    return { ok: false, code: 'code-expired' }
  }
  pending.attempts += 1
  const given = createHash('sha256').update(`${phone}:${code.trim()}`).digest()
  const match = given.length === pending.hash.length && timingSafeEqual(given, pending.hash)
  if (!match || pending.attempts > 5) {
    if (pending.attempts > 5) phones.delete(phone)
    return { ok: false, code: 'code-invalid' }
  }
  const token = randomBytes(24).toString('base64url')
  proofs.set(phone, { token, expires: Date.now() + 10 * 60 * 1000, purpose: pending.purpose })
  phones.delete(phone)
  return { ok: true, phone, proof: token }
}

export async function completeSignup(input: string, proof: string, password: string, confirm: string, handle: string): Promise<{ ok: true; account: Account } | { ok: false; code: AuthFailure }> {
  const checked = checkPasswordPair(password, confirm)
  if (checked) return checked
  const username = normalizeHandle(handle)
  if (!username) return { ok: false, code: 'username-invalid' }
  if (profiles[username]) return { ok: false, code: 'username-taken' }
  const phone = takeProof(input, proof, 'signup')
  if (!phone) return { ok: false, code: 'proof-invalid' }
  if (users[phone]) return { ok: false, code: 'account-exists' }
  const hashed = await hashPassword(password)
  users[phone] = { ...hashed, username }
  profiles[username] = { id: phone, name: phone, username }
  return sealPhone(phone, true)
}

export async function resetPassword(input: string, proof: string, password: string, confirm: string): Promise<{ ok: true; account: Account } | { ok: false; code: AuthFailure }> {
  const checked = checkPasswordPair(password, confirm)
  if (checked) return checked
  const phone = takeProof(input, proof, 'reset')
  if (!phone || !users[phone]) return { ok: false, code: 'proof-invalid' }
  users[phone] = await hashPassword(password)
  return sealPhone(phone, true)
}

export async function loginWithPassword(input: string, password: string, remember: boolean): Promise<{ ok: true; account: Account } | { ok: false; code: AuthFailure }> {
  const phone = normalizePhone(input)
  if (!phone) return { ok: false, code: 'phone-invalid' }
  const user = users[phone]
  if (!user) return { ok: false, code: 'account-missing' }
  if (!(await passwordMatches(password, user))) return { ok: false, code: 'password-wrong' }
  return sealPhone(phone, remember)
}

export function signInWithGoogle(): Promise<{ ok: true; account: Account } | { ok: false; code: AuthFailure }> {
  if (!googleClientId) return Promise.resolve({ ok: false, code: 'google-client' })
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')
  return new Promise((resolve) => {
    let done = false
    const server = createServer()
    const finish = (value: { ok: true; account: Account } | { ok: false; code: AuthFailure }) => {
      if (done) return
      done = true
      clearTimeout(timer)
      server.close()
      resolve(value)
    }
    const timer = setTimeout(() => finish({ ok: false, code: 'cancelled' }), 120_000)
    server.on('request', (request, response) => {
      void onGoogleRequest(request, response, state, verifier, finish)
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const redirect = `http://127.0.0.1:${port}/callback`
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.searchParams.set('client_id', googleClientId)
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'openid email profile')
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', state)
      url.searchParams.set('prompt', 'select_account')
      ;(server as ServerWithRedirect).redirectUri = redirect
      void shell.openExternal(url.toString()).catch(() => finish({ ok: false, code: 'google-failed' }))
    })
  })
}

interface ServerWithRedirect {
  redirectUri?: string
}

async function onGoogleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: string,
  verifier: string,
  finish: (value: { ok: true; account: Account } | { ok: false; code: AuthFailure }) => void,
): Promise<void> {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const page = (text: string) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:32px">${text}</body>`)
  }
  if (url.pathname !== '/callback') {
    response.writeHead(404)
    response.end()
    return
  }
  const redirect = (request.socket.server as ServerWithRedirect).redirectUri || ''
  const authCode = url.searchParams.get('code') || ''
  if (url.searchParams.get('state') !== state || !authCode || !redirect) {
    page('ورود انجام نشد. این پنجره را ببندید.')
    finish({ ok: false, code: 'google-failed' })
    return
  }
  page('ورود انجام شد. این پنجره را ببندید.')
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: googleClientId,
        code: authCode,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirect,
      }),
    })
    if (!tokenRes.ok) {
      finish({ ok: false, code: 'google-failed' })
      return
    }
    const token = await tokenRes.json() as { access_token?: string }
    if (!token.access_token) {
      finish({ ok: false, code: 'google-failed' })
      return
    }
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    if (!profileRes.ok) {
      finish({ ok: false, code: 'google-failed' })
      return
    }
    const profile = await profileRes.json() as { sub?: string; name?: string; email?: string; picture?: string }
    if (!profile.sub) {
      finish({ ok: false, code: 'google-failed' })
      return
    }
    const known = Object.values(profiles).find((item) => item.id === profile.sub)
    account = {
      provider: 'google',
      id: profile.sub,
      name: profile.name || profile.email || 'Google',
      username: known?.username,
      email: profile.email,
      picture: profile.picture,
    }
    if (profile.email) rememberEmail(profile.email, profile.sub, account.name)
    remembered = true
    await persist()
    finish({ ok: true, account })
  } catch {
    finish({ ok: false, code: 'google-failed' })
  }
}

function takeProof(input: string, proof: string, purpose: 'signup' | 'reset'): string | null {
  const phone = normalizePhone(input)
  if (!phone) return null
  const pending = proofs.get(phone)
  if (!pending || pending.purpose !== purpose || pending.expires < Date.now() || pending.token !== proof) return null
  proofs.delete(phone)
  return phone
}

function checkPasswordPair(password: string, confirm: string): { ok: false; code: AuthFailure } | null {
  if (password.length < 6) return { ok: false, code: 'password-short' }
  if (password !== confirm) return { ok: false, code: 'password-mismatch' }
  return null
}

async function hashPassword(password: string): Promise<PhoneUser> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32) as Buffer
  return { salt: salt.toString('base64url'), hash: hash.toString('base64url') }
}

async function passwordMatches(password: string, user: PhoneUser): Promise<boolean> {
  const next = await scryptAsync(password, Buffer.from(user.salt, 'base64url'), 32) as Buffer
  const prev = Buffer.from(user.hash, 'base64url')
  return next.length === prev.length && timingSafeEqual(next, prev)
}

export function lookupUsername(raw: string): { ok: true; username: string; name: string } | { ok: false; code: 'username-invalid' | 'username-missing' } {
  const username = normalizeHandle(raw)
  if (!username) return { ok: false, code: 'username-invalid' }
  const profile = profiles[username]
  if (!profile) return { ok: false, code: 'username-missing' }
  return { ok: true, username, name: profile.name }
}

export function lookupEmail(raw: string): { ok: true; email: string; name: string; known: true } | { ok: true; email: string; known: false } | { ok: false; code: 'email-invalid' } {
  const email = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: 'email-invalid' }
  const hit = emails[email]
  if (!hit) return { ok: true, email, known: false }
  return { ok: true, email, name: hit.name, known: true }
}

export async function setAccountEmail(raw: string): Promise<{ ok: true; account: Account } | { ok: false; code: AuthFailure | 'email-invalid' }> {
  if (!account) return { ok: false, code: 'account-missing' }
  const email = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: 'email-invalid' }
  account = { ...account, email }
  rememberEmail(email, account.id, account.name)
  if (account.username && profiles[account.username]) profiles[account.username] = { ...profiles[account.username], email }
  await persist()
  return { ok: true, account }
}

export async function setUsername(raw: string): Promise<{ ok: true; account: Account } | { ok: false; code: AuthFailure }> {
  if (!account) return { ok: false, code: 'account-missing' }
  const username = normalizeHandle(raw)
  if (!username) return { ok: false, code: 'username-invalid' }
  const taken = profiles[username]
  if (taken && taken.id !== account.id) return { ok: false, code: 'username-taken' }
  if (account.username && account.username !== username) delete profiles[account.username]
  profiles[username] = { id: account.id, name: account.name, username }
  account = { ...account, username }
  if (account.provider === 'phone' && account.phone && users[account.phone]) {
    users[account.phone] = { ...users[account.phone], username }
  }
  await persist()
  return { ok: true, account }
}

async function sealPhone(phone: string, remember: boolean): Promise<{ ok: true; account: Account }> {
  const username = normalizeHandle(users[phone]?.username || '') || undefined
  const email = profiles[username || '']?.email
  account = { provider: 'phone', id: phone, name: phone, phone, username, email }
  if (email) rememberEmail(email, phone, phone)
  remembered = remember
  await persist()
  return { ok: true, account }
}

function showCode(code: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title: 'Mys Terminal Management', body: code }).show()
}

async function sendSms(phone: string, code: string): Promise<boolean> {
  const url = process.env.MYS_SMS_URL
  if (!url) return false
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MYS_SMS_TOKEN ? { Authorization: `Bearer ${process.env.MYS_SMS_TOKEN}` } : {}),
      },
      body: JSON.stringify({ phone, text: `Mys Terminal Management: ${code}` }),
    })
    return response.ok
  } catch {
    return false
  }
}
