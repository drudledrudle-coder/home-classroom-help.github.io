import type { Cue } from './sound'

/**
 * Haptics on the same cue points as the sound, so a game never has to ask for
 * one separately — every existing `sound.play(...)` site gets a matching tap for
 * free, and the two can never drift apart.
 *
 * Deliberately not a React context on the firing path: this is called from
 * inside `play`, which runs in event handlers and animation callbacks where a
 * hook lookup would be both awkward and pointless. Module state, mirrored to
 * localStorage.
 *
 * Support is genuinely partial. Android Chrome implements the Vibration API;
 * iOS Safari does not expose it at all, so on an iPhone this is a no-op no
 * matter what the toggle says — which is why the control only renders where the
 * API exists, rather than offering a switch that does nothing.
 */

const STORAGE_KEY = 'arcade.haptics'

/** Milliseconds. Single number = one buzz; array alternates buzz/pause. */
const PATTERNS: Record<Cue, number | number[]> = {
  // Everything routine is one short tick. Anything longer on a per-tap cue
  // stops reading as feedback and starts reading as a fault.
  tap: 8,
  tick: 5,
  pop: 12,
  confirm: [10, 26, 16],
  // Light and quick: this marks precision, so it should feel like a click rather
  // than a reward buzz.
  perfect: [8, 18, 14],
  // The heaviest pattern in the set, matching the lowest sound — a ship going
  // down is the one moment in Salvo worth feeling through the case.
  sink: [26, 40, 60],
  win: [16, 38, 16, 38, 28],
  lose: [28, 55, 40],
  foul: [36, 28, 36],
}

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function stored(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // On by default where it is supported: unlike sound, a haptic is private,
    // brief and does not interrupt anyone else in the room.
    return raw === null ? true : raw === 'on'
  } catch {
    return true
  }
}

let enabled = hapticsSupported() && stored()

export const hapticsEnabled = (): boolean => enabled

export function setHapticsEnabled(next: boolean): void {
  enabled = next && hapticsSupported()
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
  } catch {
    /* storage disabled; the choice still holds for this page */
  }
}

export function haptic(cue: Cue): void {
  if (!enabled || !hapticsSupported()) return
  // Someone who has asked for less motion has not asked for a buzzing phone.
  if (reducedMotion()) return
  try {
    navigator.vibrate(PATTERNS[cue])
  } catch {
    /* some browsers throw when the page is not visible; never worth surfacing */
  }
}
