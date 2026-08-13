import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { springSnap } from '../lib/motion'
import { CheckIcon, CopyIcon } from './icons'
import { Press } from './Press'

/**
 * The room code, tappable to copy. Copies a full join link rather than the bare
 * code — pasting a URL into a chat is one step for the other player instead of
 * three.
 */
export function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1_600)
    return () => clearTimeout(id)
  }, [copied])

  const copy = useCallback(async () => {
    const link = `${window.location.origin}${window.location.pathname}#${code}`
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Arcade', text: `Join my room: ${code}`, url: link })
        return
      }
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Clipboard blocked (insecure origin, denied permission). The code is
      // on screen anyway, so this is a non-event.
      setCopied(false)
    }
  }, [code])

  return (
    <Press
      onClick={copy}
      cue="tap"
      depth={0.94}
      aria-label={`Room code ${code.split('').join(' ')}. Tap to copy the join link.`}
      className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
    >
      <span className="display text-[1.0625rem] tracking-[0.18em] tabular-nums">{code}</span>
      <span className="relative grid h-4 w-4 place-items-center text-muted">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? 'done' : 'copy'}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, color: copied ? 'var(--t-accent)' : undefined }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={springSnap}
            className="absolute"
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </motion.span>
        </AnimatePresence>
      </span>
    </Press>
  )
}
