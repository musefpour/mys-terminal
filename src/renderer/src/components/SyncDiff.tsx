import { useMemo, useState } from 'react'
import { diffLines, pairRows } from '../../../shared/diff'
import type { SyncDirection, SyncItem } from '../../../shared/types'
import { useI18n } from '../i18n'
import { useModel } from '../model'
import { CloseButton } from './XMark'

const ipcMessage = (caught: unknown) => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(caught))

/** One-way folder sync between a local folder and the panel's current remote folder. */
export function SyncDialog({ instanceId, remoteDir, onClose }: { instanceId: string; remoteDir: string; onClose: () => void }) {
  const model = useModel()
  const { t } = useI18n()
  const [localDir, setLocalDir] = useState(() => localStorage.getItem(`mys.sync.${remoteDir}`) || '')
  const [direction, setDirection] = useState<SyncDirection>('up')
  const [plan, setPlan] = useState<SyncItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const compare = async () => {
    setBusy(true)
    setError('')
    try {
      localStorage.setItem(`mys.sync.${remoteDir}`, localDir)
      setPlan(await window.mys.files.syncPlan(instanceId, localDir, remoteDir, direction))
    } catch (caught) {
      setError(ipcMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  const run = async () => {
    if (!plan?.length) return
    setBusy(true)
    try {
      await window.mys.files.syncRun(instanceId, localDir, remoteDir, direction, plan.map((item) => item.rel))
      model.toast(t('syncQueued', { n: plan.length }))
      onClose()
    } catch (caught) {
      setError(ipcMessage(caught))
      setBusy(false)
    }
  }
  const total = plan?.reduce((sum, item) => sum + item.size, 0) ?? 0

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal sync-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{t('syncTitle')}</h2><CloseButton label={t('close')} onClick={onClose} /></header>
        <label>
          {t('syncLocal')}
          <span className="inline">
            <input dir="ltr" value={localDir} onChange={(event) => { setLocalDir(event.target.value); setPlan(null) }} />
            <button type="button" onClick={() => void window.mys.dialog.pickFolder().then((dir) => { if (dir) { setLocalDir(dir); setPlan(null) } })}>{t('choose')}</button>
          </span>
        </label>
        <label>{t('syncRemote')}<input dir="ltr" value={remoteDir} readOnly /></label>
        <label>
          {t('syncDirection')}
          <select value={direction} onChange={(event) => { setDirection(event.target.value as SyncDirection); setPlan(null) }}>
            <option value="up">{t('syncUp')}</option>
            <option value="down">{t('syncDown')}</option>
          </select>
        </label>
        <p className="hint">{t('syncHint')}</p>
        {error && <p className="form-error">{error}</p>}
        {plan && (
          plan.length === 0 ? <p className="hint">{t('syncNothing')}</p> : (
            <>
              <p><strong>{t('syncCount', { n: plan.length })}</strong> · {formatSize(total)}</p>
              <ul className="plain sync-plan" dir="ltr">
                {plan.slice(0, 500).map((item) => (
                  <li key={item.rel}><span className={`sync-tag ${item.reason}`}>{item.reason === 'new' ? t('syncNew') : t('syncChanged')}</span> {item.rel}</li>
                ))}
                {plan.length > 500 && <li>… +{plan.length - 500}</li>}
              </ul>
            </>
          )
        )}
        <footer>
          <button type="button" disabled={!localDir || busy} onClick={() => void compare()}>{t('syncCompare')}</button>
          <button type="button" className="primary" disabled={!plan?.length || busy} onClick={() => void run()}>{t('syncRun')}</button>
        </footer>
      </div>
    </div>
  )
}

/** Side-by-side line diff between two texts. */
export function DiffModal({ leftTitle, rightTitle, left, right, onClose }: { leftTitle: string; rightTitle: string; left: string; right: string; onClose: () => void }) {
  const { t } = useI18n()
  const ops = useMemo(() => diffLines(left, right), [left, right])
  const rows = useMemo(() => (ops ? pairRows(ops) : []), [ops])
  const changes = ops?.filter((op) => op.kind !== 'same').length ?? 0
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal diff-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{t('compareTitle')}</h2><CloseButton label={t('close')} onClick={onClose} /></header>
        {!ops ? <p className="hint">{t('compareTooDifferent')}</p> : changes === 0 ? <p className="hint">{t('compareSame')}</p> : <p className="hint">{t('compareChanges', { n: changes })}</p>}
        {ops && changes > 0 && (
          <div className="diff-table" dir="ltr" role="table">
            <div className="diff-head" role="row"><span role="columnheader">{leftTitle}</span><span role="columnheader">{rightTitle}</span></div>
            {rows.map((row, index) => (
              <div key={index} className="diff-row" role="row">
                <DiffCell line={row.left} kind={row.left ? row.kind === 'same' ? 'same' : 'del' : 'empty'} />
                <DiffCell line={row.right} kind={row.right ? row.kind === 'same' ? 'same' : 'add' : 'empty'} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DiffCell({ line, kind }: { line?: { no: number; text: string }; kind: 'same' | 'add' | 'del' | 'empty' }) {
  return (
    <span className={`diff-cell ${kind}`} role="cell">
      <i>{line?.no || ''}</i>
      <code>{line?.text ?? ''}</code>
    </span>
  )
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}
