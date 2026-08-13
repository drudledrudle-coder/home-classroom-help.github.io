import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { spring, springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'
import { useTheme } from '../lib/theme'
import { BackIcon, MoonIcon, SoundOffIcon, SoundOnIcon, SunIcon } from './icons'
import { Press } from './Press'

function IconToggle({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <Press
      cue={null}
      onClick={onClick}
      aria-label={label}
      title={label}
      depth={0.88}
      className="grid h-10 w-10 place-items-center rounded-lg text-muted"
    >
      {children}
    </Press>
  )
}

export function TopBar({ onBack, center }: { onBack?: () => void; center?: ReactNode }) {
  const { theme, toggle } = useTheme()
  const sound = useSound()

  return (
    <header className="safe-t sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 pb-2 sm:px-5">
        <div className="flex w-20 items-center sm:w-28">
          <AnimatePresence initial={false}>
            {onBack ? (
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={springSnap}
              >
                <Press
                  onClick={onBack}
                  aria-label="Back"
                  depth={0.88}
                  className="-ml-1 flex h-10 items-center gap-1 rounded-lg pr-2 pl-1 text-muted"
                >
                  <BackIcon />
                  <span className="chrome hidden sm:inline">Back</span>
                </Press>
              </motion.div>
            ) : (
              <motion.span
                key="wordmark"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="display pl-1 text-[1.0625rem] tracking-[-0.05em]"
              >
                Arcade
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center">{center}</div>

        <div className="flex w-20 items-center justify-end gap-0.5 sm:w-28">
          <IconToggle
            onClick={sound.toggle}
            label={sound.enabled ? 'Mute sound' : 'Unmute sound'}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={sound.enabled ? 'on' : 'off'}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1, color: sound.enabled ? 'var(--t-ink)' : undefined }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={springSnap}
                className="block"
              >
                {sound.enabled ? <SoundOnIcon /> : <SoundOffIcon />}
              </motion.span>
            </AnimatePresence>
          </IconToggle>

          <IconToggle onClick={toggle} label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ opacity: 0, rotate: -70, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 70, scale: 0.6 }}
                transition={spring}
                className="block"
              >
                {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
              </motion.span>
            </AnimatePresence>
          </IconToggle>
        </div>
      </div>
    </header>
  )
}
