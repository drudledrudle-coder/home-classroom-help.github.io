import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Press } from '../../../components/Press'
import { useKeyAction } from '../../../lib/input'
import { springSnap } from '../../../lib/motion'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

/** The board is measured in percent of its own width. */
const WIDTH = 100
const START_W = 46
const ROW_H = 22
const VISIBLE_ROWS = 9
const START_SPEED = 46
const SPEED_STEP = 2.4
const MAX_SPEED = 105
/**
 * Slack allowed before a drop counts as losing width, in percent of the board.
 *
 * Deliberately generous. A perfect drop is meant to be a thing you can *aim*
 * for and hit fairly often — it is the reward loop of the game — so the window
 * is a couple of percent rather than a pixel hunt.
 */
const PERFECT_EPS = 2.6
/** Perfect drops in a row before the block starts growing back. */
const STREAK_TO_GROW = 2
/** How much width each perfect beyond the threshold returns. */
const GROW_BY = 5.5

type Row = { x: number; w: number }

function StackPlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  const [rows, setRows] = useState<Row[]>([{ x: (WIDTH - START_W) / 2, w: START_W }])

  const sliderRef = useRef<HTMLDivElement>(null)
  const pos = useRef(0)
  const dir = useRef(1)
  const dead = useRef(false)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // Streak lives in a ref for the drop handler and in state for the readout —
  // the handler must not read a stale closure, and the label must re-render.
  const streak = useRef(0)
  const [streakShown, setStreak] = useState(0)
  const [flash, setFlash] = useState(0)
  // The most recent perfect landing, so a ring can bloom from exactly where
  // the block came to rest rather than somewhere generic.
  const hitId = useRef(0)
  const [hit, setHit] = useState<{ n: number; x: number; w: number; y: number } | null>(null)

  // The slider is the only thing moving every frame, so it is written straight
  // to the DOM node. Routing it through React state would re-render the whole
  // tower sixty times a second for one moving rectangle.
  useEffect(() => {
    if (dead.current) return
    let raf = 0
    let last = performance.now()

    const loop = (now: number) => {
      const dt = Math.min(50, now - last) / 1000
      last = now

      const top = rowsRef.current[rowsRef.current.length - 1]
      const speed = Math.min(MAX_SPEED, START_SPEED + rowsRef.current.length * SPEED_STEP)
      pos.current += dir.current * speed * dt

      if (pos.current <= 0) {
        pos.current = 0
        dir.current = 1
      } else if (pos.current + top.w >= WIDTH) {
        pos.current = WIDTH - top.w
        dir.current = -1
      }

      const node = sliderRef.current
      if (node) {
        node.style.left = `${pos.current}%`
        node.style.width = `${top.w}%`
      }
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const drop = useCallback(() => {
    if (dead.current) return
    const stack = rowsRef.current
    const below = stack[stack.length - 1]
    const left = Math.max(below.x, pos.current)
    const right = Math.min(below.x + below.w, pos.current + below.w)
    const overlap = right - left

    // No overlap at all means the block sails past the tower.
    if (overlap <= 0.5) {
      dead.current = true
      sound.play('foul')
      setTimeout(() => api.end(), 300)
      return
    }

    const perfect = below.w - overlap < PERFECT_EPS
    sound.play(perfect ? 'confirm' : 'pop')
    // Fires on every clean landing, not just the ones that pay out width —
    // the player needs to know the timing was right the moment it happens,
    // otherwise a perfect drop is indistinguishable from a lucky one.
    if (perfect) {
      // Clamped to the visible window. The tower only renders its last
      // VISIBLE_ROWS and lays them out by their index *within that window*, so
      // an absolute height sent the ring climbing off the top of the board once
      // the stack grew past it.
      setHit({
        n: hitId.current++,
        x: left,
        w: overlap,
        y: Math.min(stack.length, VISIBLE_ROWS - 1),
      })
    }

    // A streak of clean drops gives width back, the way the 3D stack games do.
    // Without it the tower only ever narrows, so a good run is punished at
    // exactly the point the player has started to master the timing.
    let width = overlap
    let left2 = left
    if (perfect) {
      streak.current += 1
      if (streak.current >= STREAK_TO_GROW) {
        // Never wider than the base, and never wider than the board.
        const grown = Math.min(START_W, Math.min(WIDTH, width + GROW_BY))
        // Grow around the centre so the tower stays plumb rather than drifting.
        left2 = Math.max(0, Math.min(WIDTH - grown, left - (grown - width) / 2))
        width = grown
        setFlash((n) => n + 1)
      }
    } else {
      streak.current = 0
    }
    setStreak(streak.current)

    const next = [...stack, { x: left2, w: width }]
    setRows(next)
    api.setScore(next.length - 1)
    // Restart the sweep from whichever wall it was heading towards.
    pos.current = dir.current > 0 ? 0 : WIDTH - width
  }, [api, sound])

  useKeyAction(['Space', 'Enter', 'ArrowDown'], drop, true)

  const shown = rows.slice(-VISIBLE_ROWS)
  const top = rows[rows.length - 1]

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Height {rows.length - 1}</span>
        {streakShown >= STREAK_TO_GROW ? (
          <motion.span
            key={streakShown}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSnap}
            className="chrome text-accent"
          >
            Perfect ×{streakShown}
          </motion.span>
        ) : (
          <span className="chrome text-muted/60">Tap to drop</span>
        )}
      </div>

      <Press
        cue={null}
        depth={1}
        onPointerDown={drop}
        aria-label="Drop the block"
        className="no-select relative w-full flex-1 overflow-hidden rounded-2xl border border-line bg-surface"
        style={{ minHeight: 'min(50vh, 25rem)' }}
      >
        {/* A quick pulse when a streak pays out, so the reward is felt at the
            moment it happens rather than only read off the counter. */}
        <motion.div
          key={flash}
          initial={flash ? { opacity: 0.5 } : false}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.42 }}
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: 'var(--t-accent-wash)' }}
        />

        {/* Expands and fades from the block that just landed. Deliberately
            outline-only: a filled flash would hide the tower underneath at
            exactly the moment the player is checking their alignment. */}
        <AnimatePresence>
          {hit ? (
            <motion.div
              key={hit.n}
              initial={{ opacity: 0.9, scaleX: 1, scaleY: 1 }}
              animate={{ opacity: 0, scaleX: 1.5, scaleY: 2.6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.42, ease: 'easeOut' }}
              onAnimationComplete={() => setHit((h) => (h && h.n === hit.n ? null : h))}
              className="pointer-events-none absolute rounded-sm border-2"
              style={{
                left: `${hit.x}%`,
                width: `${hit.w}%`,
                bottom: `${hit.y * ROW_H}px`,
                height: `${ROW_H - 3}px`,
                borderColor: 'var(--t-accent)',
                transformOrigin: 'center',
              }}
            />
          ) : null}
        </AnimatePresence>

        <div
          ref={sliderRef}
          className="absolute rounded-sm"
          style={{
            left: 0,
            width: `${top.w}%`,
            bottom: `${shown.length * ROW_H}px`,
            height: `${ROW_H - 3}px`,
            backgroundColor: 'var(--t-accent)',
          }}
        />

        {/* The tower is built bottom-up: within the visible window the oldest
            block sits lowest and each new one lands on top of it. As the stack
            grows past the window the view effectively rises with it, which is
            what makes it read as climbing rather than filling downwards. */}
        {shown.map((row, i) => {
          const fromTop = shown.length - 1 - i
          return (
            <motion.div
              key={rows.length - shown.length + i}
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: Math.max(0.16, 1 - fromTop * 0.11), y: 0 }}
              transition={springSnap}
              className="absolute rounded-sm"
              style={{
                left: `${row.x}%`,
                width: `${row.w}%`,
                bottom: `${i * ROW_H}px`,
                height: `${ROW_H - 3}px`,
                backgroundColor: 'var(--t-ink)',
              }}
            />
          )
        })}
      </Press>

      <p className="pt-3 text-center text-[0.8125rem] text-muted short:hidden">
        Overhang gets sliced off. {Math.round(top.w)}% wide.
      </p>
    </div>
  )
}

export const stackGame: SoloModule = {
  meta: {
    id: 'stack',
    title: 'Stack',
    rule: 'Tap to drop the sliding block — whatever hangs over the edge is cut away.',
    direction: 'high',
    unit: 'blocks',
  },
  Play: StackPlay,
}
