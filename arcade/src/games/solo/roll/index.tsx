import { useCallback, useEffect, useRef, useState } from 'react'
import { useDragX } from '../../../lib/input'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

/**
 * An endless descending run. The world is measured in percent of the board's
 * width and height so it scales to any screen without a camera.
 *
 * The whole simulation and its rendering happen inside one rAF loop writing
 * directly to DOM nodes. React renders the board once; a per-frame setState
 * here would re-render the tree sixty times a second while the player is
 * steering, which is exactly when it must not stutter.
 */

const BALL_R = 4.2
const BALL_Y = 72
const GAP_START = 34
const GAP_MIN = 18
const GAP_SHRINK = 0.55
const GATE_SPACING = 42
const SPEED_START = 26
const SPEED_MAX = 62
const SPEED_STEP = 0.9
const STEER = 0.55

type Gate = { y: number; gapX: number; gapW: number; passed: boolean; el?: HTMLDivElement }

function RollPlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  const boardRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)

  const ballX = useRef(50)
  const targetX = useRef(50)
  const gates = useRef<Gate[]>([])
  const passed = useRef(0)
  const dead = useRef(false)

  useDragX(
    useCallback((fraction) => {
      targetX.current = fraction * 100
      setStarted(true)
    }, []),
    true,
  )

  // Keyboard steering, for desktop.
  useEffect(() => {
    const held = new Set<string>()
    const onDown = (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) return
      e.preventDefault()
      held.add(e.code)
      setStarted(true)
    }
    const onUp = (e: KeyboardEvent) => held.delete(e.code)
    const id = setInterval(() => {
      if (!held.size) return
      const left = held.has('ArrowLeft') || held.has('KeyA')
      const right = held.has('ArrowRight') || held.has('KeyD')
      if (left) targetX.current = Math.max(0, targetX.current - 3)
      if (right) targetX.current = Math.min(100, targetX.current + 3)
    }, 16)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  useEffect(() => {
    if (!started || dead.current) return
    const board = boardRef.current
    if (!board) return

    // Seed the course far enough ahead that nothing pops in.
    gates.current = []
    for (let i = 0; i < 5; i++) gates.current.push(makeGate(-i * GATE_SPACING, i))

    for (const gate of gates.current) attach(board, gate)

    let raf = 0
    let last = performance.now()

    const loop = (now: number) => {
      const dt = Math.min(50, now - last) / 1000
      last = now

      const speed = Math.min(SPEED_MAX, SPEED_START + passed.current * SPEED_STEP)

      // Ease towards the finger rather than snapping, so the ball has weight.
      ballX.current += (targetX.current - ballX.current) * Math.min(1, STEER * dt * 12)
      ballX.current = Math.max(BALL_R, Math.min(100 - BALL_R, ballX.current))
      if (ballRef.current) ballRef.current.style.left = `${ballX.current}%`

      for (const gate of gates.current) {
        gate.y += speed * dt
        if (gate.el) gate.el.style.top = `${gate.y}%`

        // Collision only matters while the gate overlaps the ball's band.
        if (!gate.passed && Math.abs(gate.y - BALL_Y) < 3.2) {
          const insideGap =
            ballX.current - BALL_R > gate.gapX && ballX.current + BALL_R < gate.gapX + gate.gapW
          if (!insideGap) {
            dead.current = true
            sound.play('foul')
            cancelAnimationFrame(raf)
            setTimeout(() => api.end(), 280)
            return
          }
        }

        if (!gate.passed && gate.y > BALL_Y + 3.2) {
          gate.passed = true
          passed.current += 1
          api.setScore(passed.current)
          sound.play('tick')
        }
      }

      // Recycle gates that have left the board.
      for (const gate of gates.current) {
        if (gate.y > 112) {
          const highest = Math.min(...gates.current.map((g) => g.y))
          gate.y = highest - GATE_SPACING
          gate.passed = false
          const fresh = makeGate(gate.y, passed.current)
          gate.gapX = fresh.gapX
          gate.gapW = fresh.gapW
          paint(gate)
        }
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      gates.current.forEach((g) => g.el?.remove())
      gates.current = []
    }
  }, [started, api, sound])

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Gates {passed.current}</span>
        <span className="chrome text-muted/60">Drag to steer</span>
      </div>

      <div
        ref={boardRef}
        className="no-select relative w-full flex-1 overflow-hidden rounded-2xl border border-line bg-surface"
        style={{ minHeight: 'min(56vh, 28rem)', touchAction: 'none' }}
      >
        <div
          ref={ballRef}
          className="absolute rounded-full"
          style={{
            left: '50%',
            top: `${BALL_Y}%`,
            width: `${BALL_R * 2}%`,
            aspectRatio: '1',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'var(--t-accent)',
          }}
        />

        {!started ? (
          <div className="absolute inset-0 grid place-items-center">
            <span className="chrome text-muted">Drag anywhere to start</span>
          </div>
        ) : null}
      </div>

      <p className="pt-3 text-center text-[0.8125rem] text-muted short:hidden">
        Steer through the gaps. It speeds up.
      </p>
    </div>
  )
}

function makeGate(y: number, index: number): Gate {
  const gapW = Math.max(GAP_MIN, GAP_START - index * GAP_SHRINK)
  const gapX = Math.random() * (100 - gapW)
  return { y, gapX, gapW, passed: false }
}

/** Builds the two walls of a gate as one element with a transparent slot. */
function attach(board: HTMLDivElement, gate: Gate): void {
  const el = document.createElement('div')
  el.style.position = 'absolute'
  el.style.left = '0'
  el.style.width = '100%'
  el.style.height = '3.2%'
  el.style.top = `${gate.y}%`
  board.appendChild(el)
  gate.el = el
  paint(gate)
}

function paint(gate: Gate): void {
  const el = gate.el
  if (!el) return
  el.innerHTML = ''
  const wall = (left: number, width: number) => {
    const w = document.createElement('div')
    w.style.position = 'absolute'
    w.style.top = '0'
    w.style.height = '100%'
    w.style.left = `${left}%`
    w.style.width = `${width}%`
    w.style.background = 'var(--t-ink)'
    w.style.opacity = '0.85'
    w.style.borderRadius = '2px'
    el.appendChild(w)
  }
  wall(0, gate.gapX)
  wall(gate.gapX + gate.gapW, 100 - (gate.gapX + gate.gapW))
}

export const rollGame: SoloModule = {
  meta: {
    id: 'roll',
    title: 'Roll',
    rule: 'Steer the ball through the gaps in an endless run that keeps getting faster.',
    direction: 'high',
    unit: 'gates',
  },
  Play: RollPlay,
}
