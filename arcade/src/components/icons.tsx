/**
 * Line icons drawn inline so they inherit `currentColor`, stay crisp at any
 * size and add nothing to the network cost. Deliberately not emoji.
 */
type IconProps = { size?: number; className?: string }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false as const,
})

export function SunIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" />
    </svg>
  )
}

export function MoonIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  )
}

export function SoundOnIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" />
      <path d="M16.2 9.2a4 4 0 0 1 0 5.6M18.9 6.6a7.8 7.8 0 0 1 0 10.8" />
    </svg>
  )
}

export function SoundOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" />
      <path d="M16.5 10l4 4M20.5 10l-4 4" />
    </svg>
  )
}

export function BackIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function CopyIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2.4" />
      <path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5" />
    </svg>
  )
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  )
}

export function BotIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="7.5" width="16" height="12" rx="3" />
      <path d="M12 7.5V4M9.2 13v1.6M14.8 13v1.6" />
    </svg>
  )
}

export function LinkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10.5 13.5a3.6 3.6 0 0 0 5.2 0l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.3 1.3" />
      <path d="M13.5 10.5a3.6 3.6 0 0 0-5.2 0l-2.6 2.6a3.7 3.7 0 0 0 5.2 5.2l1.3-1.3" />
    </svg>
  )
}

export function TrophyIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 5.4H5a2.6 2.6 0 0 0 2.6 4.2M16.5 5.4H19a2.6 2.6 0 0 1-2.6 4.2" />
      <path d="M12 13.8V17M9 20h6M10 17h4" />
    </svg>
  )
}

export function PauseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9.5 5v14M14.5 5v14" />
    </svg>
  )
}

export function WarnIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 16.6v.1" />
    </svg>
  )
}
