import { useMotionValueEvent, useSpring } from 'motion/react'
import { useEffect, useLayoutEffect, useRef } from 'react'

type CounterProps = {
  value: number
  className?: string
  /** Decimal places; reaction times want 0, seconds sometimes want 1. */
  precision?: number
  suffix?: string
}

/**
 * Scores roll rather than jump. The spring drives `textContent` directly
 * instead of React state — a counter re-rendering the tree sixty times a
 * second during Dot Grab would cost more than the animation is worth.
 */
export function Counter({ value, className = '', precision = 0, suffix = '' }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const spring = useSpring(value, { stiffness: 190, damping: 24, mass: 0.7 })

  // Seeded once, before paint, so the first frame is not blank. After this the
  // spring is the only writer.
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = value.toFixed(precision) + suffix
    // Mount only: re-running this would fight the spring, which is the bug below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  useMotionValueEvent(spring, 'change', (latest) => {
    if (ref.current) ref.current.textContent = latest.toFixed(precision) + suffix
  })

  // Deliberately no children.
  //
  // Rendering `{value}` here put two writers on one text node: React reset it to
  // the *final* number on every re-render, and the spring's next frame put the
  // *interpolated* number back. Any game that scored while the spring was still
  // settling — Roll, which scores every gate — flickered between the two. The
  // spring owns the text; React owns nothing but the element.
  return <span ref={ref} className={`tnum ${className}`} />
}
