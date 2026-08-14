import { motion } from 'motion/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { forwardRef, useRef } from 'react'
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
  /**
   * Game input. Fires on *pointerdown* rather than click.
   *
   * `onClick` waits for the pointer to come back up, which costs a tap's worth
   * of delay on every move and is what made the boards feel laggy. Worse, a
   * mobile browser will swallow the second tap of a quick double-tap as a
   * zoom gesture — so hammering a pad in Recall genuinely lost presses.
   *
   * Keyboard activation is handled explicitly on keydown rather than relying on
   * the browser turning Enter into a click — that synthesis does not survive
   * every combination of focus management and motion wrappers, and a board you
   * cannot drive from the keyboard is a worse regression than a slow tap.
   */
  onPress?: (event: unknown) => void
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
  { children, cue = 'tap', depth = 0.96, onPointerDown, onPress, onKeyDown, onClick, className, ...rest },
  ref,
) {
  const sound = useSound()
  /** When a pointer last activated this, so the trailing click can be ignored. */
  const lastPointer = useRef(0)

  return (
    <motion.button
      ref={ref}
      className={className}
      whileTap={{ scale: depth }}
      transition={springSnap}
      {...rest}
      // After the spread, so a caller's `style` cannot drop `touch-action`.
      // Without it the browser may hold a tap back to see whether a second one
      // is coming — exactly the delay a game must not have.
      style={{ touchAction: 'manipulation', ...(rest.style ?? {}) }}
      onPointerDown={(event) => {
        // Fire on pointerdown, not click: the cue should land with the finger.
        if (cue) sound.play(cue)
        lastPointer.current = performance.now()
        onPress?.(event)
        onPointerDown?.(event)
      }}
      onKeyDown={(event) => {
        if (onPress && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          if (cue) sound.play(cue)
          lastPointer.current = 0
          onPress(event)
        }
        onKeyDown?.(event)
      }}
      // Belt and braces for keyboard activation.
      //
      // Handling keydown alone is not enough: some motion wrappers consume
      // Enter before it reaches the handler, which silently cost Salvo's
      // placement grid its keyboard path. Accepting the click too covers that,
      // and the timestamp guard keeps a real tap from firing twice — a pointer
      // press is always followed by its own click a few milliseconds later.
      onClick={(event) => {
        if (onPress && performance.now() - lastPointer.current > 600) onPress(event)
        onClick?.(event)
      }}
    >
      {children}
    </motion.button>
  )
})
