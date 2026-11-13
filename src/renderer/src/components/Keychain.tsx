import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { KeychainItem, KeychainKind, SshKeyAlgo } from '../../../shared/types'
import type { MessageKey } from '../../../shared/i18n'
import { useI18n } from '../i18n'
import { useModel } from '../model'

type View =
  | { id: 'home' }
  | { id: 'generate' }
  | { id: 'identity' }
  | { id: 'import' }
  | { id: 'certificate' }
  | { id: 'touchid' }
  | { id: 'fido2' }

export function KeychainPanel() {
  const { t } = useI18n()
  const model = useModel()
  const [view, setView] = useState<View>({ id: 'home' })
  const [items, setItems] = useState<KeychainItem[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const vaultName = model.workspaces.find((item) => item.id === model.settings.activeWorkspaceId)?.name
    || t('personalVault')

  const refresh = () => void window.mys.keychain.list().then(setItems)
  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  if (view.id !== 'home') {
    return (
      <div className="side-panel kc">
        {view.id === 'generate' && (
          <GenerateKeyView vault={vaultName} onBack={() => setView({ id: 'home' })} onSaved={() => { refresh(); setView({ id: 'home' }) }} />
        )}
        {view.id === 'identity' && (
          <IdentityView vault={vaultName} onBack={() => setView({ id: 'home' })} onSaved={() => { refresh(); setView({ id: 'home' }) }} />
        )}
        {view.id === 'import' && (
          <ImportKeyView vault={vaultName} onBack={() => setView({ id: 'home' })} onSaved={() => { refresh(); setView({ id: 'home' }) }} />
        )}
        {view.id === 'certificate' && (
          <CertificateView vault={vaultName} onBack={() => setView({ id: 'home' })} onSaved={() => { refresh(); setView({ id: 'home' }) }} />
        )}
        {view.id === 'touchid' && (
          <TouchIdView vault={vaultName} onBack={() => setView({ id: 'home' })} onSaved={() => { refresh(); setView({ id: 'home' }) }} />
        )}
        {view.id === 'fido2' && (
          <Fido2View vault={vaultName} onBack={() => setView({ id: 'home' })} />
        )}
      </div>
    )
  }

  return (
    <div className="side-panel kc">
      <div className="kc-toolbar">
        <div className="kc-split">
          <button type="button" className="kc-new" onClick={() => setView({ id: 'import' })}>
            <span aria-hidden="true">+</span> {t('newKey')}
          </button>
          <button
            type="button"
            className="kc-chevron"
            title={t('more')}
            aria-label={t('more')}
            aria-expanded={Boolean(menu)}
            onClick={(event) => {
              event.stopPropagation()
              const box = event.currentTarget.getBoundingClientRect()
              setMenu(menu ? null : { x: box.left, y: box.bottom + 4 })
            }}
          >
            <ChevronIcon up={Boolean(menu)} />
          </button>
        </div>
        <button type="button" className="kc-link" onClick={() => setView({ id: 'certificate' })}>
          <CertIcon /> {t('certificate')}
        </button>
        <button type="button" className="kc-link" onClick={() => setView({ id: 'touchid' })}>
          <FingerIcon /> {t('touchId')}
        </button>
        <button type="button" className="kc-link" onClick={() => setView({ id: 'fido2' })}>
          <FidoIcon /> {t('fido2')}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="kc-empty">
          <div className="kc-empty-ico" aria-hidden="true"><BigKeyIcon /></div>
          <strong>{t('addCredentials')}</strong>
          <p>{t('addCredentialsHint')}</p>
        </div>
      ) : (
        <div className="side-scroll kc-list">
          {items.map((item) => (
            <article key={item.id} className="kc-card">
              <div className="kc-card-ico" aria-hidden="true">{kindIcon(item.kind)}</div>
              <div className="kc-card-body">
                <strong>{item.label || t('untitled')}</strong>
                <small dir="ltr">{kindLabel(item, t)}</small>
              </div>
              <button
                type="button"
                className="danger textish"
                title={t('delete')}
                aria-label={t('delete')}
                onClick={() => void window.mys.keychain.remove(item.id).then(setItems)}
              >{t('delete')}</button>
            </article>
          ))}
        </div>
      )}

      {menu && createPortal(
        <div
          className="kc-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'generate' }) }}>
            <KeyIcon /> {t('generateKey')}
          </button>
          <button type="button" onClick={() => { setMenu(null); setView({ id: 'identity' }) }}>
            <IdIcon /> {t('newIdentity')}
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function VaultHead({ title, vault, onBack }: { title: string; vault: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <header className="kc-head">
      <div>
        <strong>{title}</strong>
        <span className="kc-vault">{vault}</span>
      </div>
      <button type="button" className="kc-exit" title={t('close')} aria-label={t('close')} onClick={onBack}>
        <ExitIcon />
      </button>
    </header>
  )
}

function GenerateKeyView({ vault, onBack, onSaved }: { vault: string; onBack: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('')
  const [algo, setAlgo] = useState<SshKeyAlgo>('ed25519')
  const [passphrase, setPassphrase] = useState('')
  const [show, setShow] = useState(false)
  const [savePass, setSavePass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hint = algo === 'ed25519' ? 'OpenSSH 6.5+' : algo === 'ecdsa' ? 'nistp256' : algo === 'rsa' ? '2048-bit' : '—'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const keys = await window.mys.keychain.generate(algo, passphrase)
      await window.mys.keychain.save({
        kind: 'key',
        label: label.trim() || keys.keyType.toUpperCase(),
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        keyType: keys.keyType,
        passphrase: savePass ? passphrase : '',
        savePassphrase: savePass,
      })
      onSaved()
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code.includes('ml-dsa') ? t('mlDsaSoon') : t('keygenFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <VaultHead title={t('generateKeyTitle')} vault={vault} onBack={onBack} />
      <form className="side-scroll kc-form" onSubmit={(event) => void submit(event)}>
        <div className="kc-block">
          <FloatField label={t('label')} value={label} onChange={setLabel} autoFocus />
          <p className="kc-field-label">{t('keyType')}</p>
          <div className="kc-seg" role="group" aria-label={t('keyType')}>
            {(['ed25519', 'ecdsa', 'rsa', 'ml-dsa'] as SshKeyAlgo[]).map((item) => (
              <button
                key={item}
                type="button"
                className={algo === item ? 'on' : ''}
                onClick={() => setAlgo(item)}
              >{item === 'ml-dsa' ? 'ML-DSA' : item.toUpperCase()}</button>
            ))}
          </div>
          <p className="hint">{hint}</p>
        </div>
        <div className="kc-block">
          <div className="kc-pass">
            <input
              dir="ltr"
              type={show ? 'text' : 'password'}
              placeholder={t('passphrase')}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <button type="button" className="kc-eye" title={show ? t('hide') : t('show')} onClick={() => setShow((value) => !value)}>
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <label className="kc-toggle">
            <span>{t('savePassphrase')}</span>
            <input type="checkbox" checked={savePass} onChange={(event) => setSavePass(event.target.checked)} />
            <i aria-hidden="true" />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary kc-cta" disabled={busy}>{t('generateAndSave')}</button>
      </form>
    </>
  )
}

function IdentityView({ vault, onBack, onSaved }: { vault: string; onBack: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [extra, setExtra] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [certificate, setCertificate] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim()) {
      setError(t('usernameRequired'))
      return
    }
    setError('')
    await window.mys.keychain.save({
      kind: 'identity',
      label: label.trim() || username.trim(),
      username: username.trim(),
      password,
      privateKey,
      certificate,
    })
    onSaved()
  }

  return (
    <>
      <VaultHead title={t('newIdentity')} vault={vault} onBack={onBack} />
      <form className="side-scroll kc-form" onSubmit={(event) => void submit(event)}>
        <div className="kc-block">
          <div className="kc-identity-row">
            <div className="kc-id-badge" aria-hidden="true"><IdIcon /></div>
            <input value={label} placeholder={t('label')} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="kc-icon-field">
            <UserIcon />
            <input dir="ltr" value={username} placeholder={`${t('username')}*`} autoFocus onChange={(event) => setUsername(event.target.value)} />
          </div>
          <div className="kc-icon-field">
            <PassIcon />
            <input dir="ltr" type={show ? 'text' : 'password'} value={password} placeholder={t('password')} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" className="kc-eye" onClick={() => setShow((value) => !value)}>{show ? <EyeOffIcon /> : <EyeIcon />}</button>
          </div>
          <button type="button" className="kc-more-link" onClick={() => setExtra((value) => !value)}>
            + {t('keyCertFido')}
          </button>
          {extra && (
            <>
              <textarea dir="ltr" className="kc-area" placeholder={t('privateKey')} value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} />
              <textarea dir="ltr" className="kc-area" placeholder={t('certificate')} value={certificate} onChange={(event) => setCertificate(event.target.value)} />
            </>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary kc-cta">{t('save')}</button>
      </form>
    </>
  )
}

function ImportKeyView({ vault, onBack, onSaved }: { vault: string; onBack: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [certificate, setCertificate] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setPrivateKey(String(reader.result || ''))
      setLabel((current) => current || file.name)
    }
    reader.readAsText(file)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!privateKey.trim()) {
      setError(t('privateKeyRequired'))
      return
    }
    setError('')
    await window.mys.keychain.save({
      kind: 'key',
      label: label.trim() || t('newKey'),
      privateKey: privateKey.trim(),
      publicKey: publicKey.trim(),
      certificate: certificate.trim(),
    })
    onSaved()
  }

  return (
    <>
      <VaultHead title={t('newKey')} vault={vault} onBack={onBack} />
      <form className="side-scroll kc-form" onSubmit={(event) => void submit(event)}>
        <div className="kc-block">
          <input value={label} placeholder={t('label')} onChange={(event) => setLabel(event.target.value)} />
          <FloatField label={`${t('privateKey')} *`} value={privateKey} onChange={setPrivateKey} multiline autoFocus />
          <textarea dir="ltr" className="kc-area" placeholder={t('publicKey')} value={publicKey} onChange={(event) => setPublicKey(event.target.value)} />
          <textarea dir="ltr" className="kc-area" placeholder={t('certificate')} value={certificate} onChange={(event) => setCertificate(event.target.value)} />
        </div>
        <div
          className="kc-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <DropIcon />
          <p>{t('dropPrivateKey')}</p>
          <button type="button" className="primary" onClick={() => fileRef.current?.click()}>{t('importFromKeyFile')}</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) readFile(file)
              event.target.value = ''
            }}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary kc-cta">{t('save')}</button>
      </form>
    </>
  )
}

function CertificateView({ vault, onBack, onSaved }: { vault: string; onBack: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('')
  const [certificate, setCertificate] = useState('')
  const [error, setError] = useState('')
  return (
    <>
      <VaultHead title={t('certificate')} vault={vault} onBack={onBack} />
      <form
        className="side-scroll kc-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!certificate.trim()) {
            setError(t('certificateRequired'))
            return
          }
          void window.mys.keychain.save({ kind: 'certificate', label: label.trim() || t('certificate'), certificate: certificate.trim() }).then(onSaved)
        }}
      >
        <div className="kc-block">
          <FloatField label={t('label')} value={label} onChange={setLabel} autoFocus />
          <textarea dir="ltr" className="kc-area tall" placeholder={t('certificate')} value={certificate} onChange={(event) => setCertificate(event.target.value)} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary kc-cta">{t('save')}</button>
      </form>
    </>
  )
}

function TouchIdView({ vault, onBack, onSaved }: { vault: string; onBack: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('Touch ID')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <VaultHead title={t('generateBiometric')} vault={vault} onBack={onBack} />
      <div className="side-scroll kc-form">
        <div className="kc-block kc-bio">
          <div className="kc-bio-art" aria-hidden="true"><FingerIcon large /></div>
          <p>{t('biometricHint')}</p>
        </div>
        <div className="kc-block">
          <FloatField label={t('label')} value={label} onChange={setLabel} />
          <div className="kc-meta-row"><span>{t('type')}</span><em>ECDSA</em></div>
          <div className="kc-meta-row"><span>{t('keySize')}</span><em>256</em></div>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button
          type="button"
          className="primary kc-cta"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void window.mys.keychain.generate('ecdsa')
              .then((keys) => window.mys.keychain.save({
                kind: 'touchid',
                label: label.trim() || 'Touch ID',
                privateKey: keys.privateKey,
                publicKey: keys.publicKey,
                keyType: 'ecdsa',
              }))
              .then(onSaved)
              .catch(() => setError(t('keygenFailed')))
              .finally(() => setBusy(false))
          }}
        >{t('generate')}</button>
      </div>
    </>
  )
}

function Fido2View({ vault, onBack }: { vault: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <VaultHead title={t('generateFido2')} vault={vault} onBack={onBack} />
      <div className="kc-empty">
        <div className="kc-empty-ico" aria-hidden="true"><FidoIcon large /></div>
        <strong>{t('insertFido2')}</strong>
        <p>{t('insertFido2Hint')}</p>
      </div>
    </>
  )
}

function FloatField({
  label,
  value,
  onChange,
  multiline,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  autoFocus?: boolean
}) {
  const active = Boolean(value)
  return (
    <label className={active ? 'kc-float on' : 'kc-float'}>
      <span>{label}</span>
      {multiline ? (
        <textarea dir="ltr" value={value} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  )
}

function kindLabel(item: KeychainItem, t: (key: MessageKey) => string): string {
  if (item.kind === 'identity') return item.username || t('newIdentity')
  if (item.kind === 'certificate') return t('certificate')
  if (item.kind === 'touchid') return t('touchId')
  if (item.kind === 'fido2') return t('fido2')
  return (item.keyType || 'key').toUpperCase()
}

function kindIcon(kind: KeychainKind): ReactNode {
  if (kind === 'identity') return <IdIcon />
  if (kind === 'certificate') return <CertIcon />
  if (kind === 'touchid') return <FingerIcon />
  if (kind === 'fido2') return <FidoIcon />
  return <KeyIcon />
}

function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style={{ transform: up ? 'rotate(180deg)' : undefined }}>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14 12H7M14 12l-3-3M14 12l-3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="9" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 9h8l-1.4 2H17l-1 2h-2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BigKeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <circle cx="9" cy="9" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 9h8l-1.5 2H17l-1 2h-2.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IdIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 10.5h4M13 13.5h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M7 4h8l3 3v13H7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 4v3h3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="14" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 15.8l-1 2.7 2.5-1 2.5 1-1-2.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function FingerIcon({ large }: { large?: boolean }) {
  const size = large ? 28 : 16
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 3.8c-2.4 1.2-4.2 3.6-4.2 6.4 0 2.2 1.1 3.9 2.6 5.1.6.5.9 1.1.9 1.9v1.2h2.4v-1.2c0-.8.3-1.4.9-1.9 1.5-1.2 2.6-2.9 2.6-5.1 0-2.8-1.8-5.2-4.2-6.4z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="9.2" r="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.2 20.2h5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function FidoIcon({ large }: { large?: boolean }) {
  const size = large ? 28 : 16
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="8" y="3" width="8" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="9" r="1.4" fill="currentColor" />
      <path d="M10 17v3l2 1 2-1v-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 19c1.5-3 4-4.5 6.5-4.5S17 16 18.5 19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M7 12h10M9 12v2M12 12v2M15 12v2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M3 3l18 18M9.9 5.2C10.6 5.1 11.3 5 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-3.2 3.8M6.2 6.7A16 16 0 0 0 2.5 12S6 18 12 18c1.1 0 2.1-.2 3.1-.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <rect x="4" y="3" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="7" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 12v5M14 17l-2-2M14 17l2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
