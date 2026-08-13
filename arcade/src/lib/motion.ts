import type { Transition } from 'motion/react'

/**
 * One spring vocabulary for the whole app. Durations are never specified
 * directly — everything is physical, so interruptions blend instead of
 * snapping, which is most of why the interface feels responsive under rapid
 * tapping.
 */

/** Default for UI that moves between states. */
export const spring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.9,
}

/** Tighter and faster: presses, chips, small toggles. */
export const springSnap: Transition = {
  type: 'spring',
  stiffness: 700,
  damping: 32,
  mass: 0.6,
}

/** Looser, with a little overshoot: entrances and celebratory beats. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 240,
  damping: 26,
  mass: 1,
}

/** Screen-level transitions, where overshoot would read as sloppy. */
export const springScreen: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 38,
  mass: 1,
}

/** The tactile scale every pressable surface shares. */
export const pressable = {
  whileTap: { scale: 0.96 },
  transition: springSnap,
} as const

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: spring,
} as const

/** Stagger helper for lists that appear together. */
export const stagger = (index: number, step = 0.045) => ({
  ...springSoft,
  delay: index * step,
})
