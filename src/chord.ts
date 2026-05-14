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

export type Moon = {
  id: MoonId
  pitch: number // Hz
  pitchLabel: string
  chordId: ChordId
  period: number
  phase: number
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

// Strike convention: a moon fires when its phase wraps 1 → 0. To make
// moon i cross perihelion at t = i * (period / N), its starting phase
// offset must be (N − i) mod N divided by N.
export const MOONS: readonly Moon[] = SCORE.map((m, i) => ({
  id: `moon-${i}`,
  pitch: m.pitch,
  pitchLabel: m.label,
  chordId: m.chord,
  period: PHRASE_PERIOD_S,
  phase: ((SCORE.length - i) % SCORE.length) / SCORE.length,
}))

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
