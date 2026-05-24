import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AMSynth, Context, FMSynth, Panner, PluckSynth, setContext } from 'tone'
import './App.css'
import type { AudioGraph } from './audio'
import { createAudioGraph, teardownAudioGraph } from './audio'
import type { Body, BodyId } from './bodies'
import { BODIES, EARTH, EARTH_PERIOD_S, TARGETS, periodOf } from './bodies'
import { HarvestStage } from './HarvestStage'
import {
  addToPurse,
  canAfford as canAffordPurse,
  computeIdleRate,
  FREQ_COLORS,
  FREQ_CURRENCIES,
  FREQ_CURRENCY_KEYS,
  FREQ_INTERVAL_LABEL,
  FREQ_SOURCES,
  INITIAL_SLOT_COUNT,
  MAX_SLOT0_CAPACITY,
  MAX_SLOT_COUNT,
  NOTE_CURRENCIES,
  PAD_COLORS,
  subtractCost,
} from './harvest-config'
import type {
  CurrencyKey,
  CurrencyPurse,
  FreqCurrency,
} from './harvest-config'
import { OrbitEngraving, PageChrome } from './PageChrome'
import { PlanetTile } from './PlanetTile'
import { UpgradePanel } from './UpgradePanel'

type Tab = 'orbits' | 'harvest'

// --- Cost tables --------------------------------------------------------
//
// Costs are expressed in **scale-degree** terms relative to a planet's
// tonic, then resolved into the planet's local note currencies at runtime.
// Scale-degree offsets are 0 = tonic (I), 1 = supertonic (II), …, 6 =
// leading tone (VII) — i.e. positions in the diatonic 7-body scale order
// (BODIES is already in scale order C, D, E, F, G, A, B). A planet rooted
// at scale-index `t` reads its scale-degree `d` as BODIES[(t + d) % 7].
//
// The ladder mirrors the original C ladder's shape:
//   [I, III, V, IV, VI, II, VII]
// — tonic triad first, then the IV/VI to close the diatonic, then the
// dissonant II and finally the leading-tone VII. For C this expands to
// [C, E, G, F, A, D, B] exactly; for other planets the ladder is the
// same scale-degree pattern remapped to their tonic.
//
// Freq-currency costs are specified as **scale-degree pairs** (a, b) and
// resolved to the FreqCurrency that pair's bodies coincide on in the
// diatonic harmonic table (FREQ_SOURCES). Because the seven bodies sit
// on a fixed just-intonation lattice in C-frame, different modes — D
// Dorian, E Phrygian, … — produce *different* freq currencies for the
// "same" scale-degree pair. When a scale-degree pair has no coincidence
// in the available H≤6 series, that freq cost is dropped: the unlock is
// slightly cheaper, reflecting that the pair has no shared partial in
// that planet's mode. Some planets therefore have less freq-gating than
// C; that's the cost of running the same loop on a different tonic.

const LADDER_OFFSETS = [0, 2, 4, 3, 5, 1, 6] as const

type SDNotes = Partial<Record<number, number>>
type SDFreq = { a: number; b: number; amount: number; octave?: 'low' | 'high' }
type SDCost = { notes?: SDNotes; freqs?: SDFreq[] }

const SCALE_INDEX_OF = (id: BodyId): number =>
  BODIES.findIndex((b) => b.id === id)

const FREQ_RATIO_OF: Record<FreqCurrency, number> = (() => {
  const out = {} as Record<FreqCurrency, number>
  for (const e of FREQ_CURRENCIES) out[e.key] = e.num / e.den
  return out
})()

// Every FreqCurrency a pair of bodies can mint together: keys whose
// FREQ_SOURCES include both ids. Pre-baked per pair so resolveSDCost
// stays cheap when memoising per-planet cost tables.
const FREQS_FOR_PAIR: Map<string, FreqCurrency[]> = (() => {
  const map = new Map<string, FreqCurrency[]>()
  for (let i = 0; i < BODIES.length; i++) {
    for (let j = 0; j < BODIES.length; j++) {
      if (i === j) continue
      const a = BODIES[i].id
      const b = BODIES[j].id
      const out: FreqCurrency[] = []
      for (const key of FREQ_CURRENCY_KEYS) {
        const src = FREQ_SOURCES[key]
        if (src.includes(a) && src.includes(b)) out.push(key)
      }
      out.sort((x, y) => FREQ_RATIO_OF[x] - FREQ_RATIO_OF[y])
      map.set(`${a}|${b}`, out)
    }
  }
  return map
})()

const freqsForPair = (a: BodyId, b: BodyId): FreqCurrency[] =>
  FREQS_FOR_PAIR.get(`${a}|${b}`) ?? []

const pickFreq = (
  freqs: readonly FreqCurrency[],
  octave: 'low' | 'high' | undefined,
): FreqCurrency | null => {
  if (freqs.length === 0) return null
  if (!octave || freqs.length === 1) return freqs[0]
  return octave === 'low' ? freqs[0] : freqs[freqs.length - 1]
}

function resolveSDCost(planet: BodyId, pattern: SDCost): CurrencyPurse {
  const tonicIdx = SCALE_INDEX_OF(planet)
  const cost: CurrencyPurse = {}
  if (pattern.notes) {
    for (const [sdStr, amount] of Object.entries(pattern.notes)) {
      if (!amount) continue
      const sd = Number(sdStr)
      const bodyId = BODIES[(tonicIdx + sd) % 7].id
      cost[bodyId] = (cost[bodyId] ?? 0) + amount
    }
  }
  for (const fp of pattern.freqs ?? []) {
    const aId = BODIES[(tonicIdx + fp.a) % 7].id
    const bId = BODIES[(tonicIdx + fp.b) % 7].id
    const chosen = pickFreq(freqsForPair(aId, bId), fp.octave)
    if (chosen) cost[chosen] = (cost[chosen] ?? 0) + fp.amount
  }
  return cost
}

// Ladder shape in scale-degree terms. Index = step (0..6), value = the
// scale-degree offset that opens at that step. LADDER_COST_PATTERN[i] is
// the cost to unlock LADDER_OFFSETS[i].
const LADDER_COST_PATTERN: readonly SDCost[] = [
  {}, // I — tonic, free
  { notes: { 0: 5 } }, // III — 5 of I
  { notes: { 0: 8, 2: 4 }, freqs: [{ a: 0, b: 2, amount: 2 }] }, // V — proves I×III
  {
    notes: { 0: 15, 2: 6, 4: 6 },
    freqs: [
      { a: 0, b: 4, amount: 2, octave: 'low' },
      { a: 0, b: 4, amount: 2, octave: 'high' },
    ],
  }, // IV — proves I×V in both octaves
  { notes: { 2: 12, 4: 12, 3: 6 }, freqs: [{ a: 0, b: 3, amount: 4 }] }, // VI — proves I×IV
  {
    notes: { 4: 18, 3: 12, 5: 8 },
    freqs: [
      { a: 0, b: 2, amount: 4 },
      { a: 2, b: 4, amount: 3 },
    ],
  }, // II — proves I×III and III×V
  {
    notes: { 1: 10, 5: 10, 4: 15, 3: 12 },
    freqs: [
      { a: 1, b: 4, amount: 4 },
      { a: 3, b: 5, amount: 4 },
    ],
  }, // VII — proves II×V and IV×VI
]

function ladderFor(planet: BodyId): BodyId[] {
  const tonicIdx = SCALE_INDEX_OF(planet)
  return LADDER_OFFSETS.map((off) => BODIES[(tonicIdx + off) % 7].id)
}

function unlockCostsFor(planet: BodyId): Record<BodyId, CurrencyPurse> {
  const ladder = ladderFor(planet)
  const out = {} as Record<BodyId, CurrencyPurse>
  ladder.forEach((id, step) => {
    out[id] = resolveSDCost(planet, LADDER_COST_PATTERN[step])
  })
  return out
}

// Auto-pluck base cost — the "you've played the diatonic" tax. Same
// scale-degree shape as C's original: lots of tonic, less mediant, less
// dominant, and a small freq dust of the first four coincidence types.
// Successive slots scale by 1.6.
const AUTO_PLUCK_BASE_PATTERN: SDCost = {
  notes: { 0: 120, 2: 80, 4: 60, 3: 40 },
  freqs: [
    { a: 0, b: 4, amount: 8, octave: 'low' },
    { a: 0, b: 2, amount: 8 },
    { a: 0, b: 3, amount: 8 },
    { a: 0, b: 4, amount: 8, octave: 'high' },
  ],
}
const AUTO_PLUCK_MIN_UNLOCKS = 3
const autoPluckCostFor = (planet: BodyId, slotIdx: number): CurrencyPurse => {
  const factor = 1.6 ** slotIdx
  const base = resolveSDCost(planet, AUTO_PLUCK_BASE_PATTERN)
  const out: CurrencyPurse = {}
  for (const k of Object.keys(base) as CurrencyKey[]) {
    out[k] = Math.round((base[k] ?? 0) * factor)
  }
  return out
}

// Slot 2 unlocks once III (the planet's mediant) is in hand and costs a
// single III — the gate note itself pays for the slot, so the player has
// to mint III before the slot is reachable, but the price is symbolic.
// Slot 3 demands freq currency — by then a pair of slots has been ringing
// together for a while.
const SLOT_UNLOCK_PATTERN: Record<number, SDCost> = {
  2: { notes: { 2: 1 } },
  3: {
    notes: { 0: 30, 2: 18, 4: 12 },
    freqs: [
      { a: 0, b: 4, amount: 4, octave: 'low' },
      { a: 0, b: 2, amount: 6 },
    ],
  },
}
const SLOT_UNLOCK_GATE_OFFSET: Record<number, number> = { 2: 2 }

// Slot 0 capacity ladder — stacking chords. Pricing demands a chord-
// shaped freq mix, with notes from the planet's tonic-triad and beyond.
const SLOT0_CAPACITY_PATTERN: Record<number, SDCost> = {
  2: {
    notes: { 2: 30, 4: 20 },
    freqs: [
      { a: 0, b: 2, amount: 6 },
      { a: 2, b: 4, amount: 4 },
    ],
  },
  3: {
    notes: { 3: 50, 5: 30 },
    freqs: [
      { a: 0, b: 4, amount: 6, octave: 'low' },
      { a: 0, b: 3, amount: 6 },
      { a: 0, b: 2, amount: 6 },
      { a: 2, b: 4, amount: 6 },
    ],
  },
}

// --- Per-note yield upgrades --------------------------------------------
//
// Each note has its own yield level; level n gives a YIELD_STEP^n
// multiplier on the NoteCurrency that note mints per tap. Cost grows by
// COST_STEP per level and is paid in the **next note up the circle of
// fifths' currency** — you have to play your dominant to upgrade your
// tonic. The cycle within the diatonic set is C→G→D→A→E→B→F→C, an
// intrinsic property of each note, so this map is the same on every
// planet — upgrading D always costs A, whether you're playing C's
// resonator or B's.
const YIELD_STEP = 1.5
const COST_STEP = 2
const NOTE_YIELD_BASE = 6
const FIFTH_NEXT: Record<BodyId, BodyId> = {
  C: 'G',
  G: 'D',
  D: 'A',
  A: 'E',
  E: 'B',
  B: 'F',
  F: 'C',
}
const noteYieldMultiplier = (lvl: number) => YIELD_STEP ** lvl
const noteYieldCost = (id: BodyId, lvl: number): CurrencyPurse => ({
  [FIFTH_NEXT[id]]: Math.round(NOTE_YIELD_BASE * COST_STEP ** lvl),
})

const HALO_PROXIMITY = 0.93

// Earth → C3 (130.81 Hz). Each body's just-intonation period ratio places it
// on the diatonic scale starting from C, so the visual note labels match the
// audible pitches: D3, E3, F3, G3, A3, B3.
const EARTH_HZ = 261.63 / 2

const VOICE_FLOOR_GAIN = 0.002
const VOICE_PEAK_GAIN = 0.16
const SWELL_ATTACK_TAU = 1.8
const SWELL_DECAY_TAU = 3.5
const SWELL_RELEASE_TAU = 0.55
const REARM_TARGET = VOICE_FLOOR_GAIN + (VOICE_PEAK_GAIN - VOICE_FLOOR_GAIN) * 0.05

const STRIKE_FLOOR_VELOCITY = 0.08
const EARTH_VELOCITY = 0.55
const STRIKE_DURATION = '8n'

const TIMBRES = ['pluck', 'piano', 'synth'] as const
type Timbre = (typeof TIMBRES)[number]
const TIMBRE_LABELS: Record<Timbre, string> = {
  pluck: 'Pluck',
  piano: 'Piano',
  synth: 'Synth',
}

type VoiceState = { held: number; releasing: boolean; armed: boolean }
type ToneVoice = {
  synth: PluckSynth | FMSynth | AMSynth
  panner: Panner
  freq: number
}
type OrbitAudio = {
  graph: AudioGraph
  voices: Map<BodyId, ToneVoice>
  earth: ToneVoice
  timbre: Timbre
}

const buildSynth = (timbre: Timbre): PluckSynth | FMSynth | AMSynth => {
  if (timbre === 'pluck') {
    return new PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.92, release: 1 })
  }
  if (timbre === 'piano') {
    return new FMSynth({
      harmonicity: 2,
      modulationIndex: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.003, decay: 1.6, sustain: 0, release: 0.6 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.003, decay: 0.5, sustain: 0, release: 0.4 },
    })
  }
  return new AMSynth({
    harmonicity: 2.5,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.8, sustain: 0.05, release: 0.6 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.05, decay: 0.4, sustain: 0, release: 0.3 },
  })
}

const ORBITS = [...BODIES].sort((a, b) => a.ratio - b.ratio)

// Each planet keeps its own resonator: a private purse, its own unlock
// ladder progress, slot loadout, slot upgrades, auto-pluck assignments,
// and per-note yield levels. Switching planet swaps the entire slice; no
// currency or progress crosses planet boundaries.
type ResonatorState = {
  currencies: CurrencyPurse
  seenCurrencies: ReadonlySet<CurrencyKey>
  unlockedIds: BodyId[]
  slots: BodyId[][]
  slotCount: number
  slot0Capacity: number
  autoPluckSlots: ReadonlySet<number>
  noteYieldLvls: Partial<Record<BodyId, number>>
}

function initialResonator(planetId: BodyId): ResonatorState {
  const slots: BodyId[][] = []
  for (let i = 0; i < INITIAL_SLOT_COUNT; i++) slots.push([])
  slots[0] = [planetId]
  return {
    currencies: {},
    seenCurrencies: new Set<CurrencyKey>([planetId]),
    unlockedIds: [planetId],
    slots,
    slotCount: INITIAL_SLOT_COUNT,
    slot0Capacity: 1,
    autoPluckSlots: new Set<number>(),
    noteYieldLvls: {},
  }
}

function initialResonators(): Record<BodyId, ResonatorState> {
  const out = {} as Record<BodyId, ResonatorState>
  for (const b of BODIES) out[b.id] = initialResonator(b.id)
  return out
}

const formatCurrency = (v: number): string => {
  if (v >= 1000) return Math.floor(v).toLocaleString()
  if (v >= 100) return Math.floor(v).toString()
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

const FREQ_LABEL_BY_KEY: Record<FreqCurrency, string> = FREQ_CURRENCIES.reduce(
  (acc, e) => {
    acc[e.key] = e.label
    return acc
  },
  {} as Record<FreqCurrency, string>,
)

const displayCurrencyKey = (k: CurrencyKey): string => {
  if (k in FREQ_LABEL_BY_KEY) return `f${FREQ_LABEL_BY_KEY[k as FreqCurrency]}`
  return k
}

const formatCost = (cost: CurrencyPurse): string => {
  const parts: string[] = []
  for (const k of NOTE_CURRENCIES) {
    const v = cost[k]
    if (v) parts.push(`${v} ${k}`)
  }
  for (const k of FREQ_CURRENCY_KEYS) {
    const v = cost[k]
    if (v) parts.push(`${v} ${displayCurrencyKey(k)}`)
  }
  return parts.join(' · ')
}

function CostChips({
  cost,
  purse,
}: {
  cost: CurrencyPurse
  purse?: CurrencyPurse
}) {
  const entries: Array<{ k: CurrencyKey; label: string; v: number; color: string }> = []
  for (const k of NOTE_CURRENCIES) {
    const v = cost[k]
    if (v) entries.push({ k, label: k, v, color: PAD_COLORS[k] ?? 'var(--text)' })
  }
  for (const k of FREQ_CURRENCY_KEYS) {
    const v = cost[k]
    if (v) entries.push({ k, label: displayCurrencyKey(k), v, color: FREQ_COLORS[k] })
  }
  const bottleneckK = purse ? findBottleneck(cost, purse)?.k ?? null : null
  return (
    <span className="cost-chips" aria-label={formatCost(cost)}>
      {entries.map(({ k, label, v, color }) => {
        const have = purse ? Math.floor(purse[k] ?? 0) : null
        const need = v
        const short = have !== null && have < need
        const isBottleneck = k === bottleneckK
        const prog =
          purse !== undefined ? Math.min(1, (purse[k] ?? 0) / need) : 1
        return (
          <span
            key={k}
            className={`cost-chip${short ? ' short' : have !== null ? ' ok' : ''}${
              isBottleneck ? ' bottleneck' : ''
            }`}
            style={{
              ['--chip-color' as string]: color,
              ['--p' as string]: prog.toFixed(3),
            }}
            title={
              have !== null
                ? `${have} / ${need} ${label}`
                : `${need} ${label}`
            }
          >
            <span className="cost-chip-k">{label}</span>
            <span className="cost-chip-v">
              {have !== null ? (
                <>
                  <span className="cost-chip-have">{have}</span>
                  <span className="cost-chip-sep">/</span>
                  <span className="cost-chip-need">{need}</span>
                </>
              ) : (
                need
              )}
            </span>
            {have !== null && <span className="cost-chip-bar" aria-hidden="true" />}
          </span>
        )
      })}
    </span>
  )
}

// Affordance progress: how close the player is to covering `cost` given
// their `purse`. min ratio across all required currencies, clamped to [0,1].
function costProgress(purse: CurrencyPurse, cost: CurrencyPurse): number {
  let min = 1
  let any = false
  for (const k of Object.keys(cost) as CurrencyKey[]) {
    const need = cost[k] ?? 0
    if (need <= 0) continue
    any = true
    const have = purse[k] ?? 0
    const ratio = Math.min(1, have / need)
    if (ratio < min) min = ratio
  }
  return any ? min : 1
}

type Bottleneck = {
  k: CurrencyKey
  shortBy: number
  color: string
  label: string
}

// Bottleneck = the cost currency the player has the smallest share of.
// Drives both the "need N more X" hint at the bottom of each card and the
// dashed-emphasis on the offending cost chip, so the player can see at a
// glance which currency is gating the buy without scanning every chip.
function findBottleneck(cost: CurrencyPurse, purse: CurrencyPurse): Bottleneck | null {
  let worst: Bottleneck | null = null
  let worstProg = Infinity
  for (const k of Object.keys(cost) as CurrencyKey[]) {
    const need = cost[k] ?? 0
    if (need <= 0) continue
    const have = purse[k] ?? 0
    if (have >= need) continue
    const prog = have / need
    if (prog < worstProg) {
      worstProg = prog
      const isNote = (NOTE_CURRENCIES as readonly string[]).includes(k)
      worst = {
        k,
        shortBy: Math.max(1, Math.ceil(need - have)),
        color: isNote ? PAD_COLORS[k] ?? 'var(--text)' : FREQ_COLORS[k as FreqCurrency],
        label: displayCurrencyKey(k),
      }
    }
  }
  return worst
}

function ShortHint({ cost, purse }: { cost: CurrencyPurse; purse: CurrencyPurse }) {
  const b = findBottleneck(cost, purse)
  if (!b) return null
  return (
    <span className="card-short">
      <span className="card-short-arrow" aria-hidden="true">↳</span>
      need <strong>{b.shortBy}</strong> more{' '}
      <span className="card-short-cur" style={{ color: b.color }}>{b.label}</span>
    </span>
  )
}

function ReadyBadge() {
  return (
    <span className="card-ready" aria-label="Ready to buy">
      <span aria-hidden="true">▶</span> Ready
    </span>
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const progressRef = useRef<HTMLElement | null>(null)
  const [upgradeFor, setUpgradeFor] = useState<Body | null>(null)
  const [audioOn, setAudioOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  })
  const [timbre, setTimbre] = useState<Timbre>('piano')
  const audioRef = useRef<OrbitAudio | null>(null)
  const [tab, setTab] = useState<Tab>('harvest')
  const [activePlanet, setActivePlanet] = useState<BodyId>('C')
  const [resonators, setResonators] = useState<Record<BodyId, ResonatorState>>(initialResonators)
  const active = resonators[activePlanet]
  const { currencies, seenCurrencies, unlockedIds, slots, slotCount, slot0Capacity, autoPluckSlots, noteYieldLvls } = active
  const slotCapacities = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => (i === 0 ? slot0Capacity : 1)),
    [slotCount, slot0Capacity],
  )

  // Per-planet cost tables. Same scale-degree shapes as the C originals,
  // resolved into the active planet's local note and freq currencies.
  // Memoised per planet because resolving the freq pairs walks the
  // pair table for every step.
  const unlockLadder = useMemo(() => ladderFor(activePlanet), [activePlanet])
  const unlockCosts = useMemo(() => unlockCostsFor(activePlanet), [activePlanet])
  const slotUnlockCosts = useMemo<Record<number, CurrencyPurse>>(() => {
    const out: Record<number, CurrencyPurse> = {}
    for (const [k, pat] of Object.entries(SLOT_UNLOCK_PATTERN)) {
      out[Number(k)] = resolveSDCost(activePlanet, pat)
    }
    return out
  }, [activePlanet])
  const slotUnlockGates = useMemo<Record<number, BodyId>>(() => {
    const tonicIdx = SCALE_INDEX_OF(activePlanet)
    const out: Record<number, BodyId> = {}
    for (const [k, off] of Object.entries(SLOT_UNLOCK_GATE_OFFSET)) {
      out[Number(k)] = BODIES[(tonicIdx + off) % 7].id
    }
    return out
  }, [activePlanet])
  const slot0CapacityCosts = useMemo<Record<number, CurrencyPurse>>(() => {
    const out: Record<number, CurrencyPurse> = {}
    for (const [k, pat] of Object.entries(SLOT0_CAPACITY_PATTERN)) {
      out[Number(k)] = resolveSDCost(activePlanet, pat)
    }
    return out
  }, [activePlanet])

  const updateActive = useCallback(
    (updater: (s: ResonatorState) => ResonatorState) => {
      setResonators((prev) => {
        const cur = prev[activePlanet]
        const next = updater(cur)
        if (next === cur) return prev
        return { ...prev, [activePlanet]: next }
      })
    },
    [activePlanet],
  )

  const noteYieldMul = useCallback(
    (id: BodyId) => noteYieldMultiplier(noteYieldLvls[id] ?? 0),
    [noteYieldLvls],
  )

  const earn = useCallback((delta: CurrencyPurse) => {
    const touched = (Object.keys(delta) as CurrencyKey[]).filter(
      (k) => (delta[k] ?? 0) > 0,
    )
    if (touched.length === 0) return
    updateActive((s) => {
      let seen = s.seenCurrencies
      let seenChanged = false
      for (const k of touched) {
        if (!seen.has(k)) {
          if (!seenChanged) {
            seen = new Set(seen)
            seenChanged = true
          }
          ;(seen as Set<CurrencyKey>).add(k)
        }
      }
      return {
        ...s,
        currencies: addToPurse(s.currencies, delta),
        seenCurrencies: seenChanged ? seen : s.seenCurrencies,
      }
    })
  }, [updateActive])

  const swellsRef = useRef<Map<BodyId, VoiceState>>(
    new Map(TARGETS.map((b) => [b.id, { held: VOICE_FLOOR_GAIN, releasing: false, armed: true }])),
  )
  const phaseRef = useRef<Map<BodyId, number>>(new Map())
  const tabRef = useRef<Tab>(tab)
  // The canvas raf reads this every frame to highlight the active planet's
  // dot in its pad color. Kept as a ref so the draw loop doesn't need to be
  // re-mounted (and its phase state reset) on every planet switch.
  const activePlanetRef = useRef<BodyId>(activePlanet)
  useEffect(() => {
    activePlanetRef.current = activePlanet
  }, [activePlanet])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const start = performance.now()
    let lastNow = start

    const draw = (now: number) => {
      const t = (now - start) / 1000
      const dt = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now

      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr
        canvas.height = cssH * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const cx = cssW / 2
      const cy = cssH / 2
      const rMax = Math.min(cssW, cssH) * 0.44
      const rMin = rMax * 0.22

      const styles = getComputedStyle(document.documentElement)
      const border = styles.getPropertyValue('--border').trim() || '#e5e4e7'
      const accent = styles.getPropertyValue('--accent').trim() || '#aa3bff'
      const accentBg = styles.getPropertyValue('--accent-bg').trim() || 'rgba(170,59,255,0.1)'
      const textH = styles.getPropertyValue('--text-h').trim() || '#08060d'
      const textM = styles.getPropertyValue('--text').trim() || '#6b6375'

      const earthAngle = ((t / EARTH_PERIOD_S) + EARTH.phase) * 2 * Math.PI

      const positions = ORBITS.map((body, i) => {
        const r = rMin + (rMax - rMin) * (i / (ORBITS.length - 1))
        const angle = ((t / periodOf(body)) + body.phase) * 2 * Math.PI
        let delta = Math.abs(((earthAngle - angle) % (2 * Math.PI)))
        if (delta > Math.PI) delta = 2 * Math.PI - delta
        return { body, angle, r, delta }
      })
      const earthPos = positions.find((p) => p.body.id === EARTH.id)!

      const swells = swellsRef.current

      for (const { body, delta } of positions) {
        if (body.id === EARTH.id) continue
        const s = swells.get(body.id)
        if (!s) continue
        const proximity = 1 - delta / Math.PI
        const target = VOICE_FLOOR_GAIN + (VOICE_PEAK_GAIN - VOICE_FLOOR_GAIN) * Math.pow(proximity, 3)
        if (s.releasing) {
          s.held += (VOICE_FLOOR_GAIN - s.held) * (1 - Math.exp(-dt / SWELL_RELEASE_TAU))
          if (s.held < VOICE_FLOOR_GAIN + 0.0005) {
            s.held = VOICE_FLOOR_GAIN
            s.releasing = false
          }
        } else if (s.armed && target > s.held) {
          s.held += (target - s.held) * (1 - Math.exp(-dt / SWELL_ATTACK_TAU))
        } else if (target < s.held) {
          s.held += (target - s.held) * (1 - Math.exp(-dt / SWELL_DECAY_TAU))
        }
        if (!s.armed && target < REARM_TARGET) s.armed = true
      }

      const a = audioRef.current
      const phases = phaseRef.current
      const audioReady = !!a && a.graph.ctx.state === 'running' && tabRef.current === 'orbits'
      const strike = (voice: ToneVoice, velocity: number) => {
        if (!audioReady) return
        const v = Math.max(0, Math.min(1, velocity))
        if (v < 0.001) return
        voice.synth.triggerAttackRelease(voice.freq, STRIKE_DURATION, undefined, v)
      }
      for (const { body } of positions) {
        const phase = ((t / periodOf(body)) + body.phase) % 1
        const last = phases.get(body.id)
        phases.set(body.id, phase)
        if (last === undefined) continue
        const wrapped = phase < last
        if (!wrapped) continue
        if (!audioReady) continue
        if (body.id === EARTH.id) {
          strike(a!.earth, EARTH_VELOCITY)
        } else {
          const voice = a!.voices.get(body.id)
          if (!voice) continue
          const s = swells.get(body.id)
          const norm = s
            ? (s.held - VOICE_FLOOR_GAIN) / (VOICE_PEAK_GAIN - VOICE_FLOOR_GAIN)
            : 0
          const velocity = STRIKE_FLOOR_VELOCITY + Math.pow(Math.max(0, norm), 0.7) * (1 - STRIKE_FLOOR_VELOCITY)
          strike(voice, velocity)
        }
      }

      ctx.strokeStyle = border
      ctx.lineWidth = 1
      for (const { r } of positions) {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, 2 * Math.PI)
        ctx.stroke()
      }

      ctx.fillStyle = accentBg
      let anyAligned = false
      for (const { body, angle, r, delta } of positions) {
        if (body.id === EARTH.id) continue
        const proximity = 1 - delta / Math.PI
        if (proximity > HALO_PROXIMITY) {
          const px = cx + Math.cos(angle) * r
          const py = cy + Math.sin(angle) * r
          ctx.beginPath()
          ctx.arc(px, py, 13, 0, 2 * Math.PI)
          ctx.fill()
          anyAligned = true
        }
      }
      if (anyAligned) {
        const ex = cx + Math.cos(earthPos.angle) * earthPos.r
        const ey = cy + Math.sin(earthPos.angle) * earthPos.r
        ctx.beginPath()
        ctx.arc(ex, ey, 14, 0, 2 * Math.PI)
        ctx.fill()
      }

      ctx.fillStyle = textM
      ctx.beginPath()
      ctx.arc(cx, cy, 2, 0, 2 * Math.PI)
      ctx.fill()

      // Body dot is the active planet's pad color when it's that planet,
      // accent when in alignment with Earth (visual "window open" cue —
      // even without launches it still teaches consonance), otherwise the
      // soft text colour.
      for (const { body, angle, r, delta } of positions) {
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        const isEarth = body.id === EARTH.id
        const isActive = body.id === activePlanetRef.current
        const proximity = 1 - delta / Math.PI
        const aligned = !isEarth && proximity > 0.85
        ctx.fillStyle = isActive
          ? PAD_COLORS[body.id] ?? accent
          : isEarth
            ? textH
            : aligned
              ? accent
              : textM
        ctx.beginPath()
        ctx.arc(px, py, isEarth ? 6 : isActive ? 6 : 5, 0, 2 * Math.PI)
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stopAudio = useCallback((audio: OrbitAudio) => {
    const { graph, voices, earth } = audio
    teardownAudioGraph(graph, [])
    window.setTimeout(() => {
      for (const v of voices.values()) {
        v.synth.dispose()
        v.panner.dispose()
      }
      earth.synth.dispose()
      earth.panner.dispose()
    }, 400)
  }, [])

  const buildAudio = useCallback((nextTimbre: Timbre): OrbitAudio | null => {
    const graph = createAudioGraph({ lowpassHz: 1500, fadeInS: 0.6 })
    if (!graph) return null

    setContext(new Context({ context: graph.ctx }))

    const buildVoice = (hz: number, pan: number): ToneVoice => {
      const synth = buildSynth(nextTimbre)
      const panner = new Panner(pan)
      synth.connect(panner)
      panner.connect(graph.master as unknown as AudioNode)
      return { synth, panner, freq: hz }
    }

    const earth = buildVoice(EARTH_HZ, 0)
    const voices = new Map<BodyId, ToneVoice>()
    TARGETS.forEach((body, i) => {
      const pan = -0.4 + (i / Math.max(1, TARGETS.length - 1)) * 0.8
      const hz = EARTH_HZ * body.ratio
      voices.set(body.id, buildVoice(hz, pan))
    })

    return { graph, voices, earth, timbre: nextTimbre }
  }, [])

  const handleSoundToggle = useCallback(() => {
    setAudioOn((on) => !on)
  }, [])

  const handleTimbreChange = useCallback((next: Timbre) => {
    setTimbre(next)
  }, [])

  const primePhases = useCallback(() => {
    phaseRef.current.clear()
    for (const body of BODIES) phaseRef.current.set(body.id, 0.999)
  }, [])

  useEffect(() => {
    if (!audioOn) return
    const audio = buildAudio(timbre)
    if (!audio) return
    audioRef.current = audio
    primePhases()

    let unlock: (() => void) | null = null
    const removeUnlock = () => {
      if (!unlock) return
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      unlock = null
    }
    if (audio.graph.ctx.state !== 'running') {
      unlock = () => {
        removeUnlock()
        audio.graph.ctx
          .resume()
          .then(() => {
            primePhases()
          })
          .catch(() => {})
      }
      window.addEventListener('pointerdown', unlock)
      window.addEventListener('keydown', unlock)
    }

    return () => {
      removeUnlock()
      if (audioRef.current === audio) {
        audioRef.current = null
        stopAudio(audio)
      }
    }
  }, [audioOn, timbre, buildAudio, stopAudio, primePhases])

  useEffect(() => {
    tabRef.current = tab
    const audio = audioRef.current
    if (!audio) return
    const master = audio.graph.master
    const ctx = audio.graph.ctx
    const t0 = ctx.currentTime
    master.gain.cancelScheduledValues(t0)
    master.gain.setValueAtTime(master.gain.value, t0)
    if (tab === 'orbits') {
      master.gain.linearRampToValueAtTime(1, t0 + 0.2)
      primePhases()
    } else {
      master.gain.linearRampToValueAtTime(0, t0 + 0.05)
    }
  }, [tab, primePhases])

  const idleRate = useMemo(
    () => computeIdleRate(slots, autoPluckSlots, noteYieldLvls, YIELD_STEP),
    [slots, autoPluckSlots, noteYieldLvls],
  )
  const anyAutoPluck = autoPluckSlots.size > 0

  // Per-planet idle accrual. Every planet's resonator gets its auto-pluck
  // rate credited to its own purse. The active planet is fed by HarvestStage's
  // live auto-pluck timers (which call earn → updateActive) while the player
  // is on the Resonator tab, so we skip it here to avoid double-counting;
  // every other planet, and the active planet whenever the player is on the
  // Orbits tab, accrues here. Stays one interval covering all 7 planets so
  // their clocks share a single dt and don't drift apart.
  useEffect(() => {
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      if (dt <= 0) return
      setResonators((prev) => {
        let nextRecord: Record<BodyId, ResonatorState> | null = null
        for (const b of BODIES) {
          const planetId = b.id
          if (planetId === activePlanet && tabRef.current === 'harvest') continue
          const s = prev[planetId]
          if (s.autoPluckSlots.size === 0) continue
          const rate = computeIdleRate(s.slots, s.autoPluckSlots, s.noteYieldLvls, YIELD_STEP)
          const delta: CurrencyPurse = {}
          let any = false
          for (const k of Object.keys(rate) as CurrencyKey[]) {
            const r = rate[k] ?? 0
            if (r > 0) {
              delta[k] = r * dt
              any = true
            }
          }
          if (!any) continue
          let seen = s.seenCurrencies
          let seenChanged = false
          for (const k of Object.keys(delta) as CurrencyKey[]) {
            if (!seen.has(k)) {
              if (!seenChanged) {
                seen = new Set(seen)
                seenChanged = true
              }
              ;(seen as Set<CurrencyKey>).add(k)
            }
          }
          if (!nextRecord) nextRecord = { ...prev }
          nextRecord[planetId] = {
            ...s,
            currencies: addToPurse(s.currencies, delta),
            seenCurrencies: seenChanged ? seen : s.seenCurrencies,
          }
        }
        return nextRecord ?? prev
      })
    }, 250)
    return () => window.clearInterval(id)
  }, [activePlanet])

  const handleSlotChange = useCallback((slotIdx: number, newNotes: readonly BodyId[]) => {
    updateActive((s) => {
      const next = s.slots.map((row) => row.slice())
      for (const note of newNotes) {
        for (let i = 0; i < next.length; i++) {
          if (i !== slotIdx) next[i] = next[i].filter((n) => n !== note)
        }
      }
      next[slotIdx] = newNotes.slice()
      return { ...s, slots: next }
    })
  }, [updateActive])

  const handleUnlock = useCallback((id: BodyId) => {
    updateActive((s) => {
      if (s.unlockedIds.includes(id)) return s
      const cost = unlockCosts[id]
      if (!cost || !canAffordPurse(s.currencies, cost)) return s
      const seen = s.seenCurrencies.has(id) ? s.seenCurrencies : new Set(s.seenCurrencies).add(id)
      return {
        ...s,
        currencies: subtractCost(s.currencies, cost),
        unlockedIds: [...s.unlockedIds, id],
        seenCurrencies: seen,
      }
    })
  }, [updateActive, unlockCosts])

  const handleUnlockAutoPluck = useCallback((slotIdx: number) => {
    updateActive((s) => {
      if (s.autoPluckSlots.has(slotIdx)) return s
      if (slotIdx >= s.slotCount) return s
      if (s.unlockedIds.length < AUTO_PLUCK_MIN_UNLOCKS) return s
      const cost = autoPluckCostFor(activePlanet, slotIdx)
      if (!canAffordPurse(s.currencies, cost)) return s
      const nextAuto = new Set(s.autoPluckSlots)
      nextAuto.add(slotIdx)
      return {
        ...s,
        currencies: subtractCost(s.currencies, cost),
        autoPluckSlots: nextAuto,
      }
    })
  }, [updateActive, activePlanet])

  const handleUnlockSlot = useCallback(() => {
    updateActive((s) => {
      const nextIdx = s.slotCount
      if (nextIdx >= MAX_SLOT_COUNT) return s
      const cost = slotUnlockCosts[nextIdx + 1]
      if (!cost) return s
      if (!canAffordPurse(s.currencies, cost)) return s
      return {
        ...s,
        currencies: subtractCost(s.currencies, cost),
        slotCount: s.slotCount + 1,
        slots: [...s.slots, []],
      }
    })
  }, [updateActive, slotUnlockCosts])

  const handleUpgradeSlot0Capacity = useCallback(() => {
    updateActive((s) => {
      const nextCap = s.slot0Capacity + 1
      if (nextCap > MAX_SLOT0_CAPACITY) return s
      const cost = slot0CapacityCosts[nextCap]
      if (!cost) return s
      if (!canAffordPurse(s.currencies, cost)) return s
      return {
        ...s,
        currencies: subtractCost(s.currencies, cost),
        slot0Capacity: nextCap,
      }
    })
  }, [updateActive, slot0CapacityCosts])

  const buyNoteYield = useCallback(
    (id: BodyId) => {
      updateActive((s) => {
        const lvl = s.noteYieldLvls[id] ?? 0
        const cost = noteYieldCost(id, lvl)
        if (!canAffordPurse(s.currencies, cost)) return s
        return {
          ...s,
          currencies: subtractCost(s.currencies, cost),
          noteYieldLvls: { ...s.noteYieldLvls, [id]: lvl + 1 },
        }
      })
    },
    [updateActive],
  )

  const yieldAffordable = useMemo(() => {
    const s = new Set<BodyId>()
    for (const id of unlockedIds) {
      const lvl = noteYieldLvls[id] ?? 0
      const cost = noteYieldCost(id, lvl)
      const costNote = FIFTH_NEXT[id]
      if (unlockedIds.includes(costNote) && canAffordPurse(currencies, cost)) s.add(id)
    }
    return s
  }, [unlockedIds, noteYieldLvls, currencies])

  const yieldCostNoteOf = useCallback((id: BodyId) => FIFTH_NEXT[id], [])

  const getYieldInfo = useCallback(
    (id: BodyId) => {
      const lvl = noteYieldLvls[id] ?? 0
      const mul = noteYieldMultiplier(lvl)
      const nextMul = mul * YIELD_STEP
      const costNote = FIFTH_NEXT[id]
      const costAmount = Math.round(NOTE_YIELD_BASE * COST_STEP ** lvl)
      return { lvl, mul, nextMul, costAmount, costNote }
    },
    [noteYieldLvls],
  )

  // Dev cheat: press 'y' to unlock all notes + grant currencies for yield testing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'y' || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      updateActive((s) => {
        const allIds = BODIES.map((b) => b.id)
        const grant: CurrencyPurse = {}
        for (const id of allIds) grant[id] = 500
        for (const k of FREQ_CURRENCY_KEYS) grant[k] = 100
        const seen = new Set(s.seenCurrencies)
        for (const k of Object.keys(grant) as CurrencyKey[]) seen.add(k)
        return {
          ...s,
          currencies: addToPurse(s.currencies, grant),
          unlockedIds: allIds,
          seenCurrencies: seen,
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [updateActive])

  // Progressive disclosure: only show 1 card per category at any time so the
  // panel stays a punch-list of the next concrete action, not a wall of
  // hypotheticals. Once the player buys it, the next candidate slides in.
  const nextUnlocks = unlockLadder.filter((id) => !unlockedIds.includes(id)).slice(0, 1)
  const nextSlotIdx = slotCount + 1
  const slotGate = slotUnlockGates[nextSlotIdx]
  const slotGatePassed = slotGate ? unlockedIds.includes(slotGate) : true
  const nextSlotCost = slotGatePassed ? slotUnlockCosts[nextSlotIdx] : undefined
  const canAffordSlot = nextSlotCost ? canAffordPurse(currencies, nextSlotCost) : false
  const nextSlot0Cap = slot0Capacity + 1
  const slot0CapCost =
    nextSlot0Cap <= MAX_SLOT0_CAPACITY && unlockedIds.length >= 2
      ? slot0CapacityCosts[nextSlot0Cap]
      : undefined
  const canAffordSlot0Cap = slot0CapCost ? canAffordPurse(currencies, slot0CapCost) : false
  const autoPluckGate = unlockedIds.length >= AUTO_PLUCK_MIN_UNLOCKS
  const autoPluckSlotsToOffer = autoPluckGate
    ? Array.from({ length: slotCount }, (_, i) => i)
        .filter((i) => !autoPluckSlots.has(i))
        .slice(0, 1)
    : []

  const yieldPanelUnlocked = unlockLadder.every((id) => unlockedIds.includes(id))
  type YieldOption = { id: BodyId; lvl: number; cost: CurrencyPurse; costNote: BodyId; gateUnlocked: boolean; progress: number; affordable: boolean }
  const yieldOptions: YieldOption[] = yieldPanelUnlocked
    ? unlockedIds.map((id) => {
        const lvl = noteYieldLvls[id] ?? 0
        const cost = noteYieldCost(id, lvl)
        const costNote = FIFTH_NEXT[id]
        const gateUnlocked = unlockedIds.includes(costNote)
        const progress = gateUnlocked ? costProgress(currencies, cost) : 0
        const affordable = gateUnlocked && canAffordPurse(currencies, cost)
        return { id, lvl, cost, costNote, gateUnlocked, progress, affordable }
      })
    : []
  const affordableYieldOptions = yieldOptions.filter((o) => o.affordable)

  // Aggregate every visible buy that's currently affordable, in display
  // order. Feeds both the scroll cue under the currencies panel and the
  // tiny "this purse is contributing to a ready buy" dot on the chips
  // themselves — same source of truth, two views.
  type ReadyBuy = { label: string; costKeys: CurrencyKey[] }
  const readyBuys: ReadyBuy[] = []
  for (const id of nextUnlocks) {
    const cost = unlockCosts[id]
    if (cost && canAffordPurse(currencies, cost)) {
      readyBuys.push({
        label: `Unlock ${id}`,
        costKeys: (Object.keys(cost) as CurrencyKey[]).filter((k) => (cost[k] ?? 0) > 0),
      })
    }
  }
  if (nextSlotCost && canAffordSlot) {
    readyBuys.push({
      label: `Slot ${nextSlotIdx}`,
      costKeys: (Object.keys(nextSlotCost) as CurrencyKey[]).filter(
        (k) => (nextSlotCost[k] ?? 0) > 0,
      ),
    })
  }
  if (slot0CapCost && canAffordSlot0Cap) {
    readyBuys.push({
      label: `Stack ${nextSlot0Cap}`,
      costKeys: (Object.keys(slot0CapCost) as CurrencyKey[]).filter(
        (k) => (slot0CapCost[k] ?? 0) > 0,
      ),
    })
  }
  for (const slotIdx of autoPluckSlotsToOffer) {
    const cost = autoPluckCostFor(activePlanet, slotIdx)
    if (canAffordPurse(currencies, cost)) {
      readyBuys.push({
        label: `Auto slot ${slotIdx + 1}`,
        costKeys: (Object.keys(cost) as CurrencyKey[]).filter((k) => (cost[k] ?? 0) > 0),
      })
    }
  }
  for (const opt of affordableYieldOptions) {
    readyBuys.push({
      label: `${opt.id} yield`,
      costKeys: (Object.keys(opt.cost) as CurrencyKey[]).filter(
        (k) => (opt.cost[k] ?? 0) > 0,
      ),
    })
  }
  const readyChipKeys = new Set<CurrencyKey>()
  for (const b of readyBuys) for (const k of b.costKeys) readyChipKeys.add(k)

  const scrollToProgress = useCallback(() => {
    progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Tapping a planet routes to that planet's resonator. Each planet has its
  // own isolated purse, ladder, slots, and yield levels — switching planet
  // swaps the entire slice the Resonator tab is wired to.
  const onActivatePlanet = useCallback((body: Body) => {
    setActivePlanet(body.id)
    setTab('harvest')
  }, [])

  const visibleNoteCurrencies = NOTE_CURRENCIES.filter(
    (k) => seenCurrencies.has(k) || (currencies[k] ?? 0) > 0,
  )
  const visibleFreqs = FREQ_CURRENCY_KEYS.filter(
    (k) => seenCurrencies.has(k) || (currencies[k] ?? 0) > 0,
  )
  const visibleIdleEntries: Array<{
    k: CurrencyKey
    label: string
    rate: number
    color: string
  }> = []
  for (const k of NOTE_CURRENCIES) {
    const rate = idleRate[k] ?? 0
    if (rate > 0) {
      visibleIdleEntries.push({ k, label: k, rate, color: PAD_COLORS[k] ?? 'var(--text)' })
    }
  }
  for (const k of FREQ_CURRENCY_KEYS) {
    const rate = idleRate[k] ?? 0
    if (rate > 0) {
      visibleIdleEntries.push({
        k,
        label: displayCurrencyKey(k),
        rate,
        color: FREQ_COLORS[k],
      })
    }
  }

  return (
    <main>
      <PageChrome />
      <div className="folio-mark" aria-hidden="true">
        <span>Folio I · Recto</span>
        <span>An. MMXXVI</span>
      </div>
      <h1>Orbital<span className="title-dot" aria-hidden="true">.</span></h1>
      <p className="tagline">
        {tab === 'orbits'
          ? 'Diatonic wheel · tap a body to enter its resonator · hold for details'
          : `Resonator · ${BODIES.find((b) => b.id === activePlanet)?.name ?? activePlanet} (${activePlanet}) · isolated purse, ladder, and slots`}
      </p>
      <nav className="tabs" role="tablist" aria-label="Stage">
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'orbits' ? ' on' : ''}`}
          aria-selected={tab === 'orbits'}
          onClick={() => setTab('orbits')}
        >
          <span className="tab-cap" aria-hidden="true">Cap. I</span>
          <span className="tab-name">Orbits</span>
          <span className="tab-sub" aria-hidden="true">the diatonic wheel</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'harvest' ? ' on' : ''}`}
          aria-selected={tab === 'harvest'}
          onClick={() => setTab('harvest')}
        >
          <span className="tab-cap" aria-hidden="true">Cap. II</span>
          <span className="tab-name">Resonator</span>
          <span className="tab-sub" aria-hidden="true">plucks &amp; coincidences</span>
        </button>
      </nav>
      <section className="currencies-panel" aria-label="Currencies">
        <ul className="cur-row cur-notes" role="list" aria-label="Note currencies">
          {visibleNoteCurrencies.length === 0 ? (
            <li className="cur-empty">tap a slot to mint your first currency</li>
          ) : (
            visibleNoteCurrencies.map((k) => {
              const v = currencies[k] ?? 0
              const color = PAD_COLORS[k]
              const ready = readyChipKeys.has(k)
              return (
                <li
                  key={k}
                  className={`cur-chip cur-chip-note${ready ? ' cur-chip-ready' : ''}`}
                  data-cur-key={k}
                  style={{ ['--chip-color' as string]: color }}
                  title={
                    ready
                      ? `${k} — minted by tapping ${k} (contributing to a ready buy)`
                      : `${k} — minted by tapping ${k}`
                  }
                >
                  <span className="cur-swatch" aria-hidden="true" />
                  <span className="cur-key">{k}</span>
                  <span className="cur-value">{formatCurrency(v)}</span>
                </li>
              )
            })
          )}
        </ul>
        {visibleFreqs.length > 0 && (
          <ul className="cur-row cur-harmonics" role="list" aria-label="Frequency currencies">
            {visibleFreqs.map((k) => {
              const v = currencies[k] ?? 0
              const color = FREQ_COLORS[k]
              const ratio = FREQ_LABEL_BY_KEY[k]
              const interval = FREQ_INTERVAL_LABEL[k] ?? ''
              const sources = FREQ_SOURCES[k] ?? []
              const sourceText = sources.join('×') || '—'
              const ready = readyChipKeys.has(k)
              return (
                <li
                  key={k}
                  className={`cur-chip cur-chip-harm${ready ? ' cur-chip-ready' : ''}`}
                  data-cur-key={k}
                  style={{ ['--chip-color' as string]: color }}
                  title={`ƒ${ratio} · ${interval} — minted when ${sourceText} partials coincide at ${ratio}·tonic`}
                >
                  <span className="cur-key">ƒ{ratio}</span>
                  {interval && <span className="cur-interval">{interval}</span>}
                  <span className="cur-value">{formatCurrency(v)}</span>
                  {sources.length > 0 && (
                    <span className="cur-sources" aria-hidden="true">
                      {sources.map((id) => (
                        <span
                          key={id}
                          className="cur-source"
                          style={{ background: PAD_COLORS[id] ?? 'var(--text)' }}
                        />
                      ))}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {tab === 'harvest' && readyBuys.length > 0 && (
          <button
            type="button"
            className="cur-ready-cue"
            onClick={scrollToProgress}
            aria-label={`${readyBuys.length} buy${readyBuys.length === 1 ? '' : 's'} ready — scroll to progression panel`}
          >
            <span aria-hidden="true">▼</span>
            <span>
              {readyBuys.length === 1
                ? `${readyBuys[0].label} ready`
                : `${readyBuys.length} ready`}
            </span>
          </button>
        )}
      </section>
      <section className="stage" hidden={tab !== 'orbits'} aria-hidden={tab !== 'orbits'}>
        <div className="controls">
          <button
            type="button"
            className={`sound${audioOn ? ' on' : ''}`}
            onClick={handleSoundToggle}
            aria-pressed={audioOn}
            aria-label={audioOn ? 'Mute drone' : 'Play drone'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor" />
              {audioOn ? (
                <>
                  <path d="M16 9 Q18 12 16 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M18 7 Q21 12 18 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </>
              ) : (
                <path d="M16 9 L21 14 M21 9 L16 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <div className="timbres" role="radiogroup" aria-label="Timbre">
            {TIMBRES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={timbre === t}
                className={`timbre${timbre === t ? ' on' : ''}`}
                onClick={() => handleTimbreChange(t)}
              >
                {TIMBRE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="orbit-plate">
          <OrbitEngraving />
          <canvas
            ref={canvasRef}
            className="orbit"
            aria-label="Seven bodies on a diatonic wheel"
          />
        </div>
        <ul className="tiles" role="list">
          {BODIES.map((body) => (
            <li key={body.id}>
              <PlanetTile
                body={body}
                active={body.id === activePlanet}
                onActivate={() => onActivatePlanet(body)}
                onLongPress={() => setUpgradeFor(body)}
              />
            </li>
          ))}
        </ul>
        {upgradeFor && (
          <UpgradePanel body={upgradeFor} onClose={() => setUpgradeFor(null)} />
        )}
      </section>
      {tab === 'harvest' && (
        <>
          <HarvestStage
            key={activePlanet}
            unlockedIds={unlockedIds}
            slots={slots}
            slotCount={slotCount}
            slotCapacities={slotCapacities}
            autoPluckSlots={autoPluckSlots}
            noteYieldMul={noteYieldMul}
            onSlotChange={handleSlotChange}
            onEarn={earn}
            yieldUnlocked={yieldPanelUnlocked}
            noteYieldLvls={noteYieldLvls}
            yieldAffordable={yieldAffordable}
            yieldCostNote={yieldCostNoteOf}
            yieldInfo={getYieldInfo}
            onBuyYield={buyNoteYield}
          />
          <section ref={progressRef} className="resonator-progress" aria-label="Progression">
            {anyAutoPluck && visibleIdleEntries.length > 0 && (
              <div className="prog-section prog-idle" aria-label="Idle rate">
                <h3 className="prog-h">
                  <span className="prog-h-label">Idle</span>
                  <span className="prog-h-sub">earning while you watch</span>
                </h3>
                <p className="idle-rate">
                  {visibleIdleEntries.map(({ k, label, rate, color }) => (
                    <span
                      key={k}
                      className="idle-pill"
                      style={{ ['--chip-color' as string]: color }}
                    >
                      <strong>{rate.toFixed(2)}</strong>
                      <span>{label}/s</span>
                    </span>
                  ))}
                </p>
              </div>
            )}
            {(nextUnlocks.length > 0 ||
              nextSlotCost ||
              slot0CapCost ||
              autoPluckSlotsToOffer.length > 0) && (
              <div className="prog-section prog-unlocks">
                <h3 className="prog-h">
                  <span className="prog-h-label">Next</span>
                </h3>
                <ul className="unlocks" role="list">
                  {nextUnlocks.map((id, i) => {
                    const cost = unlockCosts[id] ?? {}
                    const affordable = canAffordPurse(currencies, cost)
                    const progress = costProgress(currencies, cost)
                    const color = PAD_COLORS[id] ?? 'var(--accent)'
                    return (
                      <li
                        key={id}
                        className={`unlock unlock-note${i === 0 ? ' next' : ''}${affordable ? ' affordable' : ''}`}
                        style={{ ['--chip-color' as string]: color }}
                      >
                        <header className="unlock-head">
                          <span className="unlock-kind">Note</span>
                          <span className="unlock-title">
                            <span
                              className="unlock-swatch"
                              aria-hidden="true"
                              style={{ background: color }}
                            />
                            {id}
                          </span>
                          {affordable && <ReadyBadge />}
                        </header>
                        <CostChips cost={cost} purse={currencies} />
                        {!affordable && <ShortHint cost={cost} purse={currencies} />}
                        <span
                          className="unlock-progress"
                          style={{ ['--p' as string]: progress.toFixed(3) }}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className="unlock-btn"
                          disabled={!affordable}
                          onClick={() => handleUnlock(id)}
                        >
                          Unlock {id}
                        </button>
                      </li>
                    )
                  })}
                  {nextSlotCost && (
                    <li
                      className={`unlock unlock-slot next${canAffordSlot ? ' affordable' : ''}`}
                      style={{ ['--chip-color' as string]: 'var(--accent)' }}
                    >
                      <header className="unlock-head">
                        <span className="unlock-kind">Slot</span>
                        <span className="unlock-title">Slot {nextSlotIdx}</span>
                        {canAffordSlot && <ReadyBadge />}
                      </header>
                      <span className="unlock-desc">
                        {nextSlotIdx === 2
                          ? 'a home for your second note'
                          : '3-note resonance unlocks'}
                      </span>
                      <CostChips cost={nextSlotCost} purse={currencies} />
                      {!canAffordSlot && <ShortHint cost={nextSlotCost} purse={currencies} />}
                      <span
                        className="unlock-progress"
                        style={{
                          ['--p' as string]: costProgress(currencies, nextSlotCost).toFixed(3),
                        }}
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        className="unlock-btn"
                        disabled={!canAffordSlot}
                        onClick={handleUnlockSlot}
                      >
                        Unlock slot {nextSlotIdx}
                      </button>
                    </li>
                  )}
                  {slot0CapCost && (
                    <li
                      className={`unlock unlock-stack${canAffordSlot0Cap ? ' affordable' : ''}`}
                      style={{ ['--chip-color' as string]: 'var(--accent)' }}
                    >
                      <header className="unlock-head">
                        <span className="unlock-kind">Stack</span>
                        <span className="unlock-title">
                          Slot 1 · {slot0Capacity} → {nextSlot0Cap}
                        </span>
                        {canAffordSlot0Cap && <ReadyBadge />}
                      </header>
                      <span className="unlock-desc">play a chord on every tap</span>
                      <CostChips cost={slot0CapCost} purse={currencies} />
                      {!canAffordSlot0Cap && (
                        <ShortHint cost={slot0CapCost} purse={currencies} />
                      )}
                      <span
                        className="unlock-progress"
                        style={{
                          ['--p' as string]: costProgress(currencies, slot0CapCost).toFixed(3),
                        }}
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        className="unlock-btn"
                        disabled={!canAffordSlot0Cap}
                        onClick={handleUpgradeSlot0Capacity}
                      >
                        Stack to {nextSlot0Cap}
                      </button>
                    </li>
                  )}
                  {autoPluckSlotsToOffer.map((slotIdx) => {
                    const cost = autoPluckCostFor(activePlanet, slotIdx)
                    const affordable = canAffordPurse(currencies, cost)
                    const progress = costProgress(currencies, cost)
                    return (
                      <li
                        key={`auto-${slotIdx}`}
                        className={`unlock unlock-auto${affordable ? ' affordable' : ''}`}
                        style={{ ['--chip-color' as string]: 'var(--accent)' }}
                      >
                        <header className="unlock-head">
                          <span className="unlock-kind">Auto ⚡</span>
                          <span className="unlock-title">Slot {slotIdx + 1}</span>
                          {affordable && <ReadyBadge />}
                        </header>
                        <span className="unlock-desc">half yield, fires itself</span>
                        <CostChips cost={cost} purse={currencies} />
                        {!affordable && <ShortHint cost={cost} purse={currencies} />}
                        <span
                          className="unlock-progress"
                          style={{ ['--p' as string]: progress.toFixed(3) }}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className="unlock-btn"
                          disabled={!affordable}
                          onClick={() => handleUnlockAutoPluck(slotIdx)}
                        >
                          Auto-pluck slot {slotIdx + 1}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
