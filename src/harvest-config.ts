// Shared constants + analytic idle-rate helper for the Resonator stage.
// Lives outside HarvestStage.tsx so the component file only exports its
// component (react-refresh requirement) and so App.tsx can read the same
// numbers the on-tab auto-pluck path uses.

import { BODIES } from './bodies'
import type { BodyId } from './bodies'
import {
  defaultAmp,
  harmonicSeries,
  idlePairFreqCountsPerSec,
} from './harmonics'

// Tonic frequency: C3 (130.81 Hz). Matches the orbital stage's EARTH_HZ so
// the harvest pluck synth stays in tune with the orbital drone.
export const TONIC_HZ = 261.63 / 2

// H6 reaches M3 (5:4) and M6 (5:3); M2 (9:8 → H≥9) and M7 (15:8 → H≥15)
// remain unreachable.
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
// pays this fraction of what a real tap would.
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
// every COINCIDENCE FREQUENCY has its own currency (you mint exactly one
// unit when two notes' partials align at that frequency, regardless of
// which two partials happened to coincide there).
//
// In the diatonic at H≤6 there are 9 reachable coincidence frequencies,
// listed below in ascending order. Each frequency is `num/den · tonic`.
// Two pairs can share a frequency (e.g. F5 is reached by C×E, C×A, and
// E×A) — they all mint the same currency.

export type NoteCurrency = BodyId

export const FREQ_CURRENCIES = [
  { key: 'F3', num: 3, den: 1, label: '3' },
  { key: 'F15_4', num: 15, den: 4, label: '15/4' },
  { key: 'F4', num: 4, den: 1, label: '4' },
  { key: 'F9_2', num: 9, den: 2, label: '9/2' },
  { key: 'F5', num: 5, den: 1, label: '5' },
  { key: 'F45_8', num: 45, den: 8, label: '45/8' },
  { key: 'F6', num: 6, den: 1, label: '6' },
  { key: 'F20_3', num: 20, den: 3, label: '20/3' },
  { key: 'F15_2', num: 15, den: 2, label: '15/2' },
] as const

export type FreqCurrency = (typeof FREQ_CURRENCIES)[number]['key']

export const FREQ_CURRENCY_KEYS: readonly FreqCurrency[] = FREQ_CURRENCIES.map(
  (e) => e.key,
)

export type CurrencyKey = NoteCurrency | FreqCurrency

export const NOTE_CURRENCIES: readonly NoteCurrency[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

export type CurrencyPurse = Partial<Record<CurrencyKey, number>>

// Each coincidence frequency in the diatonic can be reached by one or
// more interval classes. We store the canonical interval label keyed by
// freq currency so bursts can name the consonance the player just heard.
export const FREQ_INTERVAL_LABEL: Record<FreqCurrency, string> = {
  F3: 'P5',
  F15_4: 'P5',
  F4: 'P4',
  F9_2: 'P4',
  F5: 'M3',
  F45_8: 'M6',
  F6: 'P5',
  F20_3: 'M3',
  F15_2: 'm3',
}

// Cool→warm gradient by ascending frequency so the chip row reads as a
// spectrum.
export const FREQ_COLORS: Record<FreqCurrency, string> = {
  F3: '#5a6cf0',
  F15_4: '#5a8af0',
  F4: '#3aa9c8',
  F9_2: '#3aaaa6',
  F5: '#3ab07a',
  F45_8: '#7eb868',
  F6: '#c9a83a',
  F20_3: '#dd8a36',
  F15_2: '#dc4836',
}

// For each coincidence frequency, the set of notes whose harmonic series
// reach that frequency — i.e. the notes that can collaborate to mint it.
// Computed once at module load by enumerating every diatonic pair's
// partials up to HARMONIC_COUNT and bucketing by the FreqCurrency each
// landing maps to. Used by the UI to show, on every freq chip, which
// notes the player needs in play to earn more of it.
export const FREQ_SOURCES: Record<FreqCurrency, readonly BodyId[]> = (() => {
  const order: Record<BodyId, number> = {} as Record<BodyId, number>
  NOTE_CURRENCIES.forEach((id, idx) => {
    order[id] = idx
  })
  const acc: Partial<Record<FreqCurrency, Set<BodyId>>> = {}
  for (let i = 0; i < BODIES.length; i++) {
    for (let j = i + 1; j < BODIES.length; j++) {
      const a = BODIES[i]
      const b = BODIES[j]
      for (let n = 1; n <= HARMONIC_COUNT; n++) {
        for (let m = 1; m <= HARMONIC_COUNT; m++) {
          const f1 = a.ratio * n
          const f2 = b.ratio * m
          if (Math.abs(f1 - f2) / Math.max(f1, f2) > COINCIDENCE_TOL) continue
          const key = freqToCurrency(f1 * TONIC_HZ, TONIC_HZ)
          if (!key) continue
          let s = acc[key]
          if (!s) {
            s = new Set<BodyId>()
            acc[key] = s
          }
          s.add(a.id)
          s.add(b.id)
        }
      }
    }
  }
  const out: Partial<Record<FreqCurrency, readonly BodyId[]>> = {}
  for (const { key } of FREQ_CURRENCIES) {
    const set = acc[key] ?? new Set<BodyId>()
    out[key] = [...set].sort((a, b) => order[a] - order[b])
  }
  return out as Record<FreqCurrency, readonly BodyId[]>
})()

// Convert a coincidence frequency (Hz) to the matching FreqCurrency key,
// or null if the freq doesn't match any known coincidence (shouldn't
// happen for diatonic input but defensively handled).
export function freqToCurrency(hz: number, tonicHz: number): FreqCurrency | null {
  const r = hz / tonicHz
  for (const entry of FREQ_CURRENCIES) {
    const target = entry.num / entry.den
    if (Math.abs(r - target) / target <= COINCIDENCE_TOL) return entry.key
  }
  return null
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

// Analytic idle rate. Mirrors the on-tap path: each note-fire mints its
// note currency, and each coincident partial-pair mints exactly one unit
// of the FreqCurrency for the frequency where the partials lined up.
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

  for (const n of autoNotes) {
    const perSec = (1 * yieldMul(n) * AUTO_PLUCK_PENALTY) / RING_DURATION_S
    out[n] = (out[n] ?? 0) + perSec
  }

  for (let i = 0; i < autoNotes.length; i++) {
    for (let j = i + 1; j < autoNotes.length; j++) {
      const ba = BODIES.find((x) => x.id === autoNotes[i])
      const bb = BODIES.find((x) => x.id === autoNotes[j])
      if (!ba || !bb) continue
      const sa = harmonicSeries(TONIC_HZ * ba.ratio, HARMONIC_COUNT, defaultAmp)
      const sb = harmonicSeries(TONIC_HZ * bb.ratio, HARMONIC_COUNT, defaultAmp)
      const counts = idlePairFreqCountsPerSec(sa, sb, {
        cadenceS: RING_DURATION_S,
        tolFrac: COINCIDENCE_TOL,
        keyForFreq: (hz) => freqToCurrency(hz, TONIC_HZ),
      })
      for (const [key, perSec] of Object.entries(counts)) {
        const k = key as FreqCurrency
        out[k] = (out[k] ?? 0) + perSec * AUTO_PLUCK_PENALTY
      }
    }
  }
  return out
}
