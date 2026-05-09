export type BodyId = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

export type Body = {
  id: BodyId
  name: string
  note: string
  romanNumeral: string
  intervalLabel: string
  // Period as a multiple of Earth's. Higher ratio = slower / outer body.
  ratio: number
}

export const EARTH_PERIOD_S = 8

export const BODIES: Body[] = [
  { id: 'C', name: 'Earth',       note: 'C', romanNumeral: 'I',   intervalLabel: 'tonic', ratio: 1     },
  { id: 'D', name: 'Supertonic',  note: 'D', romanNumeral: 'ii',  intervalLabel: 'M2',    ratio: 9 / 8 },
  { id: 'E', name: 'Mediant',     note: 'E', romanNumeral: 'iii', intervalLabel: 'M3',    ratio: 5 / 4 },
  { id: 'F', name: 'Subdominant', note: 'F', romanNumeral: 'IV',  intervalLabel: 'P4',    ratio: 4 / 3 },
  { id: 'G', name: 'Dominant',    note: 'G', romanNumeral: 'V',   intervalLabel: 'P5',    ratio: 3 / 2 },
  { id: 'A', name: 'Submediant',  note: 'A', romanNumeral: 'vi',  intervalLabel: 'M6',    ratio: 5 / 3 },
  { id: 'B', name: 'Leading',     note: 'B', romanNumeral: 'vii', intervalLabel: 'M7',    ratio: 15 / 8 },
]

export const EARTH = BODIES[0]
export const TARGETS = BODIES.slice(1)

export const periodOf = (b: Body) => b.ratio * EARTH_PERIOD_S

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
