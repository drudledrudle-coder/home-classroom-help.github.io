import { useEffect, useRef } from 'react'
import { usePointerFine } from '../lib/pointer'

/**
 * A faint warmth that trails the cursor across the page. It is meant to be
 * felt rather than noticed — at this opacity it reads as the page lighting up
 * slightly under the hand, not as a spotlight effect.
 *
 * Position is written to CSS custom properties inside a rAF, so moving the
 * mouse costs one style write per frame and never touches React. The element
 * itself is inert and sits behind everything.
 */
export function CursorField() {
  const fine = usePointerFine()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fine) return
    const node = ref.current
    if (!node) return

    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight / 2
    let currentX = targetX
    let currentY = targetY
    let raf = 0
    let visible = false

    const onMove = (event: PointerEvent) => {
      targetX = event.clientX
      targetY = event.clientY
      if (!visible) {
        visible = true
        node.style.opacity = '1'
      }
    }

    const onLeave = () => {
      visible = false
      node.style.opacity = '0'
    }

    const loop = () => {
      // Lag behind the cursor so the light feels like it has weight.
      currentX += (targetX - currentX) * 0.12
      currentY += (targetY - currentY) * 0.12
      node.style.setProperty('--cx', `${currentX}px`)
      node.style.setProperty('--cy', `${currentY}px`)
      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    raf = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(raf)
    }
  }, [fine])

  if (!fine) return null

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 opacity-0 transition-opacity duration-700"
      style={{
        background:
          'radial-gradient(340px circle at var(--cx, 50%) var(--cy, 50%), color-mix(in srgb, var(--t-accent) 9%, transparent), transparent 70%)',
      }}
    />
  )
}
