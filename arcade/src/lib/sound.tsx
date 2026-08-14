import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { haptic } from './haptics'

/**
 * Synthesised rather than sampled: nine cues that cost zero bytes of payload
 * and never need decoding. Off by default — sound on load is hostile — and the
 * AudioContext is not even constructed until the player opts in, so muted
 * sessions do no audio work at all.
 *
 * Two things do most of the work in making a synthesised cue sound like an
 * object rather than a beep. A **lowpass** takes the hard top off a square or
 * triangle so it thuds instead of buzzing, and a short **noise** transient gives
 * the ear the contact it expects at the start of an impact. Both are a couple of
 * nodes each, which is why these still cost nothing.
 */

export type Cue =
  | 'tap'
  | 'confirm'
  | 'pop'
  | 'tick'
  | 'perfect'
  | 'sink'
  | 'win'
  | 'lose'
  | 'foul'

const STORAGE_KEY = 'arcade.sound'

type Voice = {
  /** Hz. For a noise voice this is the centre of the band instead. */
  freq: number
  /** Seconds. */
  dur: number
  /** `noise` swaps the oscillator for a filtered white-noise burst. */
  type?: OscillatorType | 'noise'
  gain?: number
  /** Slide to this frequency across the note. Ignored by noise voices. */
  glide?: number
  /** Seconds to wait before this voice sounds. */
  at?: number
  /** Lowpass cutoff in Hz — rounds off a hard waveform. */
  cut?: number
  /** Band sharpness for a noise voice; higher reads as more pitched. */
  q?: number
}

const CUES: Record<Cue, Voice[]> = {
  // Routine cues fire hundreds of times a session, so they stay quiet, short and
  // rounded. Anything with an edge on it becomes fatiguing inside a minute.
  tap: [{ freq: 660, dur: 0.032, gain: 0.05, type: 'sine', cut: 2_400 }],
  tick: [{ freq: 1_400, dur: 0.016, gain: 0.03, type: 'sine' }],

  // Something landing. The glide gives it a body and the noise grain gives it a
  // surface, so it reads as contact rather than as a note.
  pop: [
    { freq: 380, dur: 0.075, gain: 0.07, type: 'triangle', glide: 720, cut: 1_900 },
    { freq: 1_500, dur: 0.02, gain: 0.022, type: 'noise', q: 0.8 },
  ],

  confirm: [
    { freq: 620, dur: 0.055, gain: 0.055, type: 'sine', cut: 2_600 },
    { freq: 930, dur: 0.1, gain: 0.05, type: 'sine', at: 0.05, cut: 3_200 },
  ],

  // A clean, deliberate hit — Stack's perfect drop. Three rising partials and
  // nothing else: bright enough to feel earned, over before it becomes a jingle.
  perfect: [
    { freq: 880, dur: 0.05, gain: 0.05, type: 'sine' },
    { freq: 1_320, dur: 0.05, gain: 0.042, type: 'sine', at: 0.045 },
    { freq: 1_760, dur: 0.12, gain: 0.036, type: 'sine', at: 0.09 },
  ],

  // A hull going under: a long slide down for the weight of it and a noise wash
  // for the water. The lowest cue in the set on purpose — nothing else in the app
  // sits in that register, so a sinking can never be mistaken for anything else.
  sink: [
    { freq: 240, dur: 0.5, gain: 0.05, type: 'sine', glide: 62 },
    { freq: 150, dur: 0.42, gain: 0.05, type: 'triangle', glide: 55, cut: 700, at: 0.02 },
    { freq: 700, dur: 0.34, gain: 0.03, type: 'noise', q: 0.5, at: 0.015 },
  ],

  win: [
    { freq: 523, dur: 0.085, gain: 0.055, type: 'sine', cut: 3_000 },
    { freq: 659, dur: 0.085, gain: 0.055, type: 'sine', at: 0.08, cut: 3_000 },
    { freq: 784, dur: 0.15, gain: 0.06, type: 'sine', at: 0.16, cut: 3_400 },
    { freq: 1_568, dur: 0.26, gain: 0.02, type: 'sine', at: 0.19 },
  ],
  lose: [
    { freq: 392, dur: 0.11, gain: 0.05, type: 'sine', cut: 1_600 },
    { freq: 294, dur: 0.24, gain: 0.05, type: 'triangle', glide: 220, at: 0.1, cut: 1_100 },
  ],
  foul: [
    { freq: 190, dur: 0.15, gain: 0.06, type: 'square', glide: 105, cut: 800 },
    { freq: 420, dur: 0.03, gain: 0.025, type: 'noise', q: 0.6 },
  ],
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
  /** Half a second of white noise, generated once and re-used by every burst. */
  const noiseRef = useRef<AudioBuffer | null>(null)

  const noise = useCallback((ac: AudioContext): AudioBuffer => {
    if (!noiseRef.current) {
      const len = Math.floor(ac.sampleRate * 0.5)
      const buf = ac.createBuffer(1, len, ac.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      noiseRef.current = buf
    }
    return noiseRef.current
  }, [])

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
      // Before the mute check on purpose. Haptics and sound are separate
      // channels — playing silently with the phone still tapping back is a
      // normal, and rather nice, way to play.
      haptic(cue)

      if (!enabled) return
      const ac = audio()
      const bus = busRef.current
      if (!ac || !bus) return

      for (const voice of CUES[cue]) {
        const start = ac.currentTime + (voice.at ?? 0)
        const env = ac.createGain()
        const peak = voice.gain ?? 0.06
        let source: AudioScheduledSourceNode

        if (voice.type === 'noise') {
          // Band-limited so it reads as a texture at a pitch rather than as hiss.
          const src = ac.createBufferSource()
          src.buffer = noise(ac)
          const band = ac.createBiquadFilter()
          band.type = 'bandpass'
          band.frequency.value = voice.freq
          band.Q.value = voice.q ?? 1
          src.connect(band)
          band.connect(env)
          source = src
        } else {
          const osc = ac.createOscillator()
          osc.type = voice.type ?? 'sine'
          osc.frequency.setValueAtTime(voice.freq, start)
          if (voice.glide) {
            osc.frequency.exponentialRampToValueAtTime(voice.glide, start + voice.dur)
          }
          if (voice.cut) {
            const lp = ac.createBiquadFilter()
            lp.type = 'lowpass'
            lp.frequency.value = voice.cut
            osc.connect(lp)
            lp.connect(env)
          } else {
            osc.connect(env)
          }
          source = osc
        }

        // Tiny attack avoids the click an instant-on gain produces.
        env.gain.setValueAtTime(0.0001, start)
        env.gain.exponentialRampToValueAtTime(peak, start + 0.005)
        env.gain.exponentialRampToValueAtTime(0.0001, start + voice.dur)

        env.connect(bus)
        source.start(start)
        source.stop(start + voice.dur + 0.02)
      }
    },
    [enabled, audio, noise],
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
