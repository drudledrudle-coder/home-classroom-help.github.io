import { AnimatePresence, motion } from 'motion/react'
import { haptic, hapticsEnabled, hapticsSupported, setHapticsEnabled } from '../lib/haptics'
import { useEffect, useRef, useState } from 'react'
import { ACCENTS, ACCENT_IDS, useAccent } from '../lib/accent'
import { spring, springSnap } from '../lib/motion'
import { useTheme } from '../lib/theme'
import { Press } from './Press'

/**
 * Swatch button that opens a small palette. The trigger shows the live accent,
 * so the control is its own preview.
 */
export function AccentPicker() {
  const { accent, setAccent } = useAccent()
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on an outside tap or Escape — a popover you cannot dismiss by
  // tapping away feels broken on a phone.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <Press
        cue={null}
        depth={0.88}
        onClick={() => setOpen((v) => !v)}
        aria-label="Change accent colour"
        aria-expanded={open}
        title="Accent colour"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
      >
        <motion.span
          animate={{ scale: open ? 1.12 : 1 }}
          transition={springSnap}
          className="block h-[18px] w-[18px] rounded-full border"
          style={{
            backgroundColor: 'var(--t-accent)',
            borderColor: 'color-mix(in srgb, var(--t-ink) 22%, transparent)',
          }}
        />
      </Press>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={springSnap}
            aria-label="Appearance"
            /* w-max is load-bearing: the containing block is the 44px trigger,
               so shrink-to-fit would clamp the popover to 44px and the swatches
               would overlap each other and become unclickable. */
            className="absolute right-0 z-50 mt-1.5 w-max origin-top-right rounded-xl border border-line bg-surface p-2"
          >
            <div className="grid grid-cols-3 gap-1" role="listbox" aria-label="Accent colour">
              {ACCENT_IDS.map((id) => {
                const swatch = ACCENTS[id][theme].c
                const active = id === accent
                return (
                  <Press
                    key={id}
                    cue="tap"
                    depth={0.86}
                    role="option"
                    aria-selected={active}
                    aria-label={ACCENTS[id].label}
                    title={ACCENTS[id].label}
                    onClick={() => {
                      setAccent(id)
                      setOpen(false)
                    }}
                    className="grid h-11 w-11 place-items-center rounded-lg"
                  >
                    <span className="relative grid place-items-center">
                      <span
                        className="block h-6 w-6 rounded-full"
                        style={{ backgroundColor: swatch }}
                      />
                      {active ? (
                        <motion.span
                          layoutId="accent-ring"
                          transition={spring}
                          className="absolute -inset-1 rounded-full border-2"
                          style={{ borderColor: 'var(--t-ink)' }}
                        />
                      ) : null}
                    </span>
                  </Press>
                )
              })}
            </div>

            <HapticsRow />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/**
 * Only rendered where the Vibration API actually exists. iOS Safari has no
 * vibration at all, so on an iPhone this row is absent rather than present and
 * inert — a switch that visibly does nothing is worse than no switch.
 */
function HapticsRow() {
  const [on, setOn] = useState(hapticsEnabled)
  if (!hapticsSupported()) return null

  return (
    <div className="mt-1 border-t border-line pt-1">
      <Press
        cue="tap"
        depth={0.96}
        role="switch"
        aria-checked={on}
        aria-label="Haptics"
        onClick={() => {
          const next = !on
          setHapticsEnabled(next)
          setOn(next)
          // Fire one immediately when switching on, so the choice is felt as
          // well as seen.
          if (next) haptic('confirm')
        }}
        className="flex h-11 w-full items-center justify-between gap-4 rounded-lg px-2"
      >
        <span className="chrome text-muted">Haptics</span>
        <motion.span
          animate={{ backgroundColor: on ? 'var(--t-accent)' : 'var(--t-line-strong)' }}
          transition={spring}
          className="relative block h-5 w-9 shrink-0 rounded-full"
        >
          <motion.span
            animate={{ x: on ? 17 : 2 }}
            transition={spring}
            className="absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full bg-surface"
          />
        </motion.span>
      </Press>
    </div>
  )
}
