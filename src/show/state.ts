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
  UPGRADES,
  WHEEL_PLANETS,
  type Coin,
  type Note,
  type Recipe,
  type UpgradeId,
} from './data'

export const BEAT_MS = 250
export const BARS_PER_ACT = 128

export type Condition = 'warm' | 'tepid' | 'cold'

export type SlotState = 'active' | 'idle' | 'starved' | 'empty' | 'locked'
// `committed` means inputs have been debited from the purse and the slot is
// owed its output at the next slot-cycle rollover. Generators with no
// inputs commit trivially. Slots with recipes that lack their inputs sit at
// `starved` with `committed: false` until the purse can pay. `cycle` is the
// per-slot fraction toward the next fire (in [0, 1)); each slot runs its
// own clock so a generator and a refiner in the same station can fire at
// different cadences.
export type Slot = {
  state: SlotState
  recipeId?: string
  committed?: boolean
  cycle: number
}

export type StationState = {
  id: string
  slots: Slot[]
  capacity: number
  heat: number      // [0, 1]
  auto: boolean
  alarm: boolean
}

export type Upgrades = {
  // Each level adds +1 to the Dig recipe's output qty.
  genYield: number
  // Each level halves the Press recipe's cycle (cycle × 0.5^N).
  refSpeed: number
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
  // bought-upgrade levels — modify recipe yield / cycle in the Pit
  upgrades: Upgrades
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

// Initial state — Act I, fresh start. One station (the Pit's Cistern)
// pre-loaded with the canonical 2G+1R: two Dig slots, one Press slot.
// Both gens fire trivially; the press starves on beat 1 then commits the
// moment the first dig credits a C to the purse.
export function initialState(): ShowState {
  const seedPit = (): StationState => {
    const lib = STATION_RECIPES.cistern ?? []
    const capacity = STATION_CAPACITY.cistern ?? 3
    const recipeIds: Array<string | null> = ['dig', 'dig', 'press']
    const slots: Slot[] = []
    for (let i = 0; i < capacity; i++) {
      const id = recipeIds[i]
      const r = id ? lib.find((x) => x.id === id) : undefined
      if (!r) slots.push({ state: 'empty', cycle: 0 })
      else if (r.unlocked) {
        const committed = r.in.length === 0
        slots.push({
          state: committed ? 'active' : 'starved',
          recipeId: r.id,
          committed,
          cycle: 0,
        })
      } else slots.push({ state: 'starved', recipeId: r.id, committed: false, cycle: 0 })
    }
    return { id: 'cistern', slots, capacity, heat: 0.8, auto: false, alarm: false }
  }

  return {
    act: 'I',
    scene: 'i',
    bar: 1,
    beat: 0,
    attention: 0.5,
    stations: [seedPit()],
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
    upgrades: { genYield: 0, refSpeed: 0 },
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

// Apply upgrade modifiers to a recipe. Returns a fresh Recipe each call;
// callers can read .cycle and .out.qty without further bookkeeping.
export function effectiveRecipe(
  stationId: string,
  recipeId: string | undefined,
  upgrades: Upgrades,
): Recipe | undefined {
  const r = resolveRecipe(stationId, recipeId)
  if (!r) return undefined
  if (recipeId === 'dig' && upgrades.genYield > 0) {
    return { ...r, out: { ...r.out, qty: r.out.qty + upgrades.genYield } }
  }
  if (recipeId === 'press' && upgrades.refSpeed > 0) {
    const base = r.cycle ?? STATIONS[stationId]?.cycle ?? 2
    return { ...r, cycle: base * Math.pow(0.5, upgrades.refSpeed) }
  }
  return r
}

function slotCycleSeconds(stationId: string, r: Recipe): number {
  return r.cycle ?? STATIONS[stationId]?.cycle ?? 4
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

    const anyCommitted = s.slots.some((sl) => sl.committed)

    // Heat dynamics: drain is halved while something is committed; otherwise
    // it cools at full rate. Cold (heat < HEAT_COLD) freezes every slot's
    // cycle but doesn't uncommit — a relight thaws and resumes.
    const drain = anyCommitted
      ? HEAT_DRAIN_PER_BEAT * HEAT_DRAIN_ACTIVE_MULT
      : HEAT_DRAIN_PER_BEAT
    s.heat = Math.max(0, s.heat - drain)
    const heatFactor = s.heat >= HEAT_COLD ? 1 : 0

    let firedTotal = 0

    // Pass A: advance every committed slot's own clock. On rollover, credit
    // its output and clear the commit. Slots that finish here can recommit
    // in Pass B using whatever just landed in the purse.
    if (heatFactor > 0) {
      for (let j = 0; j < s.slots.length; j++) {
        const slot = s.slots[j]
        if (!slot.committed || !slot.recipeId) continue
        const r = effectiveRecipe(s.id, slot.recipeId, next.upgrades)
        if (!r) continue
        const advance = (1 / (slotCycleSeconds(s.id, r) * 4)) * cycleSpeed * heatFactor
        slot.cycle += advance
        while (slot.cycle >= 1) {
          slot.cycle -= 1
          purseCredit(next.purse, r.out)
          firedTotal += 1
          slot.committed = false
          // If the same slot will fire again this beat, the next iteration
          // needs to recommit first. Otherwise Pass B will handle it.
          if (slot.cycle >= 1) {
            const re = tryCommit(slot, s.id, next.purse)
            if (!re.committed) {
              slot.cycle = 0
              slot.state = re.state
              break
            }
            slot.state = re.state
            slot.committed = true
          }
        }
      }
    }

    // Pass B: try to commit anything uncommitted — both freshly-fired slots
    // and slots that were starved coming into this beat. Gens commit first
    // by virtue of having no inputs, so the press downstream can grab the
    // C that was just credited.
    for (let j = 0; j < s.slots.length; j++) {
      const slot = s.slots[j]
      if (slot.state === 'empty' || slot.state === 'locked' || !slot.recipeId) continue
      if (slot.committed) continue
      s.slots[j] = tryCommit(slot, s.id, next.purse)
    }

    if (firedTotal > 0) {
      next.attention = Math.min(
        1,
        next.attention + ATTENTION_REFILL_PER_FIRE * firedTotal,
      )
      s.heat = Math.min(1, s.heat + HEAT_BUMP_PER_FIRE * firedTotal)
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
    cycle: 0,
  }
  return next
}

// ── Upgrades ────────────────────────────────────────────────────────
export function upgradeCost(id: UpgradeId, level: number): number {
  const u = UPGRADES[id]
  return Math.round(u.base * Math.pow(u.scale, level))
}

export function buyUpgrade(state: ShowState, id: UpgradeId): ShowState {
  const level = state.upgrades[id]
  const cost = upgradeCost(id, level)
  const have = state.purse['∮'] ?? 0
  if (have < cost) return state
  return {
    ...state,
    purse: { ...state.purse, '∮': have - cost },
    upgrades: { ...state.upgrades, [id]: level + 1 },
  }
}

// Projected steady-state ∮/s for a single station given current upgrades
// and slot mix. Computes raw produced/s vs raw consumed/s and reports the
// refiner output limited by whichever is the bottleneck. Reported at the
// recipe's own cadence (cycleSpeed = 1), so the display is stable and
// matches what the player would see at 50% audience attention.
export function projectedApplauseRate(state: ShowState, stationIdx: number): number {
  const s = state.stations[stationIdx]
  if (!s) return 0
  let rawPerSec = 0
  let consumePerSec = 0
  let refOutPerSec = 0
  for (const slot of s.slots) {
    if (!slot.recipeId) continue
    const r = effectiveRecipe(s.id, slot.recipeId, state.upgrades)
    if (!r) continue
    const cycle = slotCycleSeconds(s.id, r)
    if (r.in.length === 0) {
      rawPerSec += r.out.qty / cycle
    } else {
      // Single-input refiner assumption holds for the current Pit recipes.
      consumePerSec += r.in[0].qty / cycle
      refOutPerSec += r.out.qty / cycle
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
