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

// Up to four assignable slots — start with two and unlock the rest. Each
// can hold any unlocked note; the same note can't be in two slots (the
// picker enforces it). Cooldown is keyed by slot index, not by note.
export const INITIAL_SLOT_COUNT = 2
export const MAX_SLOT_COUNT = 4

// Auto-pluck is per-slot and carries a yield penalty: an auto-fired tap
// pays this fraction of what a real tap would. Manual play stays the
// optimal play, auto-pluck is the convenient one.
export const AUTO_PLUCK_PENALTY = 0.5

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
//
// Only slots whose index is in `autoSlots` contribute — manual-only slots
// don't auto-fire, so they generate no idle income. Pair Resonance is only
// counted when BOTH slots in the pair are auto-plucked (otherwise the
// coincidence would require a manual tap that off-tab idle never sees).
// Both Tone and Resonance are scaled by AUTO_PLUCK_PENALTY since every
// tick is an auto-fired tap.
export function computeIdleRate(
  slots: ReadonlyArray<BodyId | null>,
  autoSlots: ReadonlySet<number>,
): { tonePerSec: number; resonancePerSec: number } {
  let autoFilled = 0
  for (let i = 0; i < slots.length; i++) {
    if (autoSlots.has(i) && slots[i]) autoFilled++
  }
  const tonePerSec = (autoFilled * TONE_PER_TAP * AUTO_PLUCK_PENALTY) / RING_DURATION_S

  let resonancePerSec = 0
  for (let i = 0; i < slots.length; i++) {
    if (!autoSlots.has(i)) continue
    const a = slots[i]
    if (!a) continue
    for (let j = i + 1; j < slots.length; j++) {
      if (!autoSlots.has(j)) continue
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
      }) * AUTO_PLUCK_PENALTY
    }
  }
  return { tonePerSec, resonancePerSec }
}
