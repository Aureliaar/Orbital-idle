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
  MODULES,
  MODULE_CYCLE,
  ROLE_RECIPES,
  STATIONS,
  STATION_CAPACITY,
  WHEEL_PLANETS,
  type Coin,
  type ModuleId,
  type Note,
  type StationRole,
} from './data'

export const BEAT_MS = 250
export const BARS_PER_ACT = 128

export type Condition = 'warm' | 'tepid' | 'cold'

export type SlotState = 'empty' | 'installed' | 'inactive' | 'locked'
// A pit station's slots hold *modules*, not recipes. A slot is one of:
//   empty:     no module installed; tap to cycle in the first affordable
//   installed: module is in and effective for the station's current role
//   inactive:  module is in but role-locked to the opposite role (greyed)
//   locked:    research-gated capacity, not yet unlocked
export type Slot = {
  state: SlotState
  moduleId?: ModuleId
}

export type StationState = {
  id: string
  role: StationRole
  slots: Slot[]
  capacity: number
  cycle: number     // [0, 1) — station-wide fraction of one cycle
  heat: number      // [0, 1]
  // Has the station debited inputs for the current cycle? Generators
  // commit trivially. Refiners stay uncommitted (cycle frozen at 0)
  // until the purse can pay.
  committed: boolean
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

// Initial state — Act I, fresh start. Three pit stations on the bench
// (Cistern, Bellows, Retort), seeded as 2G + 1R so the loop closes on
// beat 1: two gens immediately mint C, one ref starves until the first
// gen rollover credits to the purse.
export function initialState(): ShowState {
  const seedPit = (id: string, role: StationRole): StationState => {
    const capacity = STATION_CAPACITY[id] ?? 3
    const slots: Slot[] = []
    for (let i = 0; i < capacity; i++) slots.push({ state: 'empty' })
    return {
      id,
      role,
      slots,
      capacity,
      cycle: 0,
      heat: 0.8,
      // Generators commit trivially (no inputs). Refiners start
      // uncommitted and pick up their first commit once the purse has C.
      committed: role === 'gen',
      auto: false,
      alarm: false,
    }
  }

  return {
    act: 'I',
    scene: 'i',
    bar: 1,
    beat: 0,
    attention: 0.5,
    stations: [
      seedPit('cistern', 'gen'),
      seedPit('bellows', 'gen'),
      seedPit('retort', 'ref'),
    ],
    // Wheel + research seeds are kept so the other tabs read something,
    // but they're cosmetic until those stages get their own interaction.
    planets: WHEEL_PLANETS.map((p) => ({
      id: p.id,
      stockMax: p.stockMax,
      stock: Math.floor(p.stockMax / 2),
    })),
    conjunctions: [
      { pair: ['C', 'G'], ratio: '3:2', inBars: 12, durationBars: 14, open: false },
      { pair: ['C', 'F'], ratio: '4:3', inBars: 32, durationBars: 14, open: false },
    ],
    activeInquiryProgress: 0,
    writs: 0,
    purse: { C: 0, '∮': 0, 'ƒ3': 1 },
  }
}

// ── Purse helpers ────────────────────────────────────────────────────
type IngredientList = Array<{ note: Coin; qty: number }>
type Output = { note: Coin; qty: number }
function purseHas(purse: Partial<Record<Coin, number>>, ins: IngredientList): boolean {
  for (const it of ins) {
    if ((purse[it.note] ?? 0) < it.qty) return false
  }
  return true
}
function purseDebit(purse: Partial<Record<Coin, number>>, ins: IngredientList): void {
  for (const it of ins) purse[it.note] = (purse[it.note] ?? 0) - it.qty
}
function purseCredit(purse: Partial<Record<Coin, number>>, out: Output): void {
  purse[out.note] = (purse[out.note] ?? 0) + out.qty
}

// ── Role + module resolution ─────────────────────────────────────────
export type StationRecipe = {
  in: IngredientList
  out: Output
  cycle: number
}

// Active modules: installed AND not blocked by a role-lock mismatch.
function activeModules(station: StationState) {
  const out = []
  for (const slot of station.slots) {
    if (slot.state !== 'installed' || !slot.moduleId) continue
    const m = MODULES[slot.moduleId]
    if (m.roleLock && m.roleLock !== station.role) continue
    out.push(m)
  }
  return out
}

// The station's running recipe after modules are applied.
export function effectiveStationRecipe(station: StationState): StationRecipe {
  const base = ROLE_RECIPES[station.role]
  let cycle = base.cycle
  let outputBonus = 0
  for (const m of activeModules(station)) {
    if (m.effects.cycleMult) cycle *= m.effects.cycleMult
    if (m.effects.outputBonus) outputBonus += m.effects.outputBonus
  }
  return {
    in: base.in.map((it) => ({ ...it })),
    out: { note: base.out.note, qty: base.out.qty + outputBonus },
    cycle,
  }
}

function effectiveHeatDrainMult(station: StationState): number {
  let mult = 1
  for (const m of activeModules(station)) {
    if (m.effects.heatDrainMult) mult *= m.effects.heatDrainMult
  }
  return mult
}

// Try to commit a station for the upcoming cycle. Mutates `purse` if it
// succeeds. Generators (no inputs) always commit.
function tryStationCommit(
  recipe: StationRecipe,
  purse: Partial<Record<Coin, number>>,
): boolean {
  if (purseHas(purse, recipe.in)) {
    purseDebit(purse, recipe.in)
    return true
  }
  return false
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

  // Generators commit first so refiners downstream can draw fresh C
  // from the purse in the same beat. Two passes: deliver outputs first,
  // then commit next cycle's inputs.
  const order = [...next.stations.keys()].sort(
    (a, b) => +(next.stations[a].role !== 'gen') - +(next.stations[b].role !== 'gen'),
  )

  // Pass A: advance committed stations and fire on rollover.
  let totalFired = 0
  for (const i of order) {
    const s = next.stations[i]
    const def = STATIONS[s.id]
    if (!def) continue

    // Heat drain: halved while committed, scaled down further by any
    // Damper modules active on this station.
    const drain =
      (s.committed
        ? HEAT_DRAIN_PER_BEAT * HEAT_DRAIN_ACTIVE_MULT
        : HEAT_DRAIN_PER_BEAT) * effectiveHeatDrainMult(s)
    s.heat = Math.max(0, s.heat - drain)
    const heatFactor = s.heat >= HEAT_COLD ? 1 : 0
    s.alarm = s.heat < HEAT_COLD

    if (!s.committed || heatFactor === 0) continue
    const r = effectiveStationRecipe(s)
    const advance = (1 / (r.cycle * 4)) * cycleSpeed * heatFactor
    s.cycle += advance
    while (s.cycle >= 1) {
      s.cycle -= 1
      purseCredit(next.purse, r.out)
      totalFired += 1
      s.heat = Math.min(1, s.heat + HEAT_BUMP_PER_FIRE)
      // Try to recommit immediately so a multi-fire beat keeps rolling.
      if (tryStationCommit(r, next.purse)) {
        s.committed = true
      } else {
        s.committed = false
        s.cycle = 0
        break
      }
    }
  }

  // Pass B: commit any station that's idle (refiners that were starved
  // until a generator's Pass A credit landed in the purse).
  for (const i of order) {
    const s = next.stations[i]
    if (s.committed) continue
    const r = effectiveStationRecipe(s)
    if (tryStationCommit(r, next.purse)) {
      s.committed = true
    }
  }

  if (totalFired > 0) {
    next.attention = Math.min(
      1,
      next.attention + ATTENTION_REFILL_PER_FIRE * totalFired,
    )
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
  const next = cloneStations(state, idx)
  const s = next.stations[idx]
  if (s.heat < 1) {
    s.heat = Math.min(1, s.heat + HEAT_TEND_BUMP)
    s.alarm = s.heat < HEAT_COLD
  }
  // Tending pulls the audience's eye back too — without this nudge the
  // baseline fire rate isn't enough to overcome attention drain and the
  // display rate is misleadingly optimistic.
  next.attention = Math.min(1, state.attention + 0.08)
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

// Flip a pit station between Generator and Refiner roles. Any committed
// inputs are forfeited; the cycle resets to 0. Role-locked modules in
// the station's slots stay installed but become inactive on the new role.
export function toggleStationRole(state: ShowState, idx: number): ShowState {
  const station = state.stations[idx]
  if (!station) return state
  const next = cloneStations(state, idx)
  const s = next.stations[idx]
  s.role = s.role === 'gen' ? 'ref' : 'gen'
  s.cycle = 0
  s.committed = s.role === 'gen' // gens commit trivially
  // Refresh slot "inactive" flags so the UI reflects role-lock mismatches
  // without waiting for the next tick.
  for (let j = 0; j < s.slots.length; j++) {
    const slot = s.slots[j]
    if (slot.state === 'installed' || slot.state === 'inactive') {
      s.slots[j] = { ...slot, state: moduleSlotState(slot.moduleId, s.role) }
    }
  }
  return next
}

function moduleSlotState(
  moduleId: ModuleId | undefined,
  role: StationRole,
): 'installed' | 'inactive' | 'empty' {
  if (!moduleId) return 'empty'
  const m = MODULES[moduleId]
  if (m.roleLock && m.roleLock !== role) return 'inactive'
  return 'installed'
}

// ── Module install ─────────────────────────────────────────────────
// Total installs of one module across all stations — the cost scales
// off this count so the player feels the price climb regardless of
// where they spread the modules.
export function moduleInstallCount(state: ShowState, id: ModuleId): number {
  let n = 0
  for (const st of state.stations) {
    for (const sl of st.slots) {
      if (sl.state !== 'empty' && sl.state !== 'locked' && sl.moduleId === id) n += 1
    }
  }
  return n
}

export function moduleCost(state: ShowState, id: ModuleId): number {
  const m = MODULES[id]
  return Math.round(m.baseCost * Math.pow(m.costScale, moduleInstallCount(state, id)))
}

// Tap a module slot to advance to the next entry in MODULE_CYCLE.
// Entering a module state debits its install cost; cycling back to empty
// is free (no refund). Unaffordable transitions are skipped silently —
// the slot advances to the next affordable state, or to empty if none.
export function cycleSlotModule(
  state: ShowState,
  stationIdx: number,
  slotIdx: number,
): ShowState {
  const station = state.stations[stationIdx]
  if (!station) return state
  const slot = station.slots[slotIdx]
  if (!slot || slot.state === 'locked') return state

  const current: ModuleId | null = slot.moduleId ?? null
  const idx = MODULE_CYCLE.indexOf(current)
  const start = idx === -1 ? 0 : idx

  for (let step = 1; step <= MODULE_CYCLE.length; step++) {
    const nextEntry = MODULE_CYCLE[(start + step) % MODULE_CYCLE.length]
    if (nextEntry === null) {
      // Uninstall — always allowed.
      const next = cloneStations(state, stationIdx)
      next.stations[stationIdx].slots[slotIdx] = { state: 'empty' }
      return next
    }
    const cost = moduleCost(state, nextEntry)
    if ((state.purse['∮'] ?? 0) < cost) continue
    const next = cloneStations(state, stationIdx)
    next.purse['∮'] = (next.purse['∮'] ?? 0) - cost
    next.stations[stationIdx].slots[slotIdx] = {
      state: moduleSlotState(nextEntry, station.role),
      moduleId: nextEntry,
    }
    return next
  }
  return state
}

// Aggregate projected ∮/s across every pit station, given current roles
// and installed modules. Computes raw produced/s vs raw consumed/s and
// caps refiner output at the bottleneck. Reported at the recipes' own
// cadence (cycleSpeed = 1) — what the player would see at 50% audience
// attention.
export function projectedApplauseRate(state: ShowState): number {
  let rawPerSec = 0
  let consumePerSec = 0
  let refOutPerSec = 0
  for (const s of state.stations) {
    const r = effectiveStationRecipe(s)
    if (r.in.length === 0) {
      rawPerSec += r.out.qty / r.cycle
    } else {
      consumePerSec += r.in[0].qty / r.cycle
      refOutPerSec += r.out.qty / r.cycle
    }
  }
  if (refOutPerSec === 0) return 0
  if (consumePerSec === 0) return refOutPerSec
  const fed = Math.min(1, rawPerSec / consumePerSec)
  return refOutPerSec * fed
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
