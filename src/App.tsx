import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AMSynth, Context, FMSynth, Panner, PluckSynth, setContext } from 'tone'
import './App.css'
import type { AudioGraph } from './audio'
import { createAudioGraph, teardownAudioGraph } from './audio'
import type { Body, BodyId } from './bodies'
import {
  BODIES,
  C_REF_HZ,
  EARTH,
  inKeyPartialSet,
  intervalBetween,
  periodOf,
  routeToleranceMul,
} from './bodies'
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
  HARMONIC_COUNT,
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
import { PlanetTile } from './PlanetTile'
import { UpgradePanel } from './UpgradePanel'

type Tab = 'orbits' | 'harvest'

// --- Per-station state -------------------------------------------------
//
// Every planet hosts its own resonator. What used to be top-level App
// state (slot config, slot capacity, auto-pluck set, per-note yield
// levels) lives here, indexed by `station: BodyId`. The shared purse and
// the orbital canvas stay top-level — currencies are global, the wheel
// is global, the work that mints them is per-station.

type StationState = {
  // Has a probe ever landed here? (Earth is open from the start.) Locked
  // stations don't appear in the selector.
  unlocked: boolean
  slots: BodyId[][]
  slotCount: number
  slot0Capacity: number
  autoPluckSlots: ReadonlySet<number>
  noteYieldLvls: Partial<Record<BodyId, number>>
  // Stage 1: exports unlocked. Exportable always starts as {tonic} and
  // expands as yield upgrades land on in-key partials.
  stage1: boolean
  exportable: ReadonlySet<BodyId>
  // Stage 2: this station's voice chimes into the orbital drone.
  stage2: boolean
}

const emptyStation = (body: Body): StationState => ({
  unlocked: false,
  slots: [[body.id]],
  slotCount: INITIAL_SLOT_COUNT,
  slot0Capacity: 1,
  autoPluckSlots: new Set(),
  noteYieldLvls: {},
  stage1: false,
  exportable: new Set(),
  stage2: false,
})

const initialStations = (): Record<BodyId, StationState> => {
  const out = {} as Record<BodyId, StationState>
  for (const b of BODIES) out[b.id] = emptyStation(b)
  out.C.unlocked = true
  return out
}

// Stage-1 gate: every slot unlocked + auto-pluck on slot 0.
const isStage1Ready = (s: StationState) =>
  s.slotCount >= MAX_SLOT_COUNT && s.autoPluckSlots.has(0)

// Stage-2 gate: yield level ≥ 1 for every in-key partial of this station.
const isStage2Ready = (s: StationState, inKey: readonly BodyId[]) =>
  inKey.length > 0 && inKey.every((id) => (s.noteYieldLvls[id] ?? 0) >= 1)

// Promote a station through any stage / export-set updates it has earned.
// Idempotent — already-graduated stages stay graduated. Run inside every
// state mutation that touches a gate-relevant field.
function promoteStation(s: StationState, body: Body): StationState {
  const inKey = inKeyPartialSet(body, HARMONIC_COUNT)
  let next = s
  if (!next.stage1 && isStage1Ready(next)) {
    next = { ...next, stage1: true, exportable: new Set([body.id]) }
  }
  if (next.stage1) {
    const exp = new Set(next.exportable)
    let changed = false
    for (const id of inKey) {
      if ((next.noteYieldLvls[id] ?? 0) >= 1 && !exp.has(id)) {
        exp.add(id)
        changed = true
      }
    }
    if (changed) next = { ...next, exportable: exp }
  }
  if (!next.stage2 && next.stage1 && isStage2Ready(next, inKey)) {
    next = { ...next, stage2: true }
  }
  return next
}

// --- Cost tables --------------------------------------------------------
//
// All costs are CurrencyPurse over the 16 currencies. Note-currencies
// (C..B) come from tapping that note at any station whose harmonic series
// includes it; freq-currencies (F3..F15_2) come from landing a partial
// coincidence at that frequency. The currency set is global and the same
// at every station — what changes per station is *which notes the slot
// pickers offer* (only the station's in-key partials).
//
// Per-station unlock progression is gone — new stations open up via probe
// arrivals. What's left at the station level is slot/auto-pluck/yield
// scaling. Costs deliberately demand a mix of pitch-class and freq
// currencies so progressing one station still rewards another's exports.

const AUTO_PLUCK_BASE_COST: CurrencyPurse = {
  C: 120,
  E: 80,
  G: 60,
  F: 40,
  F3: 8,
  F5: 8,
  F4: 8,
  F6: 8,
}
const autoPluckCost = (slotIdx: number): CurrencyPurse => {
  const factor = 1.6 ** slotIdx
  const out: CurrencyPurse = {}
  for (const k of Object.keys(AUTO_PLUCK_BASE_COST) as CurrencyKey[]) {
    out[k] = Math.round((AUTO_PLUCK_BASE_COST[k] ?? 0) * factor)
  }
  return out
}

// Slot 2 is cheap — with one slot you can't land a coincidence yet, so
// the price stays in pure note currency. Slot 3 demands freq currency
// because by then a pair of slots has been ringing together for a while.
const SLOT_UNLOCK_COSTS: Record<number, CurrencyPurse> = {
  2: { C: 6 },
  3: { C: 30, E: 18, G: 12, F3: 4, F5: 6 },
}

// Slot 0 capacity ladder — stacking chords.
const SLOT0_CAPACITY_COSTS: Record<number, CurrencyPurse> = {
  2: { E: 30, G: 20, F5: 6, F15_2: 4 },
  3: { F: 50, A: 30, F3: 6, F4: 6, F5: 6, F15_2: 6 },
}

// --- Per-note yield upgrades --------------------------------------------
//
// Replaces the two global Tone/Resonance yield levers. Each note has its
// own yield level; level n gives a YIELD_STEP^n multiplier on the
// NoteCurrency that note mints per tap. Cost grows by COST_STEP per level
// and is paid in the **next note up the circle of fifths' currency** —
// you have to play your dominant to upgrade your tonic. The cycle within
// the diatonic set is C→G→D→A→E→B→F→C.
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

const PROBE_DURATION_S = 1.4
// Base proximity threshold for arming launches. Per-route tolerance
// multipliers (routeToleranceMul) stretch this so consonant pairs arm
// easily and tritone routes demand tight phase alignment.
const HALO_PROXIMITY_BASE = 0.93

// Reference C3 (130.81 Hz). Each body's 12-TET ratio places it on the
// diatonic scale: C3, D3, E3, F3, G3, A3, B3.
const EARTH_HZ = C_REF_HZ

const VOICE_FLOOR_GAIN = 0.002
const VOICE_PEAK_GAIN = 0.16
const SWELL_ATTACK_TAU = 1.8
const SWELL_DECAY_TAU = 3.5
const SWELL_RELEASE_TAU = 0.55
const LAUNCH_ARM_GAIN = VOICE_PEAK_GAIN * 0.55
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

type Probe = { startMs: number; source: BodyId; cargo: CurrencyPurse }
type ArmedMap = Partial<Record<BodyId, boolean>>
type VoiceState = { held: number; releasing: boolean; armed: boolean }
type ToneVoice = {
  synth: PluckSynth | FMSynth | AMSynth
  panner: Panner
  freq: number
}
type OrbitAudio = {
  graph: AudioGraph
  voices: Map<BodyId, ToneVoice>
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
  const probesRef = useRef<Map<BodyId, Probe>>(new Map())
  const armedRef = useRef<ArmedMap>({})
  const [armed, setArmed] = useState<ArmedMap>({})
  const [flying, setFlying] = useState<Set<BodyId>>(() => new Set())
  const [upgradeFor, setUpgradeFor] = useState<Body | null>(null)
  const [audioOn, setAudioOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  })
  const [timbre, setTimbre] = useState<Timbre>('piano')
  const audioRef = useRef<OrbitAudio | null>(null)
  const [tab, setTab] = useState<Tab>('harvest')
  const [currencies, setCurrencies] = useState<CurrencyPurse>({})
  const [seenCurrencies, setSeenCurrencies] = useState<Set<CurrencyKey>>(() => new Set(['C']))
  const [stations, setStations] = useState<Record<BodyId, StationState>>(initialStations)
  const [activeStationId, setActiveStationId] = useState<BodyId>('C')

  const activeBody = useMemo(
    () => BODIES.find((b) => b.id === activeStationId) ?? EARTH,
    [activeStationId],
  )
  const activeStation = stations[activeStationId]
  const activeInKey = useMemo(
    () => inKeyPartialSet(activeBody, HARMONIC_COUNT),
    [activeBody],
  )
  const unlockedStations = useMemo(
    () => BODIES.filter((b) => stations[b.id].unlocked),
    [stations],
  )

  const slotCapacities = useMemo(
    () =>
      Array.from({ length: activeStation.slotCount }, (_, i) =>
        i === 0 ? activeStation.slot0Capacity : 1,
      ),
    [activeStation.slotCount, activeStation.slot0Capacity],
  )

  const noteYieldMul = useCallback(
    (id: BodyId) => noteYieldMultiplier(activeStation.noteYieldLvls[id] ?? 0),
    [activeStation.noteYieldLvls],
  )

  const updateStation = useCallback(
    (id: BodyId, mut: (s: StationState) => StationState) => {
      setStations((prev) => {
        const body = BODIES.find((b) => b.id === id)
        if (!body) return prev
        const mutated = mut(prev[id])
        return { ...prev, [id]: promoteStation(mutated, body) }
      })
    },
    [],
  )

  const devFinishActiveStation = useCallback(() => {
    updateStation(activeStationId, (s) => {
      const inKey = inKeyPartialSet(activeBody, HARMONIC_COUNT)
      const tonic = activeBody.id
      const slotNotes = [
        Array.from({ length: MAX_SLOT0_CAPACITY }, (_, i) => inKey[i] ?? tonic),
        [inKey[1] ?? tonic],
        [inKey[2] ?? tonic],
      ]
      const yields: Partial<Record<BodyId, number>> = { ...s.noteYieldLvls }
      for (const id of inKey) yields[id] = Math.max(1, yields[id] ?? 0)
      return {
        ...s,
        unlocked: true,
        slotCount: MAX_SLOT_COUNT,
        slot0Capacity: MAX_SLOT0_CAPACITY,
        slots: slotNotes,
        autoPluckSlots: new Set([0, 1, 2]),
        noteYieldLvls: yields,
      }
    })
  }, [updateStation, activeStationId, activeBody])

  const earn = useCallback((delta: CurrencyPurse) => {
    const touched = (Object.keys(delta) as CurrencyKey[]).filter(
      (k) => (delta[k] ?? 0) > 0,
    )
    if (touched.length === 0) return
    setCurrencies((prev) => addToPurse(prev, delta))
    setSeenCurrencies((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const k of touched) {
        if (!next.has(k)) {
          next.add(k)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])
  const earnRef = useRef(earn)
  useEffect(() => {
    earnRef.current = earn
  }, [earn])

  const swellsRef = useRef<Map<BodyId, VoiceState>>(
    new Map(BODIES.map((b) => [b.id, { held: VOICE_FLOOR_GAIN, releasing: false, armed: true }])),
  )
  const launchRequestRef = useRef<BodyId | null>(null)
  const phaseRef = useRef<Map<BodyId, number>>(new Map())
  const tabRef = useRef<Tab>(tab)
  // Ref-mirrored values so the rAF canvas loop reads the latest active
  // station / per-route tolerance / stage-2 set without re-installing the
  // effect on every state change.
  const activeStationRef = useRef<BodyId>(activeStationId)
  useEffect(() => {
    activeStationRef.current = activeStationId
  }, [activeStationId])
  const routeTolMulRef = useRef<Partial<Record<BodyId, number>>>({})
  useEffect(() => {
    const out: Partial<Record<BodyId, number>> = {}
    for (const b of BODIES) {
      if (b.id === activeStationId) continue
      out[b.id] = routeToleranceMul(activeBody, b)
    }
    routeTolMulRef.current = out
  }, [activeStationId, activeBody])
  const stage2Ref = useRef<Set<BodyId>>(new Set())
  useEffect(() => {
    const set = new Set<BodyId>()
    for (const b of BODIES) if (stations[b.id].stage2) set.add(b.id)
    stage2Ref.current = set
  }, [stations])

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

      const sourceId = activeStationRef.current
      const sourceBody = BODIES.find((b) => b.id === sourceId) ?? EARTH
      const sourceAngle = ((t / periodOf(sourceBody)) + sourceBody.phase) * 2 * Math.PI

      const positions = ORBITS.map((body, i) => {
        const r = rMin + (rMax - rMin) * (i / (ORBITS.length - 1))
        const angle = ((t / periodOf(body)) + body.phase) * 2 * Math.PI
        let delta = Math.abs(((sourceAngle - angle) % (2 * Math.PI)))
        if (delta > Math.PI) delta = 2 * Math.PI - delta
        return { body, angle, r, delta }
      })
      const sourcePos = positions.find((p) => p.body.id === sourceId)!

      const swells = swellsRef.current
      const launchedId = launchRequestRef.current
      if (launchedId) {
        launchRequestRef.current = null
        const s = swells.get(launchedId)
        if (s && s.held > VOICE_FLOOR_GAIN + 0.001) {
          s.releasing = true
          s.armed = false
        }
      }

      const tolMuls = routeTolMulRef.current
      for (const { body, delta } of positions) {
        if (body.id === sourceId) continue
        const s = swells.get(body.id)
        if (!s) continue
        // Per-route tolerance: a wider arc counts as "in the window" for
        // small-denominator just approximations of the source→target
        // interval. P5 routes feel forgiving; the tritone demands tight
        // phase alignment.
        const mul = tolMuls[body.id] ?? 1
        const proximity = Math.max(0, Math.min(1, 1 - delta / (Math.PI * mul)))
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
      const stage2 = stage2Ref.current
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
        // Only the source station and stage-2-graduated stations chime
        // into the orbital drone. The source is always audible — it's the
        // player's anchor; other voices stay silent until their station
        // earns its emission badge.
        const emits = body.id === sourceId || stage2.has(body.id)
        if (!emits) continue
        const voice = a!.voices.get(body.id)
        if (!voice) continue
        if (body.id === sourceId) {
          strike(voice, EARTH_VELOCITY)
        } else {
          const s = swells.get(body.id)
          const norm = s
            ? (s.held - VOICE_FLOOR_GAIN) / (VOICE_PEAK_GAIN - VOICE_FLOOR_GAIN)
            : 0
          const velocity = STRIKE_FLOOR_VELOCITY + Math.pow(Math.max(0, norm), 0.7) * (1 - STRIKE_FLOOR_VELOCITY)
          strike(voice, velocity)
        }
      }

      const nextArmed: ArmedMap = {}
      for (const body of BODIES) {
        if (body.id === sourceId) continue
        const s = swells.get(body.id)
        nextArmed[body.id] = !!(s && !s.releasing && s.held > LAUNCH_ARM_GAIN)
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
        if (body.id === sourceId) continue
        const mul = tolMuls[body.id] ?? 1
        const proximity = Math.max(0, Math.min(1, 1 - delta / (Math.PI * mul)))
        if (proximity > HALO_PROXIMITY_BASE) {
          const px = cx + Math.cos(angle) * r
          const py = cy + Math.sin(angle) * r
          ctx.beginPath()
          ctx.arc(px, py, 13, 0, 2 * Math.PI)
          ctx.fill()
          anyAligned = true
        }
      }
      if (anyAligned) {
        const sx = cx + Math.cos(sourcePos.angle) * sourcePos.r
        const sy = cy + Math.sin(sourcePos.angle) * sourcePos.r
        ctx.beginPath()
        ctx.arc(sx, sy, 14, 0, 2 * Math.PI)
        ctx.fill()
      }

      ctx.fillStyle = textM
      ctx.beginPath()
      ctx.arc(cx, cy, 2, 0, 2 * Math.PI)
      ctx.fill()

      for (const { body, angle, r } of positions) {
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        const isSource = body.id === sourceId
        ctx.fillStyle = isSource ? textH : nextArmed[body.id] ? accent : textM
        ctx.beginPath()
        ctx.arc(px, py, isSource ? 6 : 5, 0, 2 * Math.PI)
        ctx.fill()
      }

      type ArrivedProbe = { id: BodyId; probe: Probe }
      const arrived: ArrivedProbe[] = []
      probesRef.current.forEach((probe, id) => {
        const u = (now - probe.startMs) / 1000 / PROBE_DURATION_S
        if (u >= 1) {
          arrived.push({ id, probe })
          return
        }
        const target = positions.find((p) => p.body.id === id)
        if (!target) return
        const src = positions.find((p) => p.body.id === probe.source) ?? sourcePos
        const r = src.r + (target.r - src.r) * u
        let delta = (target.angle - src.angle) % (2 * Math.PI)
        if (delta > Math.PI) delta -= 2 * Math.PI
        if (delta < -Math.PI) delta += 2 * Math.PI
        const angle = src.angle + delta * u
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(px, py, 3.5, 0, 2 * Math.PI)
        ctx.fill()
      })
      if (arrived.length) {
        for (const { id, probe } of arrived) {
          probesRef.current.delete(id)
          // Credit cargo to the global purse and mark the destination
          // station unlocked so its resonator becomes selectable.
          earnRef.current(probe.cargo)
          setStations((prev) => {
            if (prev[id].unlocked) return prev
            return { ...prev, [id]: { ...prev[id], unlocked: true } }
          })
        }
        setFlying((prev) => {
          if (arrived.every(({ id }) => !prev.has(id))) return prev
          const next = new Set(prev)
          for (const { id } of arrived) next.delete(id)
          return next
        })
      }

      const prevArmed = armedRef.current
      let changed = false
      for (const body of BODIES) {
        if (body.id === sourceId) continue
        if ((prevArmed[body.id] ?? false) !== (nextArmed[body.id] ?? false)) {
          changed = true
          break
        }
      }
      if (changed) {
        armedRef.current = nextArmed
        setArmed(nextArmed)
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stopAudio = useCallback((audio: OrbitAudio) => {
    const { graph, voices } = audio
    teardownAudioGraph(graph, [])
    window.setTimeout(() => {
      for (const v of voices.values()) {
        v.synth.dispose()
        v.panner.dispose()
      }
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

    const voices = new Map<BodyId, ToneVoice>()
    BODIES.forEach((body, i) => {
      const pan = -0.4 + (i / Math.max(1, BODIES.length - 1)) * 0.8
      const hz = EARTH_HZ * body.ratio
      voices.set(body.id, buildVoice(hz, pan))
    })

    return { graph, voices, timbre: nextTimbre }
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

  // Idle accrual sums every unlocked, auto-pluck-equipped station — each
  // station's resonator runs its own auto-pluck timers when the player is
  // looking at it (on-tab) and credits through the interval below when
  // not. We skip the active station when its tab is open to avoid double-
  // counting against HarvestStage's own on-tab path.
  const idleRate = useMemo(() => {
    let total: CurrencyPurse = {}
    for (const b of BODIES) {
      const s = stations[b.id]
      if (!s.unlocked) continue
      if (s.autoPluckSlots.size === 0) continue
      if (b.id === activeStationId && tab === 'harvest') continue
      const rate = computeIdleRate(s.slots, s.autoPluckSlots, s.noteYieldLvls, YIELD_STEP)
      total = addToPurse(total, rate)
    }
    return total
  }, [stations, activeStationId, tab])
  const idleHasFlow = useMemo(
    () => Object.values(idleRate).some((v) => (v ?? 0) > 0),
    [idleRate],
  )

  useEffect(() => {
    if (!idleHasFlow) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const delta: CurrencyPurse = {}
      for (const k of Object.keys(idleRate) as CurrencyKey[]) {
        const rate = idleRate[k] ?? 0
        if (rate > 0) delta[k] = rate * dt
      }
      if (Object.keys(delta).length > 0) earn(delta)
    }, 250)
    return () => window.clearInterval(id)
  }, [idleHasFlow, idleRate, earn])

  const handleSlotChange = useCallback(
    (slotIdx: number, newNotes: readonly BodyId[]) => {
      updateStation(activeStationId, (s) => {
        const next = s.slots.map((arr) => arr.slice())
        for (const note of newNotes) {
          for (let i = 0; i < next.length; i++) {
            if (i !== slotIdx) next[i] = next[i].filter((n) => n !== note)
          }
        }
        next[slotIdx] = newNotes.slice()
        return { ...s, slots: next }
      })
    },
    [activeStationId, updateStation],
  )

  const spendIfAffordable = useCallback(
    (cost: CurrencyPurse): boolean => {
      if (!canAffordPurse(currencies, cost)) return false
      setCurrencies((prev) => subtractCost(prev, cost))
      return true
    },
    [currencies],
  )

  const handleUnlockAutoPluck = useCallback(
    (slotIdx: number) => {
      const s = stations[activeStationId]
      if (s.autoPluckSlots.has(slotIdx)) return
      if (slotIdx >= s.slotCount) return
      const cost = autoPluckCost(slotIdx)
      if (!spendIfAffordable(cost)) return
      updateStation(activeStationId, (st) => {
        const next = new Set(st.autoPluckSlots)
        next.add(slotIdx)
        return { ...st, autoPluckSlots: next }
      })
    },
    [stations, activeStationId, spendIfAffordable, updateStation],
  )

  const handleUnlockSlot = useCallback(() => {
    const s = stations[activeStationId]
    const nextIdx = s.slotCount
    if (nextIdx >= MAX_SLOT_COUNT) return
    const cost = SLOT_UNLOCK_COSTS[nextIdx + 1]
    if (!cost) return
    if (!spendIfAffordable(cost)) return
    updateStation(activeStationId, (st) => ({
      ...st,
      slotCount: st.slotCount + 1,
      slots: [...st.slots, []],
    }))
  }, [stations, activeStationId, spendIfAffordable, updateStation])

  const handleUpgradeSlot0Capacity = useCallback(() => {
    const s = stations[activeStationId]
    const nextCap = s.slot0Capacity + 1
    if (nextCap > MAX_SLOT0_CAPACITY) return
    const cost = SLOT0_CAPACITY_COSTS[nextCap]
    if (!cost) return
    if (!spendIfAffordable(cost)) return
    updateStation(activeStationId, (st) => ({ ...st, slot0Capacity: nextCap }))
  }, [stations, activeStationId, spendIfAffordable, updateStation])

  const buyNoteYield = useCallback(
    (id: BodyId) => {
      const s = stations[activeStationId]
      const lvl = s.noteYieldLvls[id] ?? 0
      const cost = noteYieldCost(id, lvl)
      if (!spendIfAffordable(cost)) return
      updateStation(activeStationId, (st) => ({
        ...st,
        noteYieldLvls: { ...st.noteYieldLvls, [id]: lvl + 1 },
      }))
    },
    [stations, activeStationId, spendIfAffordable, updateStation],
  )

  // Progressive disclosure: only show 1 card per category at a time so the
  // panel stays a punch-list of the next concrete action.
  const nextSlotIdx = activeStation.slotCount + 1
  const nextSlotCost = SLOT_UNLOCK_COSTS[nextSlotIdx]
  const canAffordSlot = nextSlotCost ? canAffordPurse(currencies, nextSlotCost) : false
  const nextSlot0Cap = activeStation.slot0Capacity + 1
  const slot0CapCost =
    nextSlot0Cap <= MAX_SLOT0_CAPACITY ? SLOT0_CAPACITY_COSTS[nextSlot0Cap] : undefined
  const canAffordSlot0Cap = slot0CapCost ? canAffordPurse(currencies, slot0CapCost) : false
  const autoPluckSlotsToOffer = Array.from(
    { length: activeStation.slotCount },
    (_, i) => i,
  )
    .filter((i) => !activeStation.autoPluckSlots.has(i))
    .slice(0, 1)

  // Yield candidate: among the active station's in-key partials, surface
  // the most promising next-level upgrade. Per the design, yield upgrades
  // also expand the station's exportable subset, so this is the lever
  // that grows Stage-1 cargo and unlocks Stage-2 emission.
  type YieldOption = {
    id: BodyId
    lvl: number
    cost: CurrencyPurse
    costNote: BodyId
    progress: number
    affordable: boolean
  }
  const yieldOptions: YieldOption[] = activeInKey.map((id) => {
    const lvl = activeStation.noteYieldLvls[id] ?? 0
    const cost = noteYieldCost(id, lvl)
    const costNote = FIFTH_NEXT[id]
    const progress = costProgress(currencies, cost)
    const affordable = canAffordPurse(currencies, cost)
    return { id, lvl, cost, costNote, progress, affordable }
  })
  const visibleYieldOption: YieldOption | undefined = [...yieldOptions]
    .sort((a, b) => {
      if (a.affordable !== b.affordable) return a.affordable ? -1 : 1
      if (a.progress !== b.progress) return b.progress - a.progress
      return a.lvl - b.lvl
    })[0]

  // Cargo manifest for a launch from `sourceId`: 1 unit of each currency
  // the source can export and the purse can pay for. Returns null when
  // the station isn't Stage-1 graduated or when nothing in the purse
  // matches the exportable subset — the launch button is disabled in
  // either case.
  const buildCargo = useCallback(
    (sourceId: BodyId): CurrencyPurse | null => {
      const s = stations[sourceId]
      if (!s.stage1) return null
      const cargo: CurrencyPurse = {}
      for (const id of s.exportable) {
        if ((currencies[id] ?? 0) >= 1) cargo[id] = 1
      }
      if (Object.keys(cargo).length === 0) return null
      return cargo
    },
    [stations, currencies],
  )

  const cargoForActive = buildCargo(activeStationId)

  // Aggregate every visible buy that's currently affordable.
  type ReadyBuy = { label: string; costKeys: CurrencyKey[] }
  const readyBuys: ReadyBuy[] = []
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
    const cost = autoPluckCost(slotIdx)
    if (canAffordPurse(currencies, cost)) {
      readyBuys.push({
        label: `Auto slot ${slotIdx + 1}`,
        costKeys: (Object.keys(cost) as CurrencyKey[]).filter((k) => (cost[k] ?? 0) > 0),
      })
    }
  }
  if (visibleYieldOption?.affordable) {
    readyBuys.push({
      label: `${visibleYieldOption.id} yield`,
      costKeys: (Object.keys(visibleYieldOption.cost) as CurrencyKey[]).filter(
        (k) => (visibleYieldOption.cost[k] ?? 0) > 0,
      ),
    })
  }
  const readyChipKeys = new Set<CurrencyKey>()
  for (const b of readyBuys) for (const k of b.costKeys) readyChipKeys.add(k)

  const scrollToProgress = useCallback(() => {
    progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Launch from the active station to `body`. Customs gate: the source
  // must be Stage-1, the route's proximity window must be open, the
  // purse must cover the cargo manifest. The cargo is deducted from the
  // source's purse on launch and credited to the destination on arrival.
  const onLaunch = useCallback(
    (body: Body) => {
      if (!armedRef.current[body.id]) return
      if (probesRef.current.has(body.id)) return
      const cargo = buildCargo(activeStationId)
      if (!cargo) return
      if (!spendIfAffordable(cargo)) return
      probesRef.current.set(body.id, {
        startMs: performance.now(),
        source: activeStationId,
        cargo,
      })
      launchRequestRef.current = body.id
      setFlying((prev) => {
        const next = new Set(prev)
        next.add(body.id)
        return next
      })
    },
    [activeStationId, buildCargo, spendIfAffordable],
  )

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

  const launchTargets = BODIES.filter((b) => b.id !== activeStationId)

  return (
    <main>
      <h1>Orbital</h1>
      <p className="tagline">
        {tab === 'orbits'
          ? `Launching from ${activeBody.name} (${activeBody.id}). Consonant routes arm easily; the tritone is rare.`
          : `Resonator · station ${activeBody.id} · in-key partials ${activeInKey.join(' · ')}`}
      </p>
      <nav className="tabs" role="tablist" aria-label="Stage">
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'orbits' ? ' on' : ''}`}
          aria-selected={tab === 'orbits'}
          onClick={() => setTab('orbits')}
        >
          Orbits
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'harvest' ? ' on' : ''}`}
          aria-selected={tab === 'harvest'}
          onClick={() => setTab('harvest')}
        >
          Resonator
        </button>
      </nav>
      {unlockedStations.length > 1 && (
        <ul className="station-row" role="list" aria-label="Stations">
          {unlockedStations.map((b) => {
            const st = stations[b.id]
            const isActive = b.id === activeStationId
            const badge = st.stage2 ? '✦' : st.stage1 ? '◇' : ''
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className={`station-chip${isActive ? ' on' : ''}`}
                  style={{ ['--chip-color' as string]: PAD_COLORS[b.id] ?? 'var(--text)' }}
                  onClick={() => setActiveStationId(b.id)}
                  aria-pressed={isActive}
                  title={`Switch to ${b.name} station`}
                >
                  <span className="station-chip-key">{b.id}</span>
                  <span className="station-chip-name">{b.name}</span>
                  {badge && <span className="station-chip-badge">{badge}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
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
        <canvas
          ref={canvasRef}
          className="orbit"
          aria-label="Seven bodies on a diatonic wheel"
        />
        {!activeStation.stage1 ? (
          <p className="launch-gate">
            Graduate <strong>{activeBody.id}</strong> station (Stage 1: all slots unlocked + auto-pluck on slot 1)
            to enable exports. Until then no probes ship from {activeBody.name}.
          </p>
        ) : !cargoForActive ? (
          <p className="launch-gate">
            Stage 1 graduated. Mint at least one unit of{' '}
            {Array.from(activeStation.exportable).join(' / ')} to load a probe.
          </p>
        ) : (
          <p className="launch-cargo" aria-label="Cargo manifest">
            Cargo · {Object.keys(cargoForActive).join(' · ')}
            {activeStation.stage2 && <span className="emission-badge"> · ✦ emitting</span>}
          </p>
        )}
        <ul className="tiles" role="list">
          {launchTargets.map((body) => (
            <li key={body.id}>
              <PlanetTile
                body={body}
                interval={intervalBetween(activeBody, body)}
                armed={!!armed[body.id] && !!cargoForActive}
                flying={flying.has(body.id)}
                onLaunch={() => onLaunch(body)}
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
            key={activeStationId}
            station={activeBody}
            slots={activeStation.slots}
            slotCount={activeStation.slotCount}
            slotCapacities={slotCapacities}
            autoPluckSlots={activeStation.autoPluckSlots}
            noteYieldMul={noteYieldMul}
            onSlotChange={handleSlotChange}
            onEarn={earn}
            stage1={activeStation.stage1}
            stage2={activeStation.stage2}
            exportable={activeStation.exportable}
            onDevFinish={devFinishActiveStation}
          />
          <section ref={progressRef} className="resonator-progress" aria-label="Progression">
            {visibleIdleEntries.length > 0 && (
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
            {(nextSlotCost ||
              slot0CapCost ||
              autoPluckSlotsToOffer.length > 0) && (
              <div className="prog-section prog-unlocks">
                <h3 className="prog-h">
                  <span className="prog-h-label">Next</span>
                  <span className="prog-h-sub">unlock new pieces of the {activeBody.id} resonator</span>
                </h3>
                <ul className="unlocks" role="list">
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
                          Slot 1 · {activeStation.slot0Capacity} → {nextSlot0Cap}
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
                    const cost = autoPluckCost(slotIdx)
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
            {visibleYieldOption && (
              <div className="prog-section prog-upgrades">
                <h3 className="prog-h">
                  <span className="prog-h-label">Yield</span>
                  <span className="prog-h-sub">
                    each note's currency scales ×{YIELD_STEP.toFixed(2)} per level, paid in its dominant
                  </span>
                </h3>
                <ul className="upgrades" role="list" aria-label="Per-note yield upgrades">
                  {(() => {
                    const opt = visibleYieldOption
                    const mul = noteYieldMultiplier(opt.lvl)
                    const nextMul = mul * YIELD_STEP
                    const color = PAD_COLORS[opt.id] ?? 'var(--text)'
                    return (
                      <li
                        key={opt.id}
                        className={`upgrade upgrade-note${opt.affordable ? ' affordable' : ''}`}
                        style={{ ['--chip-color' as string]: color }}
                      >
                        <header className="upgrade-head-row">
                          <span
                            className="upgrade-swatch"
                            aria-hidden="true"
                            style={{ background: color }}
                          />
                          <span className="upgrade-name">{opt.id}</span>
                          <span className="upgrade-lvl">lvl {opt.lvl}</span>
                          {opt.affordable && <ReadyBadge />}
                        </header>
                        <div className="upgrade-mul-row" aria-hidden="true">
                          <span key={opt.lvl} className="upgrade-mul">×{mul.toFixed(2)}</span>
                          <span className="upgrade-arrow">→</span>
                          <span className="upgrade-mul upgrade-mul-next">×{nextMul.toFixed(2)}</span>
                        </div>
                        <CostChips cost={opt.cost} purse={currencies} />
                        {!opt.affordable && (
                          <ShortHint cost={opt.cost} purse={currencies} />
                        )}
                        <span
                          className="upgrade-progress"
                          style={{ ['--p' as string]: opt.progress.toFixed(3) }}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className="upgrade-btn"
                          disabled={!opt.affordable}
                          onClick={() => buyNoteYield(opt.id)}
                          aria-label={`Upgrade ${opt.id} yield to lvl ${opt.lvl + 1} (×${nextMul.toFixed(2)})`}
                        >
                          Upgrade {opt.id} · ×{nextMul.toFixed(2)}
                        </button>
                      </li>
                    )
                  })()}
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
