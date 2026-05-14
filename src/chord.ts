// Now serving: Bach Prelude in C, BWV 846.
//
// Every measure of the Prelude is the same fixed broken-chord pattern;
// only the chord changes. We model it as one orbital ring with eight
// moons evenly spaced, each moon assigned to a fixed VOICE (bass /
// upper-1 / upper-2 / ...) in the current chord. One revolution = one
// measure. Each revolution, the chord pointer advances to the next
// entry in PROGRESSION.
//
// 5 pitches per voicing (bass + 4 upper voices). The 8 moons traverse
// the voicing's pitches in an up-then-down pattern, mirroring Bach's
// figure: bass → u0 → u1 → u2 → u3 → u2 → u1 → u0.

import type { AudioGraph } from './audio'
import { defaultAmp, harmonicSeries } from './harmonics'

export type Pitch = number // Hz

// Equal-temperament frequencies (A4 = 440).
const C2 = 65.41, D2 = 73.42, E2 = 82.41, FS2 = 92.5, G2 = 98.0, A2 = 110.0, B2 = 123.47
const E3 = 164.81, F3 = 174.61, G3 = 196.0, A3 = 220.0, B3 = 246.94
const C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23, FS4 = 369.99, G4 = 392.0, B4 = 493.88

export type Voicing = {
  name: string
  // Five pitches in ascending order — bass at index 0, top at index 4.
  tones: readonly [Pitch, Pitch, Pitch, Pitch, Pitch]
}

const v = (
  name: string,
  tones: [Pitch, Pitch, Pitch, Pitch, Pitch],
): Voicing => ({ name, tones })

// First eight measures of the Prelude in C, simplified voicings. Each
// chord is bass + tenor + a three-note upper triad covering the chord.
export const PROGRESSION: readonly Voicing[] = [
  v('C',     [C2,  E3, G3, C4, E4]),
  v('Dm',    [D2,  F3, A3, D4, F4]),
  v('G7/B',  [B2,  F3, G3, B3, D4]),
  v('C',     [C2,  E3, G3, C4, E4]),
  v('Am',    [A2,  E3, A3, C4, E4]),
  v('D7/F#', [FS2, A3, C4, D4, FS4]),
  v('G',     [G2,  B3, D4, G4, B4]),
  v('C/E',   [E2,  G3, C4, E4, G4]),
]

// Period for one revolution = one measure.
export const MEASURE_PERIOD_S = 2

// Eight moons per ring.
export const MOON_COUNT = 8

// Voice index each moon plays — pattern is bass + up-down arpeggio of
// the four upper voices.
export const MOON_VOICE_INDEX: readonly number[] = [0, 1, 2, 3, 4, 3, 2, 1]

// Initial phase offset so moon i crosses perihelion at t = i · (period / N).
// Strike convention: a moon fires when phase wraps from near-1 to 0,
// so initialPhase = (1 − i/N) mod 1.
export const MOON_OFFSETS: readonly number[] = Array.from(
  { length: MOON_COUNT },
  (_, i) => ((MOON_COUNT - i) % MOON_COUNT) / MOON_COUNT,
)

// --- Audio synthesis ----------------------------------------------------

const HARMONIC_COUNT = 6
const DEFAULT_RING_S = 1.5
const DEFAULT_GAIN = 0.18

export type PlayToneOpts = {
  when?: number
  gain?: number
  ringS?: number
}

export function playTone(audio: AudioGraph, fundamental: number, opts?: PlayToneOpts): void {
  const { ctx, filter } = audio
  const start = opts?.when ?? ctx.currentTime
  const gain = opts?.gain ?? DEFAULT_GAIN
  const ringS = opts?.ringS ?? DEFAULT_RING_S
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, start)
  env.gain.linearRampToValueAtTime(gain, start + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, start + ringS)
  env.connect(filter)

  const partials = harmonicSeries(fundamental, HARMONIC_COUNT, defaultAmp)
  for (const h of partials) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = h.freq
    const g = ctx.createGain()
    g.gain.value = h.amp
    o.connect(g).connect(env)
    o.start(start)
    o.stop(start + ringS + 0.05)
  }

  const releaseInS = Math.max(0, start - ctx.currentTime) + ringS + 0.2
  window.setTimeout(() => {
    try {
      env.disconnect()
    } catch {
      // already disconnected
    }
  }, releaseInS * 1000)
}
