import { useEffect } from 'react'
import { localeInfo } from '../../shared/i18n'
import { DockResize, useDockSize } from './components/DockResize'
import { LoginDialog } from './components/LoginDialog'
import { SessionDialog } from './components/SessionDialog'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Drawers, StatusBar, Workspace } from './components/Workspace'
import { useI18n } from './i18n'
import { useModel } from './model'
import { applyChrome } from './themes'

/** A window holding one tab moved out of the main window: tabs and terminal only. */
export function DetachedApp() {
  const model = useModel()
  const { t, dir } = useI18n()
  useEffect(() => {
    applyChrome(model.settings.theme)
  }, [model.settings.theme])
  useEffect(() => {
    document.documentElement.dir = dir
    document.documentElement.lang = model.settings.locale === 'de-AT' ? 'de-AT' : localeInfo(model.settings.locale).id
  }, [dir, model.settings.locale])
  return (
    <div className="app detached" dir={dir}>
      <div className="body">
        <Workspace />
      </div>
      <SessionDialog />
      {model.confirm && (
        <div className="modal-back">
          <div className="modal confirm">
            <p>{model.confirm.text}</p>
            <footer>
              <button type="button" onClick={() => model.answer(false)}>{t('cancel')}</button>
              <button type="button" className="primary" onClick={() => model.answer(true)}>{t('confirm')}</button>
            </footer>
          </div>
        </div>
      )}
      <div className="toasts">
        {model.toasts.map((item) => (
          <div key={item.id} className={item.kind === 'err' ? 'toast err' : 'toast'}>{item.text}</div>
        ))}
      </div>
    </div>
  )
}

export function App() {
  const model = useModel()
  const { t, dir } = useI18n()
  const [sessionsWidth, setSessionsWidth] = useDockSize('mys.dock.start', 320)
  useEffect(() => {
    applyChrome(model.settings.theme)
  }, [model.settings.theme])
  useEffect(() => {
    document.documentElement.dir = dir
    document.documentElement.lang = model.settings.locale === 'de-AT' ? 'de-AT' : localeInfo(model.settings.locale).id
  }, [dir, model.settings.locale])
  return (
    <div className="app" dir={dir}>
      <TitleBar />
      <div className="body">
        <div
          className={model.sidebar ? 'side-slot start open' : 'side-slot start'}
          style={{ ['--dock-size' as string]: `${sessionsWidth}px` }}
        >
          <div className="dock">
            <Sidebar />
            {model.sidebar && <DockResize edge="start" width={sessionsWidth} onWidth={setSessionsWidth} />}
          </div>
        </div>
        <Workspace />
        <Drawers />
      </div>
      <StatusBar />
      <SessionDialog />
      <LoginDialog />
      {model.confirm && (
        <div className="modal-back">
          <div className="modal confirm">
            <p>{model.confirm.text}</p>
            <footer>
              <button type="button" onClick={() => model.answer(false)}>{t('cancel')}</button>
              <button type="button" className="primary" onClick={() => model.answer(true)}>{t('confirm')}</button>
            </footer>
          </div>
        </div>
      )}
      <div className="toasts">
        {model.toasts.map((item) => (
          <div key={item.id} className={item.kind === 'err' ? 'toast err' : 'toast'}>
            {item.text}
            {item.reveal && (
              <button type="button" className="toast-link" onClick={() => void window.mys.recording.reveal(item.reveal!)}>{t('reveal')}</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
