// Catalogue for "The Show" — stations, recipes, research nodes, and
// the colour map every coin lives by. The numbers (cycle lengths,
// quantities, unlocked flags) come straight from production.jsx and
// production-research.jsx in the handoff bundle — keep them in sync
// with the canvas.

export type Note = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export type Coin = Note | 'ƒ3' | 'ƒ5' | '∮' | '✎'

export type Recipe = {
  id: string
  in: Array<{ note: Coin; qty: number }>
  out: { note: Coin; qty: number }
  unlocked: boolean
  // Per-recipe cycle length in seconds. Falls back to the station's cycle
  // when absent. The Pit's dig/press recipes set this so a single station
  // can run a generator and a refiner side-by-side at different cadences.
  cycle?: number
  hint?: string
}

export type Kind = 'extract' | 'refine' | 'research' | 'pit'

export type Station = {
  id: string
  kind: Kind
  name: string
  verb: string
  blurb: string
  inputs: Array<{ note: Coin; qty: number }>
  output: { note: Coin; qty: number }
  cycle: number
  focus?: 'general' | 'wheel' | 'pit'
}

// Diatonic colours — Newton spectrum. PAD here matches the Observatory
// palette already in src/index.css.
export const PAD: Record<Note, string> = {
  C: '#dc4836',
  D: '#dd8a36',
  E: '#c9a83a',
  F: '#4aa84a',
  G: '#3a9fb8',
  A: '#3a6dc8',
  B: '#9a3ac8',
}

export const FREQ_COLOR = {
  ƒ3: '#5a6cf0',
  ƒ5: '#3ab07a',
} as const

export const COIN_COLOR: Record<Coin, string> = {
  C: PAD.C,
  D: PAD.D,
  E: PAD.E,
  F: PAD.F,
  G: PAD.G,
  A: PAD.A,
  B: PAD.B,
  'ƒ3': FREQ_COLOR.ƒ3,
  'ƒ5': FREQ_COLOR.ƒ5,
  '∮': '#7a5a1a',
  '✎': '#3d2c1a',
}

export const KIND_META: Record<Kind, { glyph: string; label: string; color: string; hint: string }> = {
  extract: { glyph: '◇', label: 'extract', color: '#2e6a4a', hint: 'tap to draw a note from the æther' },
  refine: { glyph: '△', label: 'refine', color: '#8c2a12', hint: 'auto-feeds inputs · output every cycle' },
  research: { glyph: '✎', label: 'research', color: '#3d2c1a', hint: 'long cycles · output advances the tree' },
  pit: { glyph: '◈', label: 'pit', color: '#6b3d2a', hint: 'mixed bench — dig & press in the same station' },
}

export const STATIONS: Record<string, Station> = {
  diapason: {
    id: 'diapason', kind: 'extract', name: 'Crystal Diapason', verb: 'mints',
    blurb: 'A struck crystal that holds its overtones. Light taps draw E from the partials.',
    inputs: [], output: { note: 'E', qty: 1 }, cycle: 7,
  },
  aeolianharp: {
    id: 'aeolianharp', kind: 'extract', name: 'Aeolian Harp', verb: 'gathers',
    blurb: 'Strings hung in the wind. Each gust draws an A into the casket.',
    inputs: [], output: { note: 'A', qty: 1 }, cycle: 10,
  },
  cistern: {
    id: 'cistern', kind: 'pit', name: 'Salt Cistern', verb: 'works',
    blurb: 'A brine pit and a press in one. Each slot either digs raw tonic or presses tonic into applause.',
    inputs: [], output: { note: '∮', qty: 1 }, cycle: 2,
  },
  bell: {
    id: 'bell', kind: 'extract', name: 'Carillon Bell', verb: 'rings',
    blurb: 'A bell tower that sustains the leading tone unattended.',
    inputs: [], output: { note: 'B', qty: 1 }, cycle: 18,
  },
  bellows: {
    id: 'bellows', kind: 'refine', name: 'Bellows-Pipe', verb: 'distills',
    blurb: 'Forces a tonic through a pipe organ until a fifth condenses out the far end.',
    inputs: [{ note: 'C', qty: 2 }], output: { note: 'G', qty: 1 }, cycle: 6,
  },
  retort: {
    id: 'retort', kind: 'refine', name: 'Resonance Retort', verb: 'resonates',
    blurb: 'Two tones held in a glass chamber. When they sing in tune, they fuse into applause.',
    inputs: [{ note: 'C', qty: 1 }, { note: 'E', qty: 1 }], output: { note: '∮', qty: 1 }, cycle: 9,
  },
  vise: {
    id: 'vise', kind: 'refine', name: 'Tempering Vise', verb: 'tempers',
    blurb: 'Holds a dominant in a clamp & hammers the harmonics free of their fundamental.',
    inputs: [{ note: 'G', qty: 3 }], output: { note: 'ƒ3', qty: 1 }, cycle: 12,
  },
  scriptorium: {
    id: 'scriptorium', kind: 'research', name: 'Scriptorium', verb: 'inscribes',
    blurb: 'A copyist desk. Spends the longing of the leading tone to fill the writ-roll.',
    inputs: [{ note: 'B', qty: 1 }], output: { note: '✎', qty: 1 }, cycle: 20, focus: 'general',
  },
  camera: {
    id: 'camera', kind: 'research', name: 'Camera Obscura', verb: 'observes',
    blurb: 'Projects the wheel onto vellum. Trades a partial for insight into the orbits.',
    inputs: [{ note: 'ƒ5', qty: 1 }], output: { note: '✎', qty: 1 }, cycle: 16, focus: 'wheel',
  },
  lectern: {
    id: 'lectern', kind: 'research', name: 'Lectern', verb: 'studies',
    blurb: 'Reads back the score of the past act. Each ∮ spent yields lessons for the pit.',
    inputs: [{ note: '∮', qty: 1 }], output: { note: '✎', qty: 2 }, cycle: 24, focus: 'pit',
  },
}

export const STATION_CAPACITY: Record<string, number> = {
  bellows: 3, retort: 3, vise: 3, cistern: 3, diapason: 3,
  aeolianharp: 3, bell: 3, scriptorium: 3, camera: 3, lectern: 3,
}
export const STATION_MAX_CAPACITY: Record<string, number> = {
  bellows: 6, retort: 6, vise: 6, cistern: 6, diapason: 6,
  aeolianharp: 6, bell: 6, scriptorium: 6, camera: 6, lectern: 6,
}

export const STATION_RECIPES: Record<string, Recipe[]> = {
  bellows: [
    { id: 'fifth', in: [{ note: 'C', qty: 2 }], out: { note: 'G', qty: 1 }, unlocked: true, hint: 'the dominant' },
    { id: 'fourth', in: [{ note: 'C', qty: 3 }], out: { note: 'F', qty: 1 }, unlocked: true, hint: 'subdominant' },
    { id: 'octave', in: [{ note: 'C', qty: 4 }], out: { note: 'C', qty: 2 }, unlocked: true, hint: 'fold the tonic' },
    { id: 'leaning', in: [{ note: 'C', qty: 1 }, { note: 'G', qty: 1 }], out: { note: '∮', qty: 1 }, unlocked: false, hint: 'direct applause' },
    { id: 'second', in: [{ note: 'C', qty: 4 }], out: { note: 'D', qty: 1 }, unlocked: false, hint: 'a strained tone' },
    { id: 'bellow', in: [{ note: 'G', qty: 2 }], out: { note: 'D', qty: 1 }, unlocked: false, hint: 'sustained' },
  ],
  retort: [
    { id: 'major', in: [{ note: 'C', qty: 1 }, { note: 'E', qty: 1 }, { note: 'G', qty: 1 }], out: { note: '∮', qty: 2 }, unlocked: true, hint: 'major triad' },
    { id: 'minor', in: [{ note: 'C', qty: 1 }, { note: 'ƒ3', qty: 1 }], out: { note: '∮', qty: 1 }, unlocked: true, hint: 'minor third' },
    { id: 'cascade', in: [{ note: 'E', qty: 1 }, { note: 'G', qty: 1 }], out: { note: '∮', qty: 2 }, unlocked: true, hint: 'pays double' },
    { id: 'lament', in: [{ note: 'A', qty: 1 }, { note: 'ƒ3', qty: 1 }], out: { note: '∮', qty: 2 }, unlocked: false, hint: 'minor sixth' },
    { id: 'cadence', in: [{ note: 'G', qty: 1 }, { note: 'B', qty: 1 }, { note: 'C', qty: 1 }], out: { note: '∮', qty: 4 }, unlocked: false, hint: 'V → I — huge' },
    { id: 'diminish', in: [{ note: 'B', qty: 1 }, { note: 'ƒ5', qty: 1 }], out: { note: '∮', qty: 2 }, unlocked: false, hint: 'dissonant, lucrative' },
  ],
  vise: [
    { id: 'temper-g', in: [{ note: 'G', qty: 3 }], out: { note: 'ƒ3', qty: 1 }, unlocked: true, hint: 'temper the dominant' },
    { id: 'temper-a', in: [{ note: 'A', qty: 3 }], out: { note: 'ƒ5', qty: 1 }, unlocked: true, hint: 'temper the sixth' },
    { id: 'fold', in: [{ note: 'G', qty: 4 }], out: { note: 'G', qty: 2 }, unlocked: true, hint: 'fold dominant' },
    { id: 'forge', in: [{ note: 'C', qty: 2 }, { note: 'G', qty: 1 }], out: { note: '∮', qty: 1 }, unlocked: false, hint: 'fifth into applause' },
    { id: 'shave', in: [{ note: 'F', qty: 3 }], out: { note: 'ƒ3', qty: 1 }, unlocked: false, hint: 'shave the subdominant' },
    { id: 'meld', in: [{ note: 'ƒ3', qty: 2 }], out: { note: 'ƒ5', qty: 1 }, unlocked: false, hint: 'meld sparks' },
  ],
  cistern: [
    { id: 'dig', in: [], out: { note: 'C', qty: 1 }, unlocked: true, cycle: 4, hint: 'mint raw tonic' },
    { id: 'press', in: [{ note: 'C', qty: 1 }], out: { note: '∮', qty: 1 }, unlocked: true, cycle: 2, hint: 'tonic → applause' },
  ],
  diapason: [
    { id: 'strike', in: [], out: { note: 'E', qty: 1 }, unlocked: true, hint: 'fundamental' },
    { id: 'overtone', in: [], out: { note: 'ƒ5', qty: 1 }, unlocked: true, hint: 'fifth partial' },
    { id: 'doubled', in: [], out: { note: 'E', qty: 2 }, unlocked: false, hint: 'double strike' },
    { id: 'third-h', in: [], out: { note: 'B', qty: 1 }, unlocked: false, hint: 'third harmonic' },
    { id: 'spark', in: [], out: { note: 'ƒ3', qty: 1 }, unlocked: false, hint: 'thin spark' },
    { id: 'sing', in: [], out: { note: '∮', qty: 1 }, unlocked: false, hint: 'sings on its own' },
  ],
  aeolianharp: [
    { id: 'wind', in: [], out: { note: 'A', qty: 1 }, unlocked: true },
    { id: 'gust', in: [], out: { note: 'A', qty: 2 }, unlocked: true, hint: 'longer cycle' },
    { id: 'breeze', in: [], out: { note: 'D', qty: 1 }, unlocked: false, hint: 'cross-string' },
    { id: 'sigh', in: [], out: { note: 'F', qty: 1 }, unlocked: false },
    { id: 'storm', in: [], out: { note: 'A', qty: 3 }, unlocked: false, hint: 'a long gust' },
    { id: 'whistle', in: [], out: { note: 'E', qty: 1 }, unlocked: false },
  ],
  bell: [
    { id: 'leading', in: [], out: { note: 'B', qty: 1 }, unlocked: true },
    { id: 'peal', in: [], out: { note: 'B', qty: 2 }, unlocked: true, hint: 'doubled toll' },
    { id: 'minor-b', in: [], out: { note: 'ƒ3', qty: 1 }, unlocked: false, hint: 'overtone spark' },
    { id: 'dirge', in: [], out: { note: 'A', qty: 1 }, unlocked: false },
    { id: 'angelus', in: [], out: { note: 'E', qty: 1 }, unlocked: false },
    { id: 'tocsin', in: [], out: { note: '∮', qty: 1 }, unlocked: false, hint: 'rings for applause' },
  ],
  scriptorium: [
    { id: 'copy', in: [{ note: 'B', qty: 1 }], out: { note: '✎', qty: 1 }, unlocked: true, hint: 'plain writ' },
    { id: 'illuminate', in: [{ note: 'B', qty: 1 }, { note: '∮', qty: 1 }], out: { note: '✎', qty: 2 }, unlocked: true, hint: 'fancy writs' },
    { id: 'fair-copy', in: [{ note: 'A', qty: 1 }], out: { note: '✎', qty: 1 }, unlocked: false },
    { id: 'gloss', in: [{ note: 'ƒ5', qty: 1 }], out: { note: '✎', qty: 2 }, unlocked: false, hint: 'marginal commentary' },
    { id: 'index', in: [{ note: '✎', qty: 2 }], out: { note: '✎', qty: 3 }, unlocked: false, hint: 'recursive' },
    { id: 'colophon', in: [{ note: '∮', qty: 2 }], out: { note: '✎', qty: 4 }, unlocked: false, hint: 'late-game' },
  ],
  camera: [
    { id: 'observe', in: [{ note: 'ƒ5', qty: 1 }], out: { note: '✎', qty: 1 }, unlocked: true },
    { id: 'survey', in: [{ note: 'ƒ5', qty: 2 }], out: { note: '✎', qty: 2 }, unlocked: true },
    { id: 'plot', in: [{ note: 'ƒ3', qty: 1 }], out: { note: '✎', qty: 1 }, unlocked: false },
    { id: 'transit', in: [{ note: 'D', qty: 1 }, { note: 'A', qty: 1 }], out: { note: '✎', qty: 2 }, unlocked: false, hint: 'wheel branch' },
    { id: 'almanac', in: [{ note: 'ƒ3', qty: 2 }], out: { note: '✎', qty: 3 }, unlocked: false },
    { id: 'augury', in: [{ note: 'B', qty: 2 }], out: { note: '✎', qty: 3 }, unlocked: false },
  ],
  lectern: [
    { id: 'study', in: [{ note: '∮', qty: 1 }], out: { note: '✎', qty: 2 }, unlocked: true },
    { id: 'critique', in: [{ note: '∮', qty: 2 }], out: { note: '✎', qty: 5 }, unlocked: true },
    { id: 'recital', in: [{ note: '∮', qty: 1 }, { note: 'C', qty: 1 }], out: { note: '✎', qty: 3 }, unlocked: false },
    { id: 'thesis', in: [{ note: '✎', qty: 3 }], out: { note: '✎', qty: 5 }, unlocked: false, hint: 'compounds' },
    { id: 'rehearse', in: [{ note: '∮', qty: 3 }], out: { note: '✎', qty: 8 }, unlocked: false },
    { id: 'opus', in: [{ note: '∮', qty: 5 }], out: { note: '✎', qty: 15 }, unlocked: false, hint: 'capstone' },
  ],
}

export function recipeLabel(r: Recipe): string {
  const ins = r.in.length === 0 ? '∅' : r.in.map((it) => `${it.qty > 1 ? it.qty : ''}${it.note}`).join('+')
  const outQ = r.out.qty > 1 ? r.out.qty : ''
  return `${ins} → ${outQ}${r.out.note}`
}

// ── Research tree ────────────────────────────────────────────────────
// Verbatim from production-research.jsx — branch colours, edges,
// statuses (which serve as the read-only starting board for the sim).

export type NodeStatus = 'done' | 'active' | 'ready' | 'locked'
export type ResearchNode = {
  id: string
  tier: number
  col: number
  title: string
  cost: number
  status: NodeStatus
  progress?: number
  branch: 'core' | 'pit' | 'wheel'
  body?: string
}

export const RESEARCH_NODES: ResearchNode[] = [
  { id: 'tonic', tier: 0, col: 1, title: 'The Tonic', cost: 0, status: 'done', branch: 'core' },
  { id: 'fifth', tier: 1, col: 0, title: 'Just Fifths', cost: 4, status: 'done', branch: 'pit', body: 'Unlocks Bellows-Pipe — C → G distillation.' },
  { id: 'thirds', tier: 1, col: 1, title: 'Just Thirds', cost: 5, status: 'done', branch: 'pit', body: 'Unlocks Resonance Retort — C + E → ∮ applause.' },
  { id: 'attend', tier: 1, col: 2, title: 'Stagecraft', cost: 3, status: 'done', branch: 'wheel', body: 'A second pair of hands. Slows audience drain.' },
  { id: 'temper', tier: 2, col: 0, title: 'Temperament', cost: 6, status: 'active', progress: 0.62, branch: 'pit', body: 'Unlocks the Tempering Vise — temper G into ƒ3 sparks.' },
  { id: 'cistern', tier: 2, col: 1, title: 'Salt Cistern', cost: 7, status: 'ready', branch: 'pit', body: 'A passive extractor for the tonic note. Slow but free.' },
  { id: 'window', tier: 2, col: 2, title: 'Open Windows', cost: 8, status: 'ready', branch: 'wheel', body: 'Conjunctions stay open ⅓ longer. The shuttle gets cheaper.' },
  { id: 'fourth', tier: 3, col: 0, title: 'The Subdominant', cost: 12, status: 'locked', branch: 'pit', body: 'A fourth slot in the pit. Requires Temperament.' },
  { id: 'cadence', tier: 3, col: 1, title: 'Cadence Bonus', cost: 14, status: 'locked', branch: 'wheel', body: 'V → I shuttles pay double during cadence.' },
  { id: 'leading', tier: 3, col: 2, title: 'Leading Tone', cost: 16, status: 'locked', branch: 'pit', body: 'Unlocks the Carillon Bell — a self-sustaining B source.' },
  { id: 'modes', tier: 4, col: 1, title: 'Modal Shift', cost: 24, status: 'locked', branch: 'wheel', body: 'Rotate the wheel into a different key. New conjunctions.' },
]

export const RESEARCH_EDGES: Array<[string, string]> = [
  ['tonic', 'fifth'], ['tonic', 'thirds'], ['tonic', 'attend'],
  ['fifth', 'temper'], ['thirds', 'cistern'], ['attend', 'window'],
  ['temper', 'fourth'], ['temper', 'cadence'], ['cistern', 'leading'], ['window', 'cadence'],
  ['cadence', 'modes'], ['leading', 'modes'],
]

export const BRANCH_COLOR: Record<'core' | 'pit' | 'wheel', string> = {
  core: '#1a120a',
  pit: '#8c2a12',
  wheel: '#2e6a4a',
}

// Wheel — fixed positions C top, then clockwise.
export const WHEEL_PLANETS: Array<{ id: Note; stockMax: number }> = [
  { id: 'C', stockMax: 24 },
  { id: 'D', stockMax: 16 },
  { id: 'E', stockMax: 20 },
  { id: 'F', stockMax: 12 },
  { id: 'G', stockMax: 18 },
  { id: 'A', stockMax: 16 },
  { id: 'B', stockMax: 8 },
]

// ── Pit upgrades ─────────────────────────────────────────────────────
// Two tracks that pull the gen/ref balance in opposite directions:
//
//   Brine Pump:  each Dig mints +1 more C per fire. Stronger gens → fewer
//                gens needed → optimum drifts toward 1G+2R.
//   Pipework:    Press cycle halves per level (×0.5). Hungrier refiners →
//                more gens needed → optimum drifts toward 2G+1R.
//
// Stacking one without the other wastes ∮ in the raw-bound or ref-idle
// regime; the interesting decision is which to invest in first, and when
// to swap the slot mix to match.

export type UpgradeId = 'genYield' | 'refSpeed'

export const UPGRADES: Record<UpgradeId, {
  name: string
  blurb: string
  base: number
  scale: number
}> = {
  genYield: {
    name: 'Brine Pump',
    blurb: '+1 C per Dig fire.',
    base: 8,
    scale: 2,
  },
  refSpeed: {
    name: 'Pipework',
    blurb: 'Press cycle ×½.',
    base: 8,
    scale: 2,
  },
}

// Observatory palette also used by the show stages — kept in one place so
// every component can import from here instead of duplicating hexes.
export const obs = {
  bg: '#c9b487',
  bg2: '#b89e6a',
  paper: '#d6c293',
  ink: '#1a120a',
  ink2: '#3d2c1a',
  ink3: '#6b5536',
  rust: '#8c2a12',
  rustSoft: '#b54a25',
  gold: '#7a5a1a',
} as const
