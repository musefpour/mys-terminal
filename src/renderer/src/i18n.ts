import { useCallback } from 'react'
import { localeInfo, translate, type MessageKey } from '../../shared/i18n'
import { useModel } from './model'

export function useI18n() {
  const model = useModel()
  const locale = model.settings.locale
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale])
  return { locale, t, dir: localeInfo(locale).dir }
}
