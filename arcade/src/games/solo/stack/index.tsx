import { motion } from 'motion/react'
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
/** Slack allowed before a drop counts as losing width. */
const PERFECT_EPS = 1.2

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

    sound.play(below.w - overlap < PERFECT_EPS ? 'confirm' : 'pop')

    const next = [...stack, { x: left, w: overlap }]
    setRows(next)
    api.setScore(next.length - 1)
    // Restart the sweep from whichever wall it was heading towards.
    pos.current = dir.current > 0 ? 0 : WIDTH - overlap
  }, [api, sound])

  useKeyAction(['Space', 'Enter', 'ArrowDown'], drop, true)

  const shown = rows.slice(-VISIBLE_ROWS)
  const top = rows[rows.length - 1]

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Height {rows.length - 1}</span>
        <span className="chrome text-muted/60">Tap to drop</span>
      </div>

      <Press
        cue={null}
        depth={1}
        onPointerDown={drop}
        aria-label="Drop the block"
        className="no-select relative w-full flex-1 overflow-hidden rounded-2xl border border-line bg-surface"
        style={{ minHeight: 'min(50vh, 25rem)' }}
      >
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
