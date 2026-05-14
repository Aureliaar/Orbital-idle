// Each note of Für Elise's left hand is a separate moon orbiting the A
// tonic. Six moons share one orbit at 60° apart; each fires its single
// tone when it crosses the perihelion marker. The arpeggio is *spatial*
// — six bodies, six audible events per phrase, no internal scheduling.
//
// Conceptually the i and V chords still exist as groupings (a moon's
// `chordId` tells you which chord it belongs to), but the playable
// unit is now the single tone, not the chord.

import type { AudioGraph } from './audio'
import { defaultAmp, harmonicSeries } from './harmonics'

export type ChordId = 'i' | 'V'

export type MoonId = string

export type Spin = 1 | -1

export type Moon = {
  id: MoonId
  pitch: number // Hz
  pitchLabel: string
  chordId: ChordId
  period: number
  // Initial phase in [0, 1) at t = 0.
  phase: number
  // Direction of rotation: +1 = phase increases over time (clockwise on
  // canvas), -1 = phase decreases (counter-clockwise).
  spin: Spin
  // Phase value at which this moon fires. 0 = 3 o'clock, 0.5 = 9 o'clock.
  fireAt: number
}

// Equal-temperament frequencies (A4 = 440 Hz).
const A2 = 110.0
const E2 = 82.41
const E3 = 164.81
const A3 = 220.0
const G_SHARP_3 = 207.65

// 2 measures of 3/8 at ~90 BPM. One phrase = 6 notes = one full
// revolution; each moon's perihelion crossing is one note.
export const PHRASE_PERIOD_S = 4

// Notes in firing-time order: A2, E3, A3 (i) then E2, E3, G#3 (V).
// E3 appears in both chords as physically distinct moons — same pitch,
// two bodies at different orbital positions.
const SCORE: ReadonlyArray<{ pitch: number; label: string; chord: ChordId }> = [
  { pitch: A2,        label: 'A2',  chord: 'i' },
  { pitch: E3,        label: 'E3',  chord: 'i' },
  { pitch: A3,        label: 'A3',  chord: 'i' },
  { pitch: E2,        label: 'E2',  chord: 'V' },
  { pitch: E3,        label: 'E3',  chord: 'V' },
  { pitch: G_SHARP_3, label: 'G#3', chord: 'V' },
]

// Ring config: i ring rotates clockwise and fires at 3 o'clock; V ring
// rotates counter-clockwise and fires at 9 o'clock. Same audio timing,
// mirror-symmetric visual.
const RING: Record<ChordId, { spin: Spin; fireAt: number }> = {
  i: { spin: 1, fireAt: 0 },
  V: { spin: -1, fireAt: 0.5 },
}

// Given desired fire time, period, spin, and fire phase, solve for the
// initial phase such that phase(t_fire) == fireAt:
//   phase_t = ((spin * t / period) + initialPhase) mod 1
//   ⇒ initialPhase = (fireAt − spin · t_fire / period) mod 1
const norm = (x: number) => ((x % 1) + 1) % 1
const phaseFor = (tFire: number, period: number, spin: Spin, fireAt: number) =>
  norm(fireAt - (spin * tFire) / period)

export const MOONS: readonly Moon[] = SCORE.map((m, i) => {
  const tFire = (i * PHRASE_PERIOD_S) / SCORE.length
  const { spin, fireAt } = RING[m.chord]
  return {
    id: `moon-${i}`,
    pitch: m.pitch,
    pitchLabel: m.label,
    chordId: m.chord,
    period: PHRASE_PERIOD_S,
    phase: phaseFor(tFire, PHRASE_PERIOD_S, spin, fireAt),
    spin,
    fireAt,
  }
})

// --- Audio synthesis ----------------------------------------------------

const HARMONIC_COUNT = 6
const RING_DURATION_S = 1.5
const PLUCK_GAIN = 0.18

export function playTone(audio: AudioGraph, fundamental: number, when?: number): void {
  const { ctx, filter } = audio
  const start = when ?? ctx.currentTime
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, start)
  env.gain.linearRampToValueAtTime(PLUCK_GAIN, start + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, start + RING_DURATION_S)
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
    o.stop(start + RING_DURATION_S + 0.05)
  }

  // env.disconnect() once the ring finishes — scheduled on wall clock,
  // since `start` is in audio-context time.
  const releaseInS = Math.max(0, start - ctx.currentTime) + RING_DURATION_S + 0.2
  window.setTimeout(() => {
    try {
      env.disconnect()
    } catch {
      // already disconnected
    }
  }, releaseInS * 1000)
}
