import type { ComponentProps, ReactNode } from 'react'
import { Press } from './Press'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'lg'

type ButtonProps = Omit<ComponentProps<typeof Press>, 'children' | 'ref'> & {
  children: ReactNode
  variant?: Variant
  size?: Size
  full?: boolean
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink',
  secondary: 'bg-surface text-ink border border-line-strong',
  ghost: 'text-muted',
}

const SIZES: Record<Size, string> = {
  // 52px and 60px: comfortably past the 44px touch minimum without looking
  // oversized on desktop.
  md: 'h-13 px-5 text-[0.9375rem]',
  lg: 'h-15 px-6 text-base',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  full,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <Press
      cue={variant === 'primary' ? 'confirm' : 'tap'}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium tracking-[-0.01em]',
        'select-none disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </Press>
  )
}
