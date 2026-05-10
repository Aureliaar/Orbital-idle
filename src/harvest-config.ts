// Shared constants + analytic idle-rate helper for the Resonator stage.
// Lives outside HarvestStage.tsx so the component file only exports its
// component (react-refresh requirement) and so App.tsx can read the same
// numbers the on-tab auto-pluck path uses.

import { BODIES } from './bodies'
import type { BodyId } from './bodies'
import {
  defaultAmp,
  harmonicSeries,
  idlePairResonancePerSec,
} from './harmonics'

// Tonic frequency: C3 (130.81 Hz). Matches the orbital stage's EARTH_HZ so
// the harvest pluck synth stays in tune with the orbital drone.
export const TONIC_HZ = 261.63 / 2

// Bumped to H6 (was H4) so M3 (5:4) and M6 (5:3) become reachable
// coincidences — E (M3) is the first purchasable note on the unlock ladder,
// so its first coincidence with C must exist at H≤6 (C·H5 = E·H4). Still
// out of reach at H≤6: M2 (9:8 → H≥9), M7 (15:8 → H≥15).
export const HARMONIC_COUNT = 6

// Single source of truth for "how long does a tap ring?" — visual partials
// fade linearly to zero over this window, the pluck synth's envelope ends
// at the same instant, and a slot stays on cooldown for the same duration.
export const RING_DURATION_S = 1.5
export const RING_DURATION_MS = RING_DURATION_S * 1000

// Coincidence detection tolerance — 0.5% ≈ 8.6 cents.
export const COINCIDENCE_TOL = 0.005

// Tuned so a perfect-fifth coincidence at H≤6 (C·H3 + C·H6 against G·H2 + G·H4,
// bonus sum ≈ 0.208) tapped near the start of the ring pays ~5 Resonance.
// Was 32 at HARMONIC_COUNT=4 where the fifth had a single coincidence (0.167).
export const RESONANCE_GAIN = 28
export const TONE_PER_TAP = 1

// Two assignable slots for v1. Each can hold any unlocked note; the same
// note can't be in both slots (the picker enforces it). Cooldown is keyed
// by slot index, not by note.
export const SLOT_COUNT = 2

// Diatonic-color mapping (Newton / Boomwhacker tradition).
export const PAD_COLORS: Record<string, string> = {
  C: '#dc4836', // red
  D: '#dd8a36', // orange
  E: '#c9a83a', // gold
  F: '#4aa84a', // green
  G: '#3a9fb8', // teal
  A: '#3a6dc8', // blue
  B: '#9a3ac8', // violet
}

// Analytic idle rate for a given slot assignment. The on-tab path credits
// the same numbers via real auto-plucks; this function exists so off-tab
// accrual matches without running React/canvas.
export function computeIdleRate(slots: ReadonlyArray<BodyId | null>): {
  tonePerSec: number
  resonancePerSec: number
} {
  let filled = 0
  for (const s of slots) if (s) filled++
  const tonePerSec = (filled * TONE_PER_TAP) / RING_DURATION_S

  let resonancePerSec = 0
  // For SLOT_COUNT=2 there's at most one pair. The general form sums over
  // every unordered pair of filled slots — extend here when slot count grows.
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i]
    if (!a) continue
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j]
      if (!b) continue
      const ba = BODIES.find((x) => x.id === a)
      const bb = BODIES.find((x) => x.id === b)
      if (!ba || !bb) continue
      const sa = harmonicSeries(TONIC_HZ * ba.ratio, HARMONIC_COUNT, defaultAmp)
      const sb = harmonicSeries(TONIC_HZ * bb.ratio, HARMONIC_COUNT, defaultAmp)
      resonancePerSec += idlePairResonancePerSec(sa, sb, {
        cadenceS: RING_DURATION_S,
        gain: RESONANCE_GAIN,
        tolFrac: COINCIDENCE_TOL,
      })
    }
  }
  return { tonePerSec, resonancePerSec }
}
