import { useEffect, useState } from 'react'

/**
 * True only for a real pointing device. Every cursor-driven effect in the app
 * is gated on this: touch devices get none of the work, and nothing that
 * matters is ever behind a hover.
 *
 * Also false when the visitor has asked for reduced motion — pointer flourishes
 * are exactly the sort of thing that setting means.
 */
export function usePointerFine(): boolean {
  const [fine, setFine] = useState(false)

  useEffect(() => {
    const pointer = window.matchMedia('(pointer: fine)')
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setFine(pointer.matches && !calm.matches)

    update()
    pointer.addEventListener('change', update)
    calm.addEventListener('change', update)
    return () => {
      pointer.removeEventListener('change', update)
      calm.removeEventListener('change', update)
    }
  }, [])

  return fine
}
