import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { CODE_ALPHABET, CODE_LENGTH } from '../../shared/protocol'
import { springSnap } from '../lib/motion'
import { useSound } from '../lib/sound'

/**
 * Four boxes over one real input. A single hidden field keeps mobile keyboards,
 * autofill and paste behaving normally, while the boxes are purely presentation
 * — the usual per-box-input approach breaks paste and backspace on Android.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: {
  value: string
  onChange: (next: string) => void
  onComplete?: (code: string) => void
  disabled?: boolean
  invalid?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const sound = useSound()

  useEffect(() => {
    if (value.length === CODE_LENGTH) onComplete?.(value)
  }, [value, onComplete])

  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '')

  return (
    // No pointer handling of its own. The input already covers this box, so a
    // tap lands on the real field and focuses it natively — which is the only
    // thing iOS Safari reliably opens a keyboard for. The previous version
    // intercepted pointerdown, called `preventDefault` and focused by hand,
    // which is exactly the sequence that stops the native focus happening at
    // all: on some devices the boxes simply could not be typed into.
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
            .toUpperCase()
            .split('')
            .filter((ch) => CODE_ALPHABET.includes(ch))
            .slice(0, CODE_LENGTH)
            .join('')
          if (next.length > value.length) sound.play('tap')
          onChange(next)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label="Room code, four letters"
        // Invisible, but the real target: it covers the boxes and sits above
        // them, so every tap anywhere on the control hits it. `text-[16px]` is
        // not cosmetic — iOS zooms the whole page when focusing an input under
        // 16px, and the caret is hidden because the boxes draw their own.
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-[16px] text-transparent caret-transparent opacity-0"
        style={{ touchAction: 'manipulation' }}
      />

      <div className="flex justify-center gap-2 sm:gap-2.5">
        {cells.map((ch, i) => {
          const active = focused && i === Math.min(value.length, CODE_LENGTH - 1)
          return (
            <motion.div
              key={i}
              animate={{
                scale: ch ? 1 : 0.985,
                borderColor: invalid
                  ? 'var(--t-accent)'
                  : active
                    ? 'var(--t-ink)'
                    : 'var(--t-line-strong)',
              }}
              transition={springSnap}
              className="grid h-16 w-14 place-items-center rounded-xl border bg-surface sm:h-18 sm:w-16"
            >
              <motion.span
                key={ch || 'empty'}
                initial={ch ? { opacity: 0, y: 6, scale: 0.8 } : false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={springSnap}
                className="display text-[1.75rem] sm:text-[2rem]"
              >
                {ch}
              </motion.span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
