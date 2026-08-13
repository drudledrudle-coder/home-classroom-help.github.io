import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { CheckIcon, CopyIcon } from '../components/icons'
import { spring } from '../lib/motion'

/**
 * What the host stares at until someone joins. The code is the entire point of
 * the screen, so it is set at display scale with everything else stepped well
 * back from it.
 */
export function WaitingRoom({ code, onSolo }: { code: string; onSolo: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1_800)
    return () => clearTimeout(id)
  }, [copied])

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${code}`
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Arcade', text: `Join my room: ${code}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-10">
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="chrome text-muted"
      >
        Your room code
      </motion.span>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
        className="flex gap-2 py-6 sm:gap-3"
      >
        {code.split('').map((ch, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.05 * i }}
            className="display grid h-20 w-16 place-items-center rounded-2xl border border-line bg-surface text-[2.75rem] sm:h-24 sm:w-20 sm:text-[3.25rem]"
          >
            {ch}
          </motion.span>
        ))}
      </motion.div>

      <div className="flex items-center gap-2.5 pb-8">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="block h-1.5 w-1.5 rounded-full bg-accent"
        />
        <span className="chrome text-muted">Waiting for someone to join</span>
      </div>

      <div className="flex w-full flex-col gap-2.5">
        <Button full variant="secondary" onClick={share}>
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? 'Link copied' : 'Copy join link'}
        </Button>
        <Button full variant="ghost" onClick={onSolo}>
          Play the bot instead
        </Button>
      </div>
    </div>
  )
}
