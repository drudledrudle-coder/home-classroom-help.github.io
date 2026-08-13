import { motion } from 'motion/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { forwardRef } from 'react'
import { springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'
import type { Cue } from '../lib/sound'

type PressProps = Omit<ComponentPropsWithoutRef<typeof motion.button>, 'children'> & {
  /** Optional: some pressables are pure colour, like the Odd One Out tiles. */
  children?: ReactNode
  /** Sound cue on press. Pass null for silent controls. */
  cue?: Cue | null
  /** How far the surface sinks. Large targets want less. */
  depth?: number
}

/**
 * The single source of press feel. Everything tappable goes through this so the
 * scale, the spring and the audio cue are identical app-wide.
 *
 * `whileTap` rather than `:active` because it is interruptible — hammering the
 * button blends springs instead of restarting a CSS transition, which is what
 * makes rapid tapping in Dot Grab feel continuous.
 */
export const Press = forwardRef<HTMLButtonElement, PressProps>(function Press(
  { children, cue = 'tap', depth = 0.96, onPointerDown, className, ...rest },
  ref,
) {
  const sound = useSound()

  return (
    <motion.button
      ref={ref}
      className={className}
      whileTap={{ scale: depth }}
      transition={springSnap}
      onPointerDown={(event) => {
        // Fire on pointerdown, not click: the cue should land with the finger.
        if (cue) sound.play(cue)
        onPointerDown?.(event)
      }}
      {...rest}
    >
      {children}
    </motion.button>
  )
})
