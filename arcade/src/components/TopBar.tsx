import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { spring, springSnap } from '../lib/motion'
import { applyUpdate, useOnline, useUpdateReady } from '../lib/pwa'
import { useSound } from '../lib/sound'
import { useTheme } from '../lib/theme'
import { useMe } from '../net/account'
import { AccentPicker } from './AccentPicker'
import { BackIcon, MoonIcon, SoundOffIcon, SoundOnIcon, SunIcon, TrophyIcon } from './icons'
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
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted"
    >
      {children}
    </Press>
  )
}

export function TopBar({
  onBack,
  center,
  trailing,
  onBoard,
}: {
  onBack?: () => void
  center?: ReactNode
  /** Room-only extras, e.g. the connection meter. */
  trailing?: ReactNode
  /**
   * Opens the leaderboard. Given as an icon beside the other controls rather
   * than a row on the home screen: it is a place you go occasionally, and a
   * full-width entry sitting under the games made the menu read as four things
   * to decide between instead of one list of games.
   */
  onBoard?: () => void
}) {
  const { theme, toggle } = useTheme()
  const sound = useSound()

  return (
    <header className="safe-t sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      {/* Left-aligned rather than a centred middle slot: with three controls on
          the right, a centred slot leaves too little room for the room code at
          375px. Aligning left removes the constraint entirely. */}
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 pb-2 sm:px-5 short:h-12 short:pb-1">
        <div className="flex shrink-0 items-center">
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
                  className="-ml-1 flex h-11 min-w-11 items-center gap-1 rounded-lg pr-2.5 pl-2 text-muted"
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

        <div className="ml-2 flex min-w-0 items-center">{center}</div>

        <div className="flex flex-1 shrink-0 items-center justify-end gap-0.5">
          {trailing}
          {onBoard ? (
            <IconToggle onClick={onBoard} label="Leaderboard">
              <TrophyIcon />
            </IconToggle>
          ) : null}
          <AccentPicker />
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

      <StatusStrip />
    </header>
  )
}

/**
 * Offline, and "a new build is waiting", as a line inside the header.
 *
 * These were a floating pill over the bottom of the screen, which was wrong in
 * two ways: being offline is a state rather than an event, so it never went
 * away, and a persistent overlay sits directly on top of whatever the game put
 * at the bottom — Tug's tap pad, a board's last row — and swallowed the taps
 * meant for it. Living in the header instead means it is laid out rather than
 * floated, so it cannot cover a control at all, and it collapses to nothing
 * when there is nothing to say.
 */
function StatusStrip() {
  const online = useOnline()
  const updateReady = useUpdateReady()
  const me = useMe()
  // What being offline costs you depends on who you are. Someone already signed
  // in loses only the multiplayer half; someone at the door loses everything,
  // because signing in is the one thing that cannot happen without a network.
  const signedIn = !!me && (me.name !== null || me.admin)

  // Offline wins: it explains why things are failing right now, where an update
  // can wait for a better moment by definition.
  const show = !online ? 'offline' : updateReady ? 'update' : null

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key={show}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={springSnap}
          className="overflow-hidden border-t border-line"
          role="status"
        >
          <div className="mx-auto flex h-9 max-w-5xl items-center gap-2 px-3 sm:px-5 short:h-8">
            {show === 'offline' ? (
              <>
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: 'var(--t-danger)' }}
                  aria-hidden
                />
                <span className="chrome truncate text-muted">Offline</span>
                {/* The reassurance is the part worth losing first when there is
                    no room for it — the state itself still reads at any width. */}
                <span className="chrome hidden truncate text-muted/60 sm:inline">
                  {signedIn ? '— solo and party still play' : '— you need a connection to sign in'}
                </span>
              </>
            ) : (
              <>
                <span className="chrome truncate text-muted">New version ready</span>
                <Press
                  cue="tap"
                  depth={0.94}
                  onPress={applyUpdate}
                  className="ml-auto shrink-0 rounded-full px-3 py-1"
                  style={{ backgroundColor: 'var(--t-accent)' }}
                >
                  <span className="chrome" style={{ color: 'var(--t-accent-ink)' }}>
                    Reload
                  </span>
                </Press>
              </>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
