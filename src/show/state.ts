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
  type Recipe,
} from './data'

export const BEAT_MS = 250
export const BARS_PER_ACT = 128

export type Condition = 'warm' | 'tepid' | 'cold'

export type SlotState = 'active' | 'idle' | 'starved' | 'empty' | 'locked'
// `committed` means inputs have been debited from the purse and the slot is
// owed its output at the next station-cycle rollover. Extractors with no
// inputs commit trivially. Slots with recipes that lack their inputs sit at
// `starved` with `committed: false` until the purse can pay.
export type Slot = { state: SlotState; recipeId?: string; committed?: boolean }

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
export const HEAT_DRAIN_ACTIVE_MULT = 0.5  // committed-firing drain is halved
export const HEAT_BUMP_PER_FIRE = 0.02     // each successful slot fire warms the station
export const HEAT_COLD = 0.20              // below this, cycle freezes
export const HEAT_TEND_BUMP = 0.25         // tap-to-tend lift
export const HEAT_RELIGHT_TO = 0.60        // relight resets heat to this
export const RELIGHT_COST: { coin: Coin; qty: number } = { coin: 'ƒ3', qty: 1 }
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
      // Seeded mid-cycle stations have notionally already paid their inputs —
      // grandfather them as committed so the first rollover delivers outputs
      // without retroactively debiting the purse. Locked recipes never
      // commit: they sit starved until research unlocks them.
      else if (r.unlocked) slots.push({ state: 'active', recipeId: r.id, committed: true })
      else slots.push({ state: 'starved', recipeId: r.id, committed: false })
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

// ── Purse helpers ────────────────────────────────────────────────────
function purseHas(purse: Partial<Record<Coin, number>>, ins: Recipe['in']): boolean {
  for (const it of ins) {
    if ((purse[it.note] ?? 0) < it.qty) return false
  }
  return true
}
function purseDebit(purse: Partial<Record<Coin, number>>, ins: Recipe['in']): void {
  for (const it of ins) purse[it.note] = (purse[it.note] ?? 0) - it.qty
}
function purseCredit(purse: Partial<Record<Coin, number>>, out: Recipe['out']): void {
  purse[out.note] = (purse[out.note] ?? 0) + out.qty
}

function resolveRecipe(stationId: string, recipeId?: string): Recipe | undefined {
  if (!recipeId) return undefined
  return (STATION_RECIPES[stationId] ?? []).find((r) => r.id === recipeId)
}

// Try to commit a slot for the upcoming cycle. Returns the next slot shape.
// Mutates `purse` if the commit succeeds.
function tryCommit(
  slot: Slot,
  stationId: string,
  purse: Partial<Record<Coin, number>>,
): Slot {
  if (slot.state === 'empty' || slot.state === 'locked' || !slot.recipeId) {
    return slot
  }
  const r = resolveRecipe(stationId, slot.recipeId)
  if (!r || !r.unlocked) {
    return { ...slot, state: 'starved', committed: false }
  }
  if (purseHas(purse, r.in)) {
    purseDebit(purse, r.in)
    return { ...slot, state: 'active', committed: true }
  }
  return { ...slot, state: 'starved', committed: false }
}

// Advance the state by exactly one beat. Caller drives the cadence.
export function tickBeat(prev: ShowState): ShowState {
  const next: ShowState = {
    ...prev,
    beat: prev.beat,
    stations: prev.stations.map((s) => ({ ...s, slots: s.slots.map((sl) => ({ ...sl })) })),
    planets: prev.planets.map((p) => ({ ...p })),
    conjunctions: prev.conjunctions.map((c) => ({ ...c })),
    purse: { ...prev.purse },
  }

  // attention drains every beat regardless of activity
  next.attention = Math.max(0, prev.attention - ATTENTION_DRAIN_PER_BEAT)

  // Attention modulates cycle speed across the board: 0.5× at 0%, 1.5× at 100%.
  // Drained never stops the loop entirely — just slows it.
  const cycleSpeed = 0.5 + next.attention

  for (let i = 0; i < next.stations.length; i++) {
    const s = next.stations[i]
    const def = STATIONS[s.id]
    if (!def) continue

    // Starved slots get a per-beat recovery attempt: if the purse just filled
    // up (e.g. an extractor delivered C this beat), the starved refiner can
    // commit now and start advancing toward the next rollover without waiting
    // a full cycle.
    for (let j = 0; j < s.slots.length; j++) {
      const sl = s.slots[j]
      if (sl.state === 'starved' && !sl.committed) {
        s.slots[j] = tryCommit(sl, s.id, next.purse)
      }
    }

    const anyCommitted = s.slots.some((sl) => sl.committed)

    // Heat dynamics: drain is halved while something is committed and the
    // station is actually working; otherwise it cools at full rate.
    const drain = anyCommitted
      ? HEAT_DRAIN_PER_BEAT * HEAT_DRAIN_ACTIVE_MULT
      : HEAT_DRAIN_PER_BEAT
    s.heat = Math.max(0, s.heat - drain)

    // Cold (heat < HEAT_COLD) freezes the cycle but does not uncommit —
    // a relight thaws and resumes from where the cycle paused.
    const heatFactor = s.heat >= HEAT_COLD ? 1 : 0

    if (anyCommitted && heatFactor > 0) {
      const advance = (1 / (def.cycle * 4)) * cycleSpeed * heatFactor
      s.cycle += advance
    }

    while (s.cycle >= 1) {
      s.cycle -= 1
      // Phase A: deliver outputs from every committed slot, refill attention,
      // bump heat from the burst of activity.
      let firedCount = 0
      for (let j = 0; j < s.slots.length; j++) {
        const sl = s.slots[j]
        if (!sl.committed) continue
        const r = resolveRecipe(s.id, sl.recipeId)
        if (r) {
          purseCredit(next.purse, r.out)
          firedCount += 1
        }
        s.slots[j] = { ...sl, committed: false, state: 'active' }
      }
      if (firedCount > 0) {
        next.attention = Math.min(
          1,
          next.attention + ATTENTION_REFILL_PER_FIRE * firedCount,
        )
        s.heat = Math.min(1, s.heat + HEAT_BUMP_PER_FIRE * firedCount)
      }
      // Phase B: try to commit fresh inputs for the next cycle.
      for (let j = 0; j < s.slots.length; j++) {
        s.slots[j] = tryCommit(s.slots[j], s.id, next.purse)
      }
    }

    s.alarm = s.heat < HEAT_COLD
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

// ── Player actions ──────────────────────────────────────────────────
// All pure: return a new ShowState (or the same reference if the action was a
// no-op). The reducer in App.tsx wraps these and dispatches them on click.

function cloneStations(state: ShowState, idx: number): ShowState {
  return {
    ...state,
    stations: state.stations.map((s, i) =>
      i === idx ? { ...s, slots: s.slots.map((sl) => ({ ...sl })) } : s,
    ),
    purse: { ...state.purse },
  }
}

export function tendStation(state: ShowState, idx: number): ShowState {
  const target = state.stations[idx]
  if (!target) return state
  if (target.heat >= 1) return state
  const next = cloneStations(state, idx)
  const s = next.stations[idx]
  s.heat = Math.min(1, s.heat + HEAT_TEND_BUMP)
  s.alarm = s.heat < HEAT_COLD
  return next
}

export function relightStation(state: ShowState, idx: number): ShowState {
  const target = state.stations[idx]
  if (!target) return state
  if (target.heat >= HEAT_COLD) return state // not cold; nothing to relight
  const have = state.purse[RELIGHT_COST.coin] ?? 0
  if (have < RELIGHT_COST.qty) return state // can't afford
  const next = cloneStations(state, idx)
  next.purse[RELIGHT_COST.coin] = have - RELIGHT_COST.qty
  const s = next.stations[idx]
  s.heat = HEAT_RELIGHT_TO
  s.alarm = false
  return next
}

// Tap a slot to swap to the next *unlocked* recipe in the station's library.
// Tapping an empty slot picks the first unlocked recipe. Swapping forfeits
// any committed inputs (no refund) — the cost of indecision.
export function swapSlotRecipe(
  state: ShowState,
  stationIdx: number,
  slotIdx: number,
): ShowState {
  const station = state.stations[stationIdx]
  if (!station) return state
  const slot = station.slots[slotIdx]
  if (!slot || slot.state === 'locked') return state

  const lib = (STATION_RECIPES[station.id] ?? []).filter((r) => r.unlocked)
  if (lib.length === 0) return state

  let nextRecipeId: string
  if (!slot.recipeId) {
    nextRecipeId = lib[0].id
  } else {
    const cur = lib.findIndex((r) => r.id === slot.recipeId)
    // -1 (current recipe locked or unknown) → first; otherwise cycle to next.
    nextRecipeId = lib[(cur + 1) % lib.length].id
  }
  if (nextRecipeId === slot.recipeId) return state

  const next = cloneStations(state, stationIdx)
  next.stations[stationIdx].slots[slotIdx] = {
    state: 'active',
    recipeId: nextRecipeId,
    committed: false,
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
