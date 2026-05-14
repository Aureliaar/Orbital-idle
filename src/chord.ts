// A Chord is a named bundle of pitches that fires as a unit (block or
// arpeggiated). It owns the chord tones and the playback shape; an
// orbit decides *when* it fires (not in this module yet — wired in
// later stages). The audio path here is a sibling to HarvestStage's
// `playPluck`: same pluck shape, no coincidence-boost concept.
//
// Note for naming: in code we call this object `Chord` to avoid
// colliding with the existing `resonator` UI in HarvestStage.tsx.
// Conceptually this is what "resonators have to be chords" refers to.

import type { AudioGraph } from './audio'
import { defaultAmp, harmonicSeries } from './harmonics'

export type Pitch = number // Hz

export type Arpeggiation = 'block' | 'low-mid-high'

export type ChordId = string

export type Chord = {
  id: ChordId
  // Chord tones in low → high order. `low-mid-high` arpeggiation
  // fires them in that sequence; `block` fires them simultaneously.
  tones: readonly Pitch[]
  arpeggiation: Arpeggiation
  // Per-chord gain multiplier on top of the base pluck envelope.
  gain?: number
}

// Standard equal-temperament frequencies (A4 = 440 Hz) for the
// Für Elise A-minor accompaniment.
const A2 = 110.0
const E2 = 82.41
const E3 = 164.81
const A3 = 220.0
const G_SHARP_3 = 207.65

// i = A minor (tonic), V = E major (dominant). E3 is the shared
// pivot tone — present in both chords, the consonant link that
// makes V → i resolve smoothly.
export const CHORD_I: Chord = {
  id: 'i',
  tones: [A2, E3, A3],
  arpeggiation: 'low-mid-high',
}

export const CHORD_V: Chord = {
  id: 'V',
  tones: [E2, E3, G_SHARP_3],
  arpeggiation: 'low-mid-high',
}

export const CHORDS: readonly Chord[] = [CHORD_I, CHORD_V]

// --- Audio synthesis ----------------------------------------------------

const HARMONIC_COUNT = 6
const RING_DURATION_S = 1.5
const PLUCK_GAIN = 0.18

function playTone(audio: AudioGraph, fundamental: Pitch, when: number, gain: number): void {
  const { ctx, filter } = audio
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(PLUCK_GAIN * gain, when + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, when + RING_DURATION_S)
  env.connect(filter)

  const partials = harmonicSeries(fundamental, HARMONIC_COUNT, defaultAmp)
  for (const h of partials) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = h.freq
    const g = ctx.createGain()
    g.gain.value = h.amp
    o.connect(g).connect(env)
    o.start(when)
    o.stop(when + RING_DURATION_S + 0.05)
  }

  // env.disconnect() after the ring finishes — schedule on wall clock,
  // since `when` is in audio-context time.
  const releaseInS = Math.max(0, when - ctx.currentTime) + RING_DURATION_S + 0.2
  window.setTimeout(() => {
    try {
      env.disconnect()
    } catch {
      // already disconnected
    }
  }, releaseInS * 1000)
}

export type PlayChordOpts = {
  // Audio-context time to start the chord. Defaults to ctx.currentTime.
  when?: number
  // Seconds between successive tones for `low-mid-high` arpeggiation.
  staggerS?: number
}

export function playChord(audio: AudioGraph, chord: Chord, opts?: PlayChordOpts): void {
  const t0 = opts?.when ?? audio.ctx.currentTime
  const stagger = opts?.staggerS ?? 0.4
  const gain = chord.gain ?? 1

  if (chord.arpeggiation === 'block') {
    for (const tone of chord.tones) playTone(audio, tone, t0, gain)
    return
  }

  for (let i = 0; i < chord.tones.length; i++) {
    playTone(audio, chord.tones[i], t0 + i * stagger, gain)
  }
}
