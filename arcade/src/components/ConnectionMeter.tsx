import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { ConnState, NetStats } from '../net/types'
import { spring, springSnap } from '../lib/motion'

/**
 * Connection quality, and the numbers behind it on demand.
 *
 * Two jobs in one control. The dot is always there so any remaining delay reads
 * as a known state rather than a broken app — an opponent who is slow looks
 * slow, instead of the game looking stuck. Tapping it opens the actual
 * measurements, which is how you tell a bad connection from a bad build.
 */

type Grade = 'good' | 'fair' | 'poor' | 'off'

function gradeOf(conn: ConnState, stats: NetStats): Grade {
  if (conn.phase === 'reconnecting' || conn.phase === 'error') return 'poor'
  if (conn.phase === 'connecting' || !stats.rtt) return 'off'
  if (stats.rtt < 180) return 'good'
  if (stats.rtt < 420) return 'fair'
  return 'poor'
}

const BAR_COLOUR: Record<Grade, string> = {
  good: 'var(--t-accent)',
  fair: 'var(--t-ink)',
  poor: 'var(--t-danger)',
  off: 'var(--t-line-strong)',
}

const BARS: Record<Grade, number> = { good: 3, fair: 2, poor: 1, off: 0 }

export function ConnectionMeter({
  conn,
  stats,
  syncing,
}: {
  conn: ConnState
  stats: NetStats
  /**
   * A move of ours is still in flight. Deliberately *not* labelled "opponent is
   * thinking": this tracks our own unacknowledged event, and claiming it means
   * something about the other player would be a guess the shell cannot make —
   * it has no idea whose turn any given game believes it is.
   */
  syncing?: boolean
}) {
  const [open, setOpen] = useState(false)
  const grade = gradeOf(conn, stats)
  const lit = BARS[grade]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Connection ${grade}, ${stats.rtt || '–'} milliseconds. Tap for detail.`}
        className="flex h-11 items-center gap-2 rounded-lg px-2"
      >
        {/* Three rising bars: readable at a glance, no text needed. */}
        <span className="flex items-end gap-[2px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block w-[3px] rounded-full"
              animate={{
                height: 5 + i * 3,
                backgroundColor: i < lit ? BAR_COLOUR[grade] : 'var(--t-line)',
                opacity: i < lit ? 1 : 0.55,
              }}
              transition={spring}
            />
          ))}
        </span>

        <AnimatePresence initial={false}>
          {syncing ? (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={springSnap}
              className="chrome overflow-hidden whitespace-nowrap text-muted"
            >
              <ThinkingDots />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={springSnap}
            className="absolute top-full right-0 z-30 mt-1 w-max rounded-xl border border-line bg-surface p-3 shadow-sm"
          >
            <Row label="Ping" value={stats.rtt ? `${stats.rtt} ms` : '–'} />
            <Row label="Last" value={stats.lastRtt ? `${stats.lastRtt} ms` : '–'} />
            <Row label="Their move" value={stats.lag ? `${stats.lag} ms` : '–'} />
            <Row label="Transport" value={stats.push ? 'push' : 'polling'} />
            <Row label="Requests" value={String(stats.requests)} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-[3px]">
      <span className="chrome text-muted/70">{label}</span>
      <span className="chrome tnum text-ink">{value}</span>
    </div>
  )
}

/** Three dots that fill in turn, so an in-flight move reads as motion. */
function ThinkingDots() {
  return (
    <span className="flex items-center gap-[3px]" aria-label="Sending your move">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1 w-1 rounded-full bg-muted"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}
