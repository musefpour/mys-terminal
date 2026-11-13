import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { BrandLogo } from './BrandLogo'
import { PasswordGen } from './PasswordGen'
import { CloseButton } from './XMark'

type Step = 'login' | 'signup' | 'otp' | 'password'

export function LoginDialog() {
  const model = useModel()
  const { t } = useI18n()
  const [step, setStep] = useState<Step>('login')
  const [purpose, setPurpose] = useState<'signup' | 'reset'>('signup')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [proof, setProof] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [remember, setRemember] = useState(true)
  const [delivery, setDelivery] = useState<'sms' | 'device' | null>(null)
  const [clientId, setClientId] = useState('')
  const [needClient, setNeedClient] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleWait, setGoogleWait] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!model.loginOpen) return
    setError('')
    setStep('login')
    setCode('')
    setProof('')
    setPassword('')
    setConfirm('')
    setUsername(model.account?.username ?? '')
    setEmail(model.account?.email ?? '')
    void window.mys.auth.googleClient().then((value) => {
      setClientId(value)
      setNeedClient(!value)
    })
  }, [model.account?.email, model.account?.username, model.loginOpen])

  if (!model.loginOpen) return null

  const fail = (codeName: string) => {
    if (codeName === 'google-client') {
      setNeedClient(true)
      setError(t('googleNeedClient'))
      return
    }
    const key = codeName === 'phone-invalid' ? 'phoneInvalid'
      : codeName === 'code-invalid' ? 'codeInvalid'
        : codeName === 'code-expired' ? 'codeExpired'
          : codeName === 'password-short' ? 'passwordShort'
            : codeName === 'password-mismatch' ? 'passwordMismatch'
              : codeName === 'account-exists' ? 'accountExists'
                : codeName === 'account-missing' ? 'accountMissing'
                  : codeName === 'password-wrong' ? 'passwordWrong'
                    : codeName === 'username-invalid' ? 'invalidUser'
                      : codeName === 'username-taken' ? 'usernameTaken'
                        : codeName === 'username-missing' ? 'usernameMissing'
                          : codeName === 'email-invalid' ? 'invalidEmail'
                          : 'authFailed'
    setError(t(key))
  }

  const google = async () => {
    setError('')
    const id = clientId.trim()
    if (!id) {
      setNeedClient(true)
      setError(t('googleNeedClient'))
      return
    }
    setBusy(true)
    setGoogleWait(true)
    await window.mys.auth.saveGoogleClient(id)
    const result = await window.mys.auth.google()
    setBusy(false)
    setGoogleWait(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    model.setAccount(result.account)
  }

  const sendCode = async (next: 'signup' | 'reset') => {
    setError('')
    setBusy(true)
    const result = await window.mys.auth.requestPhone(phone, next)
    setBusy(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    setPurpose(next)
    setPhone(result.phone)
    setDelivery(result.delivery)
    setCode('')
    setStep('otp')
  }

  const verify = async () => {
    setError('')
    setBusy(true)
    const result = await window.mys.auth.verifyPhone(phone, code)
    setBusy(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    setProof(result.proof)
    setPassword('')
    setConfirm('')
    setStep('password')
  }

  const finishPassword = async () => {
    setError('')
    setBusy(true)
    const result = purpose === 'signup'
      ? await window.mys.auth.signup(phone, proof, password, confirm, username)
      : await window.mys.auth.reset(phone, proof, password, confirm)
    setBusy(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    model.setAccount(result.account)
  }

  const login = async () => {
    setError('')
    setBusy(true)
    const result = await window.mys.auth.login(phone, password, remember)
    setBusy(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    model.setAccount(result.account)
  }

  const saveUsername = async () => {
    setError('')
    setBusy(true)
    const result = await window.mys.auth.setUsername(username)
    setBusy(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    model.setAccount(result.account)
  }

  const saveEmail = async () => {
    setError('')
    setBusy(true)
    const result = await window.mys.auth.setEmail(email)
    setBusy(false)
    if (!result.ok) {
      fail(result.code)
      return
    }
    model.setAccount(result.account)
  }

  const signOut = async () => {
    await window.mys.auth.signOut()
    model.setAccount(null)
    setStep('login')
  }

  return (
    <div className="auth-back" onMouseDown={() => model.setLogin(false)}>
      <div className="auth-card" onMouseDown={(event) => event.stopPropagation()}>
        <CloseButton label={t('close')} onClick={() => model.setLogin(false)} />
        <div className="auth-mark"><BrandLogo size={72} /></div>
        <h2>{t('welcome')}</h2>
        <p className="sub">{t('welcomeBody')}</p>
        {model.account ? (
          <div className="auth-form">
            <p className="sub">{t('signedInAs', { name: model.account.name })}</p>
            {model.account.phone && <p className="sub" dir="ltr">{model.account.phone}</p>}
            <form onSubmit={(event) => { event.preventDefault(); void saveUsername() }}>
              <Field label={t('accountUsername')}>
                <input dir="ltr" value={username} placeholder="mahdi" onChange={(event) => setUsername(event.target.value)} />
              </Field>
              <p className="sub">{t('usernameHint')}</p>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="auth-go" disabled={busy}>{t('save')}</button>
            </form>
            <form onSubmit={(event) => { event.preventDefault(); void saveEmail() }}>
              <Field label={t('accountEmail')}>
                <input dir="ltr" type="email" value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
              </Field>
              <p className="sub">{t('inviteEmailHint')}</p>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="auth-go" disabled={busy}>{t('save')}</button>
            </form>
            <button type="button" className="auth-go" onClick={() => void signOut()}>{t('signOut')}</button>
          </div>
        ) : step === 'login' ? (
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void login() }}>
            <Field label={t('phoneNumber')} icon="phone">
              <input dir="ltr" inputMode="tel" value={phone} placeholder="09121234567" onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field label={t('authPassword')} icon={showPassword ? 'eye-off' : 'eye'} onIcon={() => setShowPassword((value) => !value)}>
              <input dir="ltr" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <div className="auth-row">
              <label className="auth-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                {t('rememberMe')}
              </label>
              <button type="button" className="auth-link blue" onClick={() => void sendCode('reset')}>{t('forgotPassword')}</button>
            </div>
            <button type="submit" className="auth-go" disabled={busy}>{t('signIn')}</button>
            <button type="button" className="auth-google" disabled={busy} onClick={() => void google()}>
              <GoogleMark /> {t('continueGoogle')}
            </button>
            {needClient && (
              <Field label={t('googleClientId')}>
                <input dir="ltr" value={clientId} placeholder="….apps.googleusercontent.com" onChange={(event) => setClientId(event.target.value)} />
              </Field>
            )}
            {googleWait && <p className="sub">{t('googleWaiting')}</p>}
            {error && <p className="form-error">{error}</p>}
            <p className="auth-switch">{t('newHere')} <button type="button" className="auth-link" onClick={() => { setStep('signup'); setError('') }}>{t('createAccount')}</button></p>
          </form>
        ) : step === 'signup' ? (
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void sendCode('signup') }}>
            <Field label={t('phoneNumber')} icon="phone">
              <input dir="ltr" inputMode="tel" value={phone} placeholder="09121234567" onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <button type="submit" className="auth-go" disabled={busy}>{t('sendCode')}</button>
            {error && <p className="form-error">{error}</p>}
            <p className="auth-switch">{t('alreadyRegistered')} <button type="button" className="auth-link" onClick={() => { setStep('login'); setError('') }}>{t('signIn')}</button></p>
          </form>
        ) : step === 'otp' ? (
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void verify() }}>
            <p className="sub">{delivery === 'sms' ? t('codeSent', { phone }) : t('codeOnDevice')}</p>
            <Field label={t('verificationCode')}>
              <input dir="ltr" inputMode="numeric" value={code} placeholder="000000" onChange={(event) => setCode(event.target.value)} />
            </Field>
            <button type="submit" className="auth-go" disabled={busy || code.trim().length < 4}>{t('confirmCode')}</button>
            {error && <p className="form-error">{error}</p>}
          </form>
        ) : (
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void finishPassword() }}>
            {purpose === 'signup' && (
              <Field label={t('accountUsername')}>
                <input dir="ltr" value={username} placeholder="mahdi" onChange={(event) => setUsername(event.target.value)} />
              </Field>
            )}
            <Field label={t('authPassword')} icon={showPassword ? 'eye-off' : 'eye'} onIcon={() => setShowPassword((value) => !value)}>
              <input dir="ltr" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Field label={t('confirmPassword')} icon={showConfirm ? 'eye-off' : 'eye'} onIcon={() => setShowConfirm((value) => !value)}>
              <input dir="ltr" type={showConfirm ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </Field>
            <PasswordGen onPick={(value) => { setPassword(value); setConfirm(value); setShowPassword(true) }} />
            <button type="submit" className="auth-go" disabled={busy}>{purpose === 'signup' ? t('register') : t('confirmCode')}</button>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}

function Field({ label, icon, onIcon, children }: { label: string; icon?: 'phone' | 'eye' | 'eye-off'; onIcon?: () => void; children: ReactNode }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div className="auth-input">
        {children}
        {icon && (
          <button type="button" className="auth-ico" tabIndex={-1} onClick={onIcon} disabled={!onIcon}>
            <FieldIcon name={icon} />
          </button>
        )}
      </div>
    </label>
  )
}

function FieldIcon({ name }: { name: 'phone' | 'eye' | 'eye-off' }) {
  if (name === 'phone') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="3" width="8" height="18" rx="2" />
        <path d="M11 18h2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.5" />
      {name === 'eye-off' && <path d="M4 20L20 4" />}
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg className="gmark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.7 18.7 23 15.8 23 12.3z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.2-6.9-5.1H1.3v3c2 4 6.1 6.7 10.7 6.7z" />
      <path fill="#FBBC05" d="M5.1 14.3A7.2 7.2 0 0 1 4.7 12c0-.8.1-1.6.4-2.3v-3H1.3A12 12 0 0 0 0 12c0 1.9.5 3.8 1.3 5.3l3.8-3z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.1 15.2 0 12 0 7.4 0 3.3 2.7 1.3 6.7l3.8 3C6.1 7 8.8 4.8 12 4.8z" />
    </svg>
  )
}
