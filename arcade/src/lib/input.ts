import { useEffect, useRef } from 'react'

export type Dir = 'up' | 'down' | 'left' | 'right'

/** Minimum travel before a drag counts as a swipe rather than a tap. */
const SWIPE_MIN_PX = 24

/**
 * Directional input for the grid games. Swipe on touch, arrows or WASD on a
 * keyboard — the same hook so Merge, Snake and Roll all read identically and
 * neither input is second class.
 *
 * Listens on the window rather than an element: these games fill the screen,
 * and a swipe that starts on a tile should count the same as one that starts
 * on the gap between tiles.
 */
export function useDirectionInput(onDir: (dir: Dir) => void, enabled = true): void {
  // Kept in a ref so changing the handler does not tear down the listeners
  // mid-swipe, which would drop the gesture.
  const handler = useRef(onDir)
  handler.current = onDir

  useEffect(() => {
    if (!enabled) return

    const start = { x: 0, y: 0, active: false }

    const onDown = (event: PointerEvent) => {
      start.x = event.clientX
      start.y = event.clientY
      start.active = true
    }

    const onUp = (event: PointerEvent) => {
      if (!start.active) return
      start.active = false

      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return

      // The dominant axis wins outright; diagonal swipes should still do
      // something predictable rather than nothing.
      if (Math.abs(dx) > Math.abs(dy)) handler.current(dx > 0 ? 'right' : 'left')
      else handler.current(dy > 0 ? 'down' : 'up')
    }

    const KEYS: Record<string, Dir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right',
    }

    const onKey = (event: KeyboardEvent) => {
      const dir = KEYS[event.code]
      if (!dir || event.metaKey || event.ctrlKey || event.altKey) return
      // Arrows scroll the page otherwise, which fights the board.
      event.preventDefault()
      handler.current(dir)
    }

    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled])
}

/**
 * Arrow-key navigation across a grid of buttons.
 *
 * Rather than tracking a cursor in React state, this moves real DOM focus
 * between the buttons already on screen. Enter and Space then activate them
 * natively, the existing `:focus-visible` ring shows where you are, and screen
 * readers follow along — none of which is true of a hand-rolled cursor.
 */
export function useGridKeys(
  ref: { current: HTMLElement | null },
  cols: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return

    const STEP: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -cols,
      ArrowDown: cols,
    }

    const onKey = (event: KeyboardEvent) => {
      const step = STEP[event.code]
      if (step === undefined || event.metaKey || event.ctrlKey || event.altKey) return
      const host = ref.current
      if (!host) return

      // Every button, including disabled ones, so the grid keeps its shape as
      // cells are used up. Disabled cells are skipped over, not collapsed.
      const cells = [...host.querySelectorAll<HTMLButtonElement>('button')]
      if (!cells.length) return

      event.preventDefault()
      const from = cells.indexOf(document.activeElement as HTMLButtonElement)
      if (from < 0) {
        cells.find((c) => !c.disabled)?.focus()
        return
      }

      for (let to = from + step; to >= 0 && to < cells.length; to += step) {
        if (!cells[to].disabled) {
          cells[to].focus()
          return
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ref, cols, enabled])
}

/** Single-key shortcut, for boards whose whole interaction is one action. */
export function useKeyAction(codes: string[], action: () => void, enabled = true): void {
  const handler = useRef(action)
  handler.current = action

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (!codes.includes(event.code) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.repeat) return
      event.preventDefault()
      handler.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, codes.join(',')])
}

/**
 * Horizontal drag position as a 0..1 fraction of the viewport, for games
 * steered by holding rather than swiping. Reports through a ref-held callback
 * on every move, including the initial press.
 */
export function useDragX(onX: (fraction: number) => void, enabled = true): void {
  const handler = useRef(onX)
  handler.current = onX

  useEffect(() => {
    if (!enabled) return
    let down = false

    const report = (clientX: number) => {
      handler.current(Math.max(0, Math.min(1, clientX / window.innerWidth)))
    }
    const onDown = (e: PointerEvent) => {
      down = true
      report(e.clientX)
    }
    const onMove = (e: PointerEvent) => {
      if (down) report(e.clientX)
    }
    const onUp = () => {
      down = false
    }

    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [enabled])
}
