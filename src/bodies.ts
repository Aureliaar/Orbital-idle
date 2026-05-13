// A Body (planet) owns identity and pitch ratio. Orbital period and phase
// live on a separate Orbit type below — the seam later stages use to add
// phrase orbits and chord-firing on top of the existing home orbits.

export type BodyId = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

export type Body = {
  id: BodyId
  name: string
  note: string
  romanNumeral: string
  intervalLabel: string
  // Frequency ratio relative to tonic. Doubles as the period ratio for
  // this planet's home orbit (audible pitch == home-orbit rate).
  ratio: number
}

export const EARTH_PERIOD_S = 8

export const BODIES: Body[] = [
  { id: 'C', name: 'Earth',       note: 'C', romanNumeral: 'I',   intervalLabel: 'tonic', ratio: 1      },
  { id: 'D', name: 'Supertonic',  note: 'D', romanNumeral: 'ii',  intervalLabel: 'M2',    ratio: 9 / 8  },
  { id: 'E', name: 'Mediant',     note: 'E', romanNumeral: 'iii', intervalLabel: 'M3',    ratio: 5 / 4  },
  { id: 'F', name: 'Subdominant', note: 'F', romanNumeral: 'IV',  intervalLabel: 'P4',    ratio: 4 / 3  },
  { id: 'G', name: 'Dominant',    note: 'G', romanNumeral: 'V',   intervalLabel: 'P5',    ratio: 3 / 2  },
  { id: 'A', name: 'Submediant',  note: 'A', romanNumeral: 'vi',  intervalLabel: 'M6',    ratio: 5 / 3  },
  { id: 'B', name: 'Leading',     note: 'B', romanNumeral: 'vii', intervalLabel: 'M7',    ratio: 15 / 8 },
]

export const EARTH = BODIES[0]
export const TARGETS = BODIES.slice(1)

export const periodOf = (b: Body) => b.ratio * EARTH_PERIOD_S

// --- Orbits ---------------------------------------------------------
//
// An Orbit owns time (period + phase) and references the planet whose
// voice it fires on phase-wrap. Each planet starts with one home orbit
// whose period equals its pitch ratio. Later stages add more orbits
// (phrase orbit, chord-firing orbits) without touching the home ones.

export type OrbitId = string

export type Orbit = {
  id: OrbitId
  planetId: BodyId
  period: number
  // Starting phase in [0, 1). Golden-ratio steps so no two home orbits
  // start aligned and the wheel looks alive on first load.
  phase: number
}

const HOME_ORBIT_PHASE: Record<BodyId, number> = {
  C: 0,
  D: 0.6180,
  E: 0.2361,
  F: 0.8541,
  G: 0.4721,
  A: 0.0902,
  B: 0.7082,
}

export const ORBITS: Orbit[] = BODIES.map((b) => ({
  id: `home-${b.id}`,
  planetId: b.id,
  period: b.ratio * EARTH_PERIOD_S,
  phase: HOME_ORBIT_PHASE[b.id],
}))

const RATIO_LABELS: Record<string, string> = {
  '1': '1:1',
  '1.125': '9:8',
  '1.25': '5:4',
  '1.3333333333333333': '4:3',
  '1.5': '3:2',
  '1.6666666666666667': '5:3',
  '1.875': '15:8',
}

export const ratioLabel = (r: number) => RATIO_LABELS[String(r)] ?? r.toFixed(3)
