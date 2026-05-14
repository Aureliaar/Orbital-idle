export type BodyId = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

export type Body = {
  id: BodyId
  name: string
  note: string
  romanNumeral: string
  intervalLabel: string
  // Semitones above C. Defines both the body's pitch class and its
  // 12-TET period ratio (ratio = 2^(semitones/12)).
  semitones: number
  // Period as a multiple of Earth's. 12-TET equivalent — irrational, not
  // the small-integer ratios of just intonation.
  ratio: number
  // Starting phase in [0, 1). Distributed via golden-ratio steps so no
  // two bodies start at the same angle and the wheel looks alive on first
  // load.
  phase: number
}

export const EARTH_PERIOD_S = 8

// Reference C: C3 = 130.81 Hz. Anchor for pitch-class snapping and the
// per-station tonic (`C_REF_HZ * body.ratio`).
export const C_REF_HZ = 261.63 / 2

const DEFS: ReadonlyArray<{
  id: BodyId
  name: string
  note: string
  romanNumeral: string
  intervalLabel: string
  semitones: number
  phase: number
}> = [
  { id: 'C', name: 'Earth',       note: 'C', romanNumeral: 'I',   intervalLabel: 'tonic', semitones: 0,  phase: 0       },
  { id: 'D', name: 'Supertonic',  note: 'D', romanNumeral: 'ii',  intervalLabel: 'M2',    semitones: 2,  phase: 0.6180  },
  { id: 'E', name: 'Mediant',     note: 'E', romanNumeral: 'iii', intervalLabel: 'M3',    semitones: 4,  phase: 0.2361  },
  { id: 'F', name: 'Subdominant', note: 'F', romanNumeral: 'IV',  intervalLabel: 'P4',    semitones: 5,  phase: 0.8541  },
  { id: 'G', name: 'Dominant',    note: 'G', romanNumeral: 'V',   intervalLabel: 'P5',    semitones: 7,  phase: 0.4721  },
  { id: 'A', name: 'Submediant',  note: 'A', romanNumeral: 'vi',  intervalLabel: 'M6',    semitones: 9,  phase: 0.0902  },
  { id: 'B', name: 'Leading',     note: 'B', romanNumeral: 'vii', intervalLabel: 'M7',    semitones: 11, phase: 0.7082  },
]

export const BODIES: Body[] = DEFS.map((d) => ({
  ...d,
  ratio: 2 ** (d.semitones / 12),
}))

export const EARTH = BODIES[0]
export const TARGETS = BODIES.slice(1)

export const periodOf = (b: Body) => b.ratio * EARTH_PERIOD_S

// --- Pitch-class universe ---------------------------------------------

const DIATONIC_SEMI_TO_ID: Record<number, BodyId> = {
  0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B',
}

// Snap an absolute frequency to its nearest 12-TET semitone class. Returns
// the BodyId iff that class is diatonic (in C-major); null for off-key
// (C♯, D♯, F♯, G♯, A♯).
export function pitchClassOf(hz: number, refHz: number = C_REF_HZ): BodyId | null {
  if (hz <= 0) return null
  const semis = Math.log2(hz / refHz) * 12
  const rounded = Math.round(semis)
  const pc = ((rounded % 12) + 12) % 12
  return DIATONIC_SEMI_TO_ID[pc] ?? null
}

// Pitch classes for the first `count` partials of a body's tonic. nulls
// mark off-scale partials. Length = count.
export function partialPitchClasses(
  body: Body,
  count: number,
  refHz: number = C_REF_HZ,
): (BodyId | null)[] {
  const tonicHz = refHz * body.ratio
  const out: (BodyId | null)[] = []
  for (let n = 1; n <= count; n++) {
    out.push(pitchClassOf(tonicHz * n, refHz))
  }
  return out
}

// Distinct in-key pitch classes a planet's resonator can mint via its
// first `count` partials. Order preserved from the harmonic series, so
// the tonic comes first (it's partial 1).
export function inKeyPartialSet(
  body: Body,
  count: number,
  refHz: number = C_REF_HZ,
): BodyId[] {
  const seen = new Set<BodyId>()
  const out: BodyId[] = []
  for (const pc of partialPitchClasses(body, count, refHz)) {
    if (pc && !seen.has(pc)) {
      seen.add(pc)
      out.push(pc)
    }
  }
  return out
}

// --- Interval labels --------------------------------------------------

const INTERVAL_NAMES = [
  'P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7',
] as const

// Nearest 12-TET interval label for a period-ratio. Used in slot pickers,
// upgrade panel header — wherever we want a one-glance interval read.
export const ratioLabel = (r: number): string => {
  const semis = Math.round(Math.log2(r) * 12)
  const pc = ((semis % 12) + 12) % 12
  return INTERVAL_NAMES[pc]
}

export const intervalBetween = (from: Body, to: Body): string =>
  INTERVAL_NAMES[((to.semitones - from.semitones) % 12 + 12) % 12]

// --- Per-route window tolerance ---------------------------------------
//
// Window-rarity is the only orbit-layer friction. Under 12-TET, raw
// synodic math gives weird results (M2 routes get rarer windows than the
// tritone) because closeness-of-period and consonance aren't the same
// thing. We restore the DESIGN.md intuition by widening proximity
// tolerance for routes whose nearest small-denominator just approximation
// has a small denominator: 3:2 routes arm easily, 45:32-ish routes need
// very tight alignment.
const SEMITONE_DENOMINATOR: Record<number, number> = {
  0: 1,    // P1
  1: 16,   // m2 ≈ 16:15
  2: 9,    // M2 ≈ 9:8
  3: 6,    // m3 ≈ 6:5
  4: 5,    // M3 ≈ 5:4
  5: 4,    // P4 ≈ 4:3
  6: 32,   // TT ≈ 45:32
  7: 2,    // P5 ≈ 3:2
  8: 8,    // m6 ≈ 8:5
  9: 3,    // M6 ≈ 5:3
  10: 16,  // m7 ≈ 16:9
  11: 8,   // M7 ≈ 15:8
}

// Multiplier applied to the base window tolerance. >1 widens, <1 narrows.
// Anchored so P5 ≈ 1.9×, M3/P4 ≈ 1.2×, M2/m7 ≈ 0.8×, TT ≈ 0.6×.
export function routeToleranceMul(from: Body, to: Body): number {
  const d = ((to.semitones - from.semitones) % 12 + 12) % 12
  const denom = SEMITONE_DENOMINATOR[d] ?? 16
  return Math.max(0.5, 3 / Math.log2(denom + 1))
}
