import { motion, useSpring } from 'motion/react'
import type { ReactNode } from 'react'
import { usePointerFine } from '../lib/pointer'

/**
 * Leans a element towards the cursor while it is over it. The displacement is
 * deliberately small — a few pixels reads as the surface being alive, more than
 * that reads as a gimmick and makes things harder to click.
 *
 * Driven by motion values, so tracking the cursor never re-renders React.
 */
export function Magnetic({
  children,
  strength = 0.22,
  limit = 7,
  className,
}: {
  children: ReactNode
  strength?: number
  /**
   * Hard cap in pixels. Displacement scaled purely by `strength` grows with the
   * element, so a full-width button would swing ~24px — enough to feel unstable
   * and to make it harder to actually hit. The cap keeps the effect constant
   * regardless of how wide the target is.
   */
  limit?: number
  className?: string
}) {
  const fine = usePointerFine()
  const config = { stiffness: 240, damping: 18, mass: 0.35 }
  const x = useSpring(0, config)
  const y = useSpring(0, config)

  if (!fine) return <div className={className}>{children}</div>

  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value))

  return (
    <motion.div
      className={className}
      style={{ x, y }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        x.set(clamp((event.clientX - (box.left + box.width / 2)) * strength))
        y.set(clamp((event.clientY - (box.top + box.height / 2)) * strength))
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </motion.div>
  )
}
