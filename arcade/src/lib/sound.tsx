import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Synthesised rather than sampled: seven cues that cost zero bytes of payload
 * and never need decoding. Off by default — sound on load is hostile — and the
 * AudioContext is not even constructed until the player opts in, so muted
 * sessions do no audio work at all.
 */

export type Cue =
  | 'tap'
  | 'confirm'
  | 'pop'
  | 'tick'
  | 'win'
  | 'lose'
  | 'foul'

const STORAGE_KEY = 'arcade.sound'

type Voice = {
  freq: number
  /** Seconds. */
  dur: number
  type?: OscillatorType
  gain?: number
  /** Slide to this frequency across the note. */
  glide?: number
  /** Seconds to wait before this voice sounds. */
  at?: number
}

const CUES: Record<Cue, Voice[]> = {
  tap: [{ freq: 880, dur: 0.035, gain: 0.05, type: 'sine' }],
  confirm: [
    { freq: 660, dur: 0.06, gain: 0.06 },
    { freq: 990, dur: 0.09, gain: 0.05, at: 0.055 },
  ],
  pop: [{ freq: 520, dur: 0.07, gain: 0.07, type: 'triangle', glide: 760 }],
  tick: [{ freq: 1_200, dur: 0.02, gain: 0.035, type: 'square' }],
  win: [
    { freq: 523, dur: 0.09, gain: 0.06 },
    { freq: 659, dur: 0.09, gain: 0.06, at: 0.085 },
    { freq: 784, dur: 0.16, gain: 0.07, at: 0.17 },
  ],
  lose: [
    { freq: 392, dur: 0.11, gain: 0.055 },
    { freq: 294, dur: 0.2, gain: 0.05, at: 0.1 },
  ],
  foul: [{ freq: 180, dur: 0.14, gain: 0.06, type: 'square', glide: 120 }],
}

type SoundApi = {
  enabled: boolean
  toggle: () => void
  play: (cue: Cue) => void
}

const Ctx = createContext<SoundApi | null>(null)

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'on'
    } catch {
      return false
    }
  })

  const ctxRef = useRef<AudioContext | null>(null)
  const busRef = useRef<GainNode | null>(null)

  const audio = useCallback((): AudioContext | null => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      const ac = new Ctor()
      const bus = ac.createGain()
      bus.gain.value = 1
      bus.connect(ac.destination)
      ctxRef.current = ac
      busRef.current = bus
    }
    // Browsers suspend contexts created outside a gesture; every play attempt
    // follows a tap, so this is the natural place to recover.
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume()
    return ctxRef.current
  }, [])

  const play = useCallback(
    (cue: Cue) => {
      if (!enabled) return
      const ac = audio()
      const bus = busRef.current
      if (!ac || !bus) return

      for (const voice of CUES[cue]) {
        const start = ac.currentTime + (voice.at ?? 0)
        const osc = ac.createOscillator()
        const env = ac.createGain()
        const peak = voice.gain ?? 0.06

        osc.type = voice.type ?? 'sine'
        osc.frequency.setValueAtTime(voice.freq, start)
        if (voice.glide) osc.frequency.exponentialRampToValueAtTime(voice.glide, start + voice.dur)

        // Tiny attack avoids the click an instant-on gain produces.
        env.gain.setValueAtTime(0.0001, start)
        env.gain.exponentialRampToValueAtTime(peak, start + 0.006)
        env.gain.exponentialRampToValueAtTime(0.0001, start + voice.dur)

        osc.connect(env)
        env.connect(bus)
        osc.start(start)
        osc.stop(start + voice.dur + 0.02)
      }
    },
    [enabled, audio],
  )

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      try {
        sessionStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      } catch {
        /* storage disabled; the choice still holds for this page */
      }
      if (next) {
        // Unlock the context inside the gesture that turned sound on, and give
        // immediate feedback that it worked.
        const ac = audio()
        if (ac) {
          const osc = ac.createOscillator()
          const env = ac.createGain()
          osc.frequency.value = 880
          env.gain.setValueAtTime(0.0001, ac.currentTime)
          env.gain.exponentialRampToValueAtTime(0.05, ac.currentTime + 0.006)
          env.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.08)
          osc.connect(env)
          env.connect(ac.destination)
          osc.start()
          osc.stop(ac.currentTime + 0.1)
        }
      }
      return next
    })
  }, [audio])

  useEffect(() => {
    return () => {
      void ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [])

  const value = useMemo(() => ({ enabled, toggle, play }), [enabled, toggle, play])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSound(): SoundApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSound must be used inside SoundProvider')
  return ctx
}
