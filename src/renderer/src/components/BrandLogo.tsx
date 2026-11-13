import logoDark from '../assets/logo-dark.png'
import logoLight from '../assets/logo-light.png'
import { useModel } from '../model'
import { themeOf } from '../themes'

export function BrandLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  const model = useModel()
  return <BrandMark theme={model.settings.theme} size={size} className={className} />
}

/** Logo for a given theme, usable outside the model (lock screen). */
export function BrandMark({ theme, size = 32, className = '' }: { theme: string; size?: number; className?: string }) {
  const day = themeOf(theme).mode === 'day'
  return (
    <img
      className={className ? `brand-logo ${className}` : 'brand-logo'}
      src={day ? logoLight : logoDark}
      width={size}
      height={size}
      alt="Mys Terminal Management"
      draggable={false}
    />
  )
}
