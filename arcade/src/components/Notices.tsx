import { AnimatePresence, motion } from 'motion/react'
import { Press } from './Press'
import { springSoft } from '../lib/motion'
import { applyUpdate, useOnline } from '../lib/pwa'

/**
 * The two things the app has to say for itself that no screen owns: that the
 * network has gone, and that a newer build is ready.
 *
 * Both sit at the bottom rather than the top. The top bar is where the player
 * looks for controls, and a banner appearing there shoves the whole layout down
 * mid-game; the bottom is out of the way of every board in the app.
 */
export function Notices({ updateReady }: { updateReady: boolean }) {
  const online = useOnline()

  // One at a time. Offline wins: it explains why things are failing right now,
  // where the update can wait for a better moment by definition.
  const show = !online ? 'offline' : updateReady ? 'update' : null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 safe-b">
      <AnimatePresence>
        {show === 'offline' ? (
          <motion.div
            key="offline"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={springSoft}
            role="status"
            className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2.5 shadow-sm"
          >
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--t-danger)' }}
              aria-hidden
            />
            <span className="chrome text-muted">Offline — solo and party still work</span>
          </motion.div>
        ) : show === 'update' ? (
          <motion.div
            key="update"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={springSoft}
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pr-1.5 pl-4 shadow-sm"
          >
            <span className="chrome text-muted">New version ready</span>
            <Press
              cue="tap"
              depth={0.94}
              onPress={applyUpdate}
              className="rounded-full px-3.5 py-2"
              style={{ backgroundColor: 'var(--t-accent)' }}
            >
              <span className="chrome" style={{ color: 'var(--t-accent-ink)' }}>
                Reload
              </span>
            </Press>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
