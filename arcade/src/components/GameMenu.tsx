import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ACCENTS, ACCENT_IDS, useAccent } from '../lib/accent'
import { hapticsEnabled, hapticsSupported, setHapticsEnabled } from '../lib/haptics'
import { spring, springSnap, springSoft } from '../lib/motion'
import { useSound } from '../lib/sound'
import { useTheme } from '../lib/theme'
import { Button } from './Button'
import { DifficultySlider } from './DifficultySlider'
import { Press } from './Press'
import { MoonIcon, SoundOffIcon, SoundOnIcon, SunIcon, WarnIcon } from './icons'

/**
 * The menu you get mid-game: settings, and the way out.
 *
 * One component for two jobs that look the same and behave differently. In a
 * solo run this is a real pause — the caller freezes the game behind it. In a
 * room it cannot be, because the other player's clock is still running and
 * nothing here can stop it; there it is a settings sheet that happens to be
 * where leaving lives.
 *
 * Leaving is deliberately two taps when someone else is affected. A room is the
 * one place in this app where a mis-tap costs *another person* their game, and
 * the old behaviour — back button drops the room instantly — made that a very
 * easy mistake to make while reaching for the volume.
 */

export type LeaveAction = {
  /** What the button says at rest, e.g. "Leave the room". */
  label: string
  /** Second-tap label. Present means leaving needs confirming. */
  confirmLabel?: string
  /** Why confirming matters. Shown only once the first tap has landed. */
  warning?: string
  onLeave: () => void
}

export function GameMenu({
  open,
  onClose,
  title,
  note,
  leave,
  showDifficulty = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** One line under the title: what is and is not frozen while this is up. */
  note?: string
  leave: LeaveAction
  /** Only when there is a bot to tune. */
  showDifficulty?: boolean
}) {
  const [confirming, setConfirming] = useState(false)

  // Reopening starts from rest. A sheet that reopens already armed to leave is
  // exactly the trap this component exists to prevent.
  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  // Escape resumes. It never leaves — the keyboard should not be able to drop a
  // room in one keystroke either.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (confirming) setConfirming(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, confirming, onClose])

  const needsConfirm = !!leave.confirmLabel

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute inset-0 z-30 flex items-end justify-center bg-bg/80 backdrop-blur-md sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          // Tapping the dimmed area resumes, the same as Escape. Never leaves.
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={springSoft}
            className="safe-b max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-6 sm:rounded-3xl"
          >
            <span className="chrome text-muted">{title}</span>
            {note ? <p className="pt-1.5 text-[0.875rem] leading-snug text-muted">{note}</p> : null}

            <div className="mt-5 flex flex-col gap-2.5">
              <SoundRow />
              <ThemeRow />
              <HapticsRow />
              <AccentRow />
              {showDifficulty ? (
                <div className="rounded-xl border border-line bg-bg px-3.5 pt-3 pb-4">
                  <span className="chrome text-muted/70">Bot difficulty</span>
                  <div className="pt-3">
                    <DifficultySlider />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <Button full size="lg" onClick={onClose}>
                Resume
              </Button>

              <AnimatePresence mode="wait" initial={false}>
                {confirming && needsConfirm ? (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={springSnap}
                    className="flex flex-col gap-2.5"
                  >
                    {leave.warning ? (
                      <p
                        className="flex items-start gap-2 text-[0.8125rem] leading-snug"
                        style={{ color: 'var(--t-danger)' }}
                      >
                        <WarnIcon size={16} className="mt-px shrink-0" />
                        <span>{leave.warning}</span>
                      </p>
                    ) : null}
                    <Button
                      full
                      variant="secondary"
                      onClick={leave.onLeave}
                      style={{ borderColor: 'var(--t-danger)', color: 'var(--t-danger)' }}
                    >
                      {leave.confirmLabel}
                    </Button>
                    <Button full variant="ghost" onClick={() => setConfirming(false)}>
                      Stay
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="rest"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={springSnap}
                  >
                    <Button
                      full
                      variant="ghost"
                      onClick={() => (needsConfirm ? setConfirming(true) : leave.onLeave())}
                    >
                      {leave.label}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* -- rows ------------------------------------------------------------------ */

function Row({
  label,
  value,
  onPress,
  children,
}: {
  label: string
  value?: string
  onPress?: () => void
  children?: ReactNode
}) {
  const body = (
    <>
      <span className="text-[0.9375rem]">{label}</span>
      <span className="ml-auto flex items-center gap-2">
        {value ? <span className="chrome text-muted">{value}</span> : null}
        {children}
      </span>
    </>
  )

  // 52px rows: the same touch floor as a button, since these are the controls
  // most likely to be poked at mid-game with a thumb.
  const shell = 'flex h-13 w-full items-center gap-3 rounded-xl border border-line bg-bg px-3.5'

  return onPress ? (
    <Press cue="tap" depth={0.98} onPress={onPress} className={shell}>
      {body}
    </Press>
  ) : (
    <div className={shell}>{body}</div>
  )
}

function SoundRow() {
  const sound = useSound()
  return (
    <Row
      label="Sound"
      value={sound.enabled ? 'On' : 'Off'}
      onPress={sound.toggle}
    >
      <span className="text-muted">
        {sound.enabled ? <SoundOnIcon /> : <SoundOffIcon />}
      </span>
    </Row>
  )
}

function ThemeRow() {
  const { theme, toggle } = useTheme()
  return (
    <Row label="Theme" value={theme === 'dark' ? 'Dark' : 'Light'} onPress={toggle}>
      <span className="text-muted">{theme === 'dark' ? <MoonIcon /> : <SunIcon />}</span>
    </Row>
  )
}

/**
 * Absent entirely where the device cannot vibrate, rather than shown disabled.
 * A dead switch invites a player to keep tapping it looking for the effect.
 */
function HapticsRow() {
  const [on, setOn] = useState(hapticsEnabled)
  if (!hapticsSupported()) return null
  return (
    <Row
      label="Vibration"
      value={on ? 'On' : 'Off'}
      onPress={() => {
        const next = !on
        setHapticsEnabled(next)
        setOn(next)
      }}
    />
  )
}

/**
 * Inline swatches rather than the top bar's popover: a popover inside a sheet
 * is a second layer to dismiss, and there is room here to just show them.
 */
function AccentRow() {
  const { accent, setAccent } = useAccent()
  const { theme } = useTheme()

  return (
    <div className="flex min-h-13 w-full items-center gap-3 rounded-xl border border-line bg-bg px-3.5 py-2.5">
      <span className="shrink-0 text-[0.9375rem]">Accent</span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {ACCENT_IDS.map((id) => {
          const picked = id === accent
          return (
            <Press
              key={id}
              cue="tap"
              depth={0.86}
              onPress={() => setAccent(id)}
              aria-label={ACCENTS[id].label}
              aria-pressed={picked}
              title={ACCENTS[id].label}
              // 36px of visible swatch inside a 44px target: the row would be
              // enormous at full size, and the padding still catches the thumb.
              className="grid h-11 w-11 place-items-center rounded-lg"
            >
              <motion.span
                animate={{ scale: picked ? 1 : 0.74 }}
                transition={spring}
                className="block h-6 w-6 rounded-full"
                style={{
                  backgroundColor: ACCENTS[id][theme].c,
                  outline: picked ? '2px solid var(--t-ink)' : '1px solid var(--t-line-strong)',
                  outlineOffset: 2,
                }}
              />
            </Press>
          )
        })}
      </div>
    </div>
  )
}
