import { useMemo, useState, type ReactNode } from 'react'
import type { MessageKey } from '../../../shared/i18n'
import { HOST_COLORS, HOST_ICON_GROUPS, HOST_ICONS, type HostIconGroup } from '../../../shared/hostIcons'
import type { Protocol } from '../../../shared/types'
import { useI18n } from '../i18n'
import { ProtocolIcon, ProtocolMark, protocolColor } from '../protocols'

const GROUP_LABEL: Record<HostIconGroup, MessageKey> = {
  infra: 'iconGroupInfra',
  data: 'iconGroupData',
  apps: 'iconGroupApps',
  env: 'iconGroupEnv',
  places: 'iconGroupPlaces',
}

interface Props {
  protocol: Protocol
  icon: string
  color: string
  onChange: (next: { icon?: string; color?: string }) => void
  /** The name field, laid out beside the icon button. */
  children: ReactNode
}

/** Icon button beside the host name; opens an inline grid of preset icons and tints. */
export function IconField({ protocol, icon, color, onChange, children }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return HOST_ICON_GROUPS.map((group) => ({
      group,
      icons: HOST_ICONS.filter((item) => {
        if (item.group !== group) return false
        const hay = `${item.id} ${item.tags} ${t(GROUP_LABEL[group])}`.toLowerCase()
        return words.every((word) => hay.includes(word))
      }),
    })).filter((entry) => entry.icons.length > 0)
  }, [query, t])

  const tint = color || protocolColor(protocol)

  return (
    <div className="icon-field">
      <div className="name-row">
        <button
          type="button"
          className={open ? 'icon-trigger on' : 'icon-trigger'}
          title={t('hostIconPick')}
          aria-label={t('hostIconPick')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ProtocolMark protocol={protocol} icon={icon} color={color} size={38} />
          <svg className="icon-trigger-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 4l2.5 2.5L7.5 4" /></svg>
        </button>
        {children}
      </div>
      {open && (
        <div
          className="icon-panel"
          data-own-escape
          style={{ ['--pc' as string]: tint }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setOpen(false)
          }}
        >
          <div className="icon-panel-head">
            <span className="icon-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" /><path d="M20 20l-4-4" /></svg>
              <input
                autoFocus
                dir="auto"
                value={query}
                placeholder={t('hostIconSearch')}
                aria-label={t('hostIconSearch')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
            <div className="icon-colors" role="radiogroup" aria-label={t('hostIconColor')}>
              <button
                type="button"
                role="radio"
                aria-checked={!color}
                className={color ? 'swatch auto' : 'swatch auto on'}
                title={t('hostIconColorAuto')}
                aria-label={t('hostIconColorAuto')}
                style={{ ['--sw' as string]: protocolColor(protocol) }}
                onClick={() => onChange({ color: '' })}
              />
              {HOST_COLORS.map((swatch) => (
                <button
                  type="button"
                  role="radio"
                  key={swatch}
                  aria-checked={color === swatch}
                  aria-label={swatch}
                  className={color === swatch ? 'swatch on' : 'swatch'}
                  style={{ ['--sw' as string]: swatch }}
                  onClick={() => onChange({ color: swatch })}
                />
              ))}
            </div>
          </div>

          <div className="icon-scroll">
            {!query.trim() && (
              <section>
                <h4>{t('hostIconDefault')}</h4>
                <div className="icon-grid">
                  <IconTile label={t('hostIconDefault')} on={!icon} onPick={() => onChange({ icon: '' })}>
                    <ProtocolIcon protocol={protocol} size={20} />
                  </IconTile>
                </div>
              </section>
            )}
            {groups.map(({ group, icons }) => (
              <section key={group}>
                <h4>{t(GROUP_LABEL[group])}</h4>
                <div className="icon-grid">
                  {icons.map((item) => (
                    <IconTile key={item.id} label={item.id} on={icon === item.id} onPick={() => onChange({ icon: item.id })}>
                      <ProtocolIcon protocol={protocol} icon={item.id} size={20} />
                    </IconTile>
                  ))}
                </div>
              </section>
            ))}
            {groups.length === 0 && <p className="icon-empty">{t('hostIconNone')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function IconTile({ label, on, onPick, children }: { label: string; on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={on ? 'icon-tile on' : 'icon-tile'} title={label} aria-label={label} aria-pressed={on} onClick={onPick}>
      {children}
    </button>
  )
}
