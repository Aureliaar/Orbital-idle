// Shared constants + analytic idle-rate helper for the Resonator stage.
// Lives outside HarvestStage.tsx so the component file only exports its
// component (react-refresh requirement) and so App.tsx can read the same
// numbers the on-tab auto-pluck path uses.

import { BODIES } from './bodies'
import type { BodyId } from './bodies'
import {
  defaultAmp,
  harmonicSeries,
  idlePairHarmonicCountsPerSec,
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

// Up to three assignable slots — start with one and unlock the rest.
export const INITIAL_SLOT_COUNT = 1
export const MAX_SLOT_COUNT = 3
export const MAX_SLOT0_CAPACITY = 3

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

// --- Currencies ---------------------------------------------------------
//
// Every note has its own currency (you mint it by playing that note) and
// every harvestable partial number has its own currency (you mint it by
// landing a coincidence at that partial). H1 is omitted: at HARMONIC_COUNT=6
// no diatonic neighbor's integer partial lines up with the tonic fundamental,
// so it'd be unearnable.

export type NoteCurrency = BodyId
export type HarmonicCurrency = 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
export type CurrencyKey = NoteCurrency | HarmonicCurrency

export const NOTE_CURRENCIES: readonly NoteCurrency[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
export const HARMONIC_CURRENCIES: readonly HarmonicCurrency[] = ['H2', 'H3', 'H4', 'H5', 'H6']

export const MIN_HARMONIC_CURRENCY = 2
export const MAX_HARMONIC_CURRENCY = 6

export type CurrencyPurse = Partial<Record<CurrencyKey, number>>

export const HARMONIC_INTERVAL_LABEL: Record<number, string> = {
  2: 'octave',
  3: 'P5',
  4: 'P4',
  5: 'M3',
  6: 'm3',
}

// Color tint for harmonic chips — keyed off partial number so the UI can
// hint at the interval each currency represents.
export const HARMONIC_COLORS: Record<HarmonicCurrency, string> = {
  H2: '#7a6cf0',
  H3: '#6c9ff0',
  H4: '#3aaab1',
  H5: '#c97a3a',
  H6: '#b6539a',
}

export function emptyPurse(): CurrencyPurse {
  return {}
}

export function addToPurse(purse: CurrencyPurse, delta: CurrencyPurse): CurrencyPurse {
  const next: CurrencyPurse = { ...purse }
  for (const k of Object.keys(delta) as CurrencyKey[]) {
    next[k] = (next[k] ?? 0) + (delta[k] ?? 0)
  }
  return next
}

export function canAfford(purse: CurrencyPurse, cost: CurrencyPurse): boolean {
  for (const k of Object.keys(cost) as CurrencyKey[]) {
    if ((purse[k] ?? 0) < (cost[k] ?? 0)) return false
  }
  return true
}

export function subtractCost(purse: CurrencyPurse, cost: CurrencyPurse): CurrencyPurse {
  const next: CurrencyPurse = { ...purse }
  for (const k of Object.keys(cost) as CurrencyKey[]) {
    next[k] = (next[k] ?? 0) - (cost[k] ?? 0)
  }
  return next
}

// Analytic idle rate for a given slot assignment. The on-tab path credits
// the same numbers via real auto-plucks; this function exists so off-tab
// accrual matches without running React/canvas.
//
// Each note in an auto-plucked slot fires once per cadence:
//   - mints 1 unit of its own NoteCurrency per fire (scaled by yield and
//     by AUTO_PLUCK_PENALTY).
//   - pairs with every other auto-plucked note; each coincident partial
//     pair pays 1 unit of HK currency to BOTH sides of the pair, two events
//     per cadence (cross-pluck in each direction).
//
// Yield levels per note are passed in so the idle-rate ticker sees the same
// multipliers the on-tap path does.
export function computeIdleRate(
  slots: ReadonlyArray<ReadonlyArray<BodyId>>,
  autoSlots: ReadonlySet<number>,
  noteYieldLvls: Partial<Record<BodyId, number>> = {},
  yieldStep = 1.5,
): CurrencyPurse {
  const out: CurrencyPurse = {}
  const yieldMul = (id: BodyId) => yieldStep ** (noteYieldLvls[id] ?? 0)

  const autoNotes: BodyId[] = []
  for (let i = 0; i < slots.length; i++) {
    if (!autoSlots.has(i)) continue
    for (const n of slots[i]) autoNotes.push(n)
  }

  // Note currency: 1 fire per cadence per stacked note.
  for (const n of autoNotes) {
    const perSec = (1 * yieldMul(n) * AUTO_PLUCK_PENALTY) / RING_DURATION_S
    out[n] = (out[n] ?? 0) + perSec
  }

  // Harmonic currency: every unordered pair contributes per-partial counts.
  for (let i = 0; i < autoNotes.length; i++) {
    for (let j = i + 1; j < autoNotes.length; j++) {
      const ba = BODIES.find((x) => x.id === autoNotes[i])
      const bb = BODIES.find((x) => x.id === autoNotes[j])
      if (!ba || !bb) continue
      const sa = harmonicSeries(TONIC_HZ * ba.ratio, HARMONIC_COUNT, defaultAmp)
      const sb = harmonicSeries(TONIC_HZ * bb.ratio, HARMONIC_COUNT, defaultAmp)
      const counts = idlePairHarmonicCountsPerSec(sa, sb, {
        cadenceS: RING_DURATION_S,
        tolFrac: COINCIDENCE_TOL,
        minPartial: MIN_HARMONIC_CURRENCY,
        maxPartial: MAX_HARMONIC_CURRENCY,
      })
      for (const [pStr, perSec] of Object.entries(counts)) {
        const key = `H${pStr}` as HarmonicCurrency
        out[key] = (out[key] ?? 0) + perSec * AUTO_PLUCK_PENALTY
      }
    }
  }
  return out
}
