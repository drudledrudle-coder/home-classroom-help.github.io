import { useMotionValueEvent, useSpring } from 'motion/react'
import { useEffect, useRef } from 'react'

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

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  useMotionValueEvent(spring, 'change', (latest) => {
    if (ref.current) ref.current.textContent = latest.toFixed(precision) + suffix
  })

  return (
    <span ref={ref} className={`tnum ${className}`}>
      {value.toFixed(precision) + suffix}
    </span>
  )
}
