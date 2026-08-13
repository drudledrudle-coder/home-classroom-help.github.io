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
    <div
      className="relative"
      onPointerDown={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
      }}
    >
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
        // Visually hidden but still the focused, typable element.
        className="absolute inset-0 h-full w-full opacity-0"
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
