// Game state for "The Show" — read-only sim layer.
//
// Per the handoff spec, time is measured in beats and bars:
//   beat = 250 ms (4 Hz)   ·   bar = 4 beats = 1 s real time
//   Act  = 128 bars
//
// This module owns the shape, the initial state, and a pure `tick(state,
// dtBeats)` that advances it. The App wires a single requestAnimationFrame
// accumulator to call `tick` whenever the beat count rolls over. Nothing
// in here is interactive yet — heat and attention decay, slot cycles roll
// over, planet stocks drift toward their medians, and conjunction windows
// open and close on a deterministic schedule.

import {
  STATIONS,
  STATION_CAPACITY,
  STATION_RECIPES,
  WHEEL_PLANETS,
  type Coin,
  type Note,
} from './data'

export const BEAT_MS = 250
export const BARS_PER_ACT = 128

export type Condition = 'warm' | 'tepid' | 'cold'

export type SlotState = 'active' | 'idle' | 'starved' | 'empty' | 'locked'
export type Slot = { state: SlotState; recipeId?: string }

export type StationState = {
  id: string
  slots: Slot[]
  capacity: number
  heat: number      // [0, 1]
  cycle: number     // [0, 1) — fraction of one cycle
  auto: boolean
  alarm: boolean
}

export type PlanetState = {
  id: Note
  stock: number
  stockMax: number
}

export type Conjunction = {
  pair: [Note, Note]
  ratio: string
  // bars-from-now when this window opens; once open, `open` and the
  // closes-in-bars counter advance.
  inBars: number
  durationBars: number
  open: boolean
}

export type ShowState = {
  // global clock
  act: string
  scene: string
  bar: number
  beat: number     // within-bar (0..3)
  attention: number
  // stages
  stations: StationState[]
  planets: PlanetState[]
  conjunctions: Conjunction[]
  // research — currently a static board the simulation only nudges
  // by ticking the active inquiry's progress.
  activeInquiryProgress: number
  writs: number
  // purse, displayed in the Pit's strip and consumed by station recipes
  purse: Partial<Record<Coin, number>>
}

// ── Tuning constants (handoff spec) ─────────────────────────────────
export const HEAT_DRAIN_PER_BEAT = 0.005   // 0.5%/beat while not firing
export const ATTENTION_DRAIN_PER_BEAT = 0.003 // 0.3%/beat
export const ATTENTION_REFILL_PER_FIRE = 0.004
export const STOCK_DRIFT_RATE = 0.02 // per bar toward median between conjunctions

export function conditionOf(heat: number): Condition {
  if (heat >= 0.66) return 'warm'
  if (heat >= 0.20) return 'tepid'
  return 'cold'
}

// Initial state — mirrors the "normal" PitScreen scenario plus a wheel
// and research board in mid-game. The values are static seeds; the
// player would override them via interaction once that layer ships.
export function initialState(): ShowState {
  const seedStation = (
    id: string,
    heat: number,
    cycle: number,
    auto: boolean,
    recipeIds: Array<string | null>,
  ): StationState => {
    const lib = STATION_RECIPES[id] ?? []
    const capacity = STATION_CAPACITY[id] ?? recipeIds.length
    const slots: Slot[] = []
    for (let i = 0; i < capacity; i++) {
      const r = recipeIds[i] ? lib.find((x) => x.id === recipeIds[i]) : undefined
      if (!r) slots.push({ state: 'empty' })
      else slots.push({ state: 'active', recipeId: r.id })
    }
    return { id, slots, capacity, heat, cycle, auto, alarm: false }
  }

  return {
    act: 'II',
    scene: 'iii',
    bar: 47,
    beat: 0,
    attention: 0.62,
    stations: [
      seedStation('cistern', 0.81, 0.34, false, ['salt', 'brine', 'sparks']),
      seedStation('bellows', 0.86, 0.62, false, ['fifth', 'fourth', 'octave']),
      seedStation('retort', 0.48, 0.85, true, ['major', 'cascade', null]),
    ],
    planets: WHEEL_PLANETS.map((p, i) => ({
      id: p.id,
      stockMax: p.stockMax,
      // seed values mirror the WheelScreen mockup
      stock: [18, 4, 9, 2, 11, 6, 1][i] ?? 0,
    })),
    conjunctions: [
      { pair: ['E', 'G'], ratio: '5:4', inBars: 0, durationBars: 14, open: true },
      { pair: ['C', 'G'], ratio: '3:2', inBars: 8, durationBars: 14, open: false },
      { pair: ['C', 'F'], ratio: '4:3', inBars: 31, durationBars: 14, open: false },
      { pair: ['D', 'A'], ratio: '3:2', inBars: 54, durationBars: 14, open: false },
    ],
    activeInquiryProgress: 0.62,
    writs: 7,
    purse: { C: 18, E: 7, G: 5, 'ƒ3': 2, '∮': 14 },
  }
}

// Advance the state by exactly one beat. Caller drives the cadence.
export function tickBeat(prev: ShowState): ShowState {
  const next: ShowState = {
    ...prev,
    beat: prev.beat,
    stations: prev.stations.map((s) => ({ ...s, slots: s.slots.slice() })),
    planets: prev.planets.map((p) => ({ ...p })),
    conjunctions: prev.conjunctions.map((c) => ({ ...c })),
    purse: { ...prev.purse },
  }

  // attention drains every beat regardless of activity
  next.attention = Math.max(0, prev.attention - ATTENTION_DRAIN_PER_BEAT)

  // stations — heat drift + cycle progress per beat
  for (let i = 0; i < next.stations.length; i++) {
    const s = next.stations[i]
    const def = STATIONS[s.id]
    if (!def) continue
    const activeSlots = s.slots.filter((sl) => sl.state === 'active').length
    // heat decays unless firing this beat (approximate: active stations
    // hold steady, cold ones drop further).
    if (activeSlots === 0) {
      s.heat = Math.max(0, s.heat - HEAT_DRAIN_PER_BEAT)
    } else {
      s.heat = Math.max(0, s.heat - HEAT_DRAIN_PER_BEAT * 0.5)
    }
    // cycle advances per beat at 1 / (cycle_seconds × 4_beats_per_second)
    const advance = 1 / (def.cycle * 4)
    s.cycle += advance
    while (s.cycle >= 1) {
      s.cycle -= 1
      // each completed cycle fires every active slot — refill attention
      next.attention = Math.min(1, next.attention + ATTENTION_REFILL_PER_FIRE * activeSlots)
    }
    s.alarm = s.heat < 0.2
  }

  // bar / beat clock
  next.beat = prev.beat + 1
  if (next.beat >= 4) {
    next.beat = 0
    next.bar = prev.bar + 1
    advanceBar(next)
  }

  return next
}

// Per-bar updates: planet stock drift, conjunction window countdown.
function advanceBar(state: ShowState): void {
  // stocks drift toward median between active windows
  const anyOpen = state.conjunctions.some((c) => c.open)
  if (!anyOpen) {
    for (const p of state.planets) {
      const median = p.stockMax / 2
      const dir = Math.sign(median - p.stock)
      if (dir !== 0) {
        const step = STOCK_DRIFT_RATE * p.stockMax
        if (Math.abs(median - p.stock) < step) p.stock = median
        else p.stock = Math.max(0, Math.min(p.stockMax, p.stock + dir * step))
      }
    }
  }

  // conjunctions: open ones tick toward close; queued ones tick toward open
  for (const c of state.conjunctions) {
    if (c.open) {
      c.durationBars -= 1
      if (c.durationBars <= 0) {
        c.open = false
        // reschedule far enough out that the queue stays populated
        c.inBars = 30 + Math.floor(Math.random() * 12)
        c.durationBars = 14
      }
    } else {
      c.inBars -= 1
      if (c.inBars <= 0) {
        c.open = true
        c.durationBars = 14
      }
    }
  }
}

// Helpers for the UI ────────────────────────────────────────────────
export function formatBarTime(barsAhead: number): string {
  // bars are 1 s each in real time; format as M:SS
  const total = Math.max(0, barsAhead)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
