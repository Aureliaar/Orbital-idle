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
  NoteCurrency,
} from './harvest-config'
import { PlanetTile } from './PlanetTile'
import { UpgradePanel } from './UpgradePanel'

type Tab = 'orbits' | 'harvest'

// --- Cost tables --------------------------------------------------------
//
// Every cost is a CurrencyPurse. Note-currencies (C..B) come from tapping
// that note; freq-currencies (F3, F15_4, F4, F9_2, F5, F45_8, F6, F20_3,
// F15_2) come from landing a partial-pair coincidence at that frequency.
// Each coincidence mints exactly one unit of the freq-currency for the
// frequency where its partials lined up.
//
// Reachable coincidences in the diatonic at H≤6 (so we know which freq
// is earnable once each ladder step opens):
//   C×E (M3, freq=5)              → F5
//   C×G (P5, freq=3 and freq=6)   → F3, F6
//   C×F (P4, freq=4)              → F4
//   C×A (M6, freq=5)              → F5
//   D×G (P4, freq=9/2)            → F9_2
//   D×B (M6, freq=45/8)           → F45_8
//   E×G (m3, freq=15/2)           → F15_2
//   E×A (P4, freq=5)              → F5
//   E×B (P5, freq=15/4 and 15/2)  → F15_4, F15_2
//   F×A (M3, freq=20/3)           → F20_3
//   G×B (M3, freq=15/2)           → F15_2
// Every entry on the ladder requires a freq-currency that the previous
// steps have already made earnable.

const UNLOCK_LADDER: BodyId[] = ['C', 'E', 'G', 'F', 'A', 'D', 'B']
const UNLOCK_COSTS: Record<BodyId, CurrencyPurse> = {
  C: {},
  E: { C: 5 },
  G: { C: 8, E: 4, F5: 2 }, // proves C×E
  F: { C: 15, E: 6, G: 6, F3: 2, F6: 2 }, // proves C×G in both octaves
  A: { E: 12, G: 12, F: 6, F4: 4 }, // proves C×F
  D: { G: 18, F: 12, A: 8, F5: 4, F15_2: 3 }, // proves E×G or G×B
  B: { D: 10, A: 10, G: 15, F: 12, F9_2: 4, F20_3: 4 }, // proves D×G and F×A
}

// Auto-pluck base cost — a "you've played the diatonic" tax. Each note
// you've actually used shows up as a fee, so the price reflects your
// breadth of play. Successive slots scale by 1.6.
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
const AUTO_PLUCK_MIN_UNLOCKS = 3
const autoPluckCost = (slotIdx: number): CurrencyPurse => {
  const factor = 1.6 ** slotIdx
  const out: CurrencyPurse = {}
  for (const k of Object.keys(AUTO_PLUCK_BASE_COST) as CurrencyKey[]) {
    out[k] = Math.round((AUTO_PLUCK_BASE_COST[k] ?? 0) * factor)
  }
  return out
}

// Slot 2 unlocks once E is in hand and costs a single E — the gate note
// itself pays for the slot, so the player has to mint E before the slot is
// reachable, but the price is symbolic. With one slot you can't make a
// coincidence yet, so a freq requirement would be unreachable. Slot 3
// demands freq currency — by then you've had a pair of slots ringing
// together for a while.
const SLOT_UNLOCK_COSTS: Record<number, CurrencyPurse> = {
  2: { E: 1 },
  3: { C: 30, E: 18, G: 12, F3: 4, F5: 6 },
}
const SLOT_UNLOCK_GATES: Record<number, BodyId> = {
  2: 'E',
}

// Slot 0 capacity ladder — stacking chords. Pricing demands a chord-
// shaped freq mix.
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

type Probe = { startMs: number }
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

function CostChips({ cost }: { cost: CurrencyPurse }) {
  const entries: Array<{ k: CurrencyKey; label: string; v: number; color: string }> = []
  for (const k of NOTE_CURRENCIES) {
    const v = cost[k]
    if (v) entries.push({ k, label: k, v, color: PAD_COLORS[k] ?? 'var(--text)' })
  }
  for (const k of FREQ_CURRENCY_KEYS) {
    const v = cost[k]
    if (v) entries.push({ k, label: displayCurrencyKey(k), v, color: FREQ_COLORS[k] })
  }
  return (
    <span className="cost-chips" aria-label={formatCost(cost)}>
      {entries.map(({ k, label, v, color }) => (
        <span key={k} className="cost-chip" style={{ ['--chip-color' as string]: color }}>
          <span className="cost-chip-v">{v}</span>
          <span className="cost-chip-k">{label}</span>
        </span>
      ))}
    </span>
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
  const [unlockedIds, setUnlockedIds] = useState<BodyId[]>(['C'])
  const [slotCount, setSlotCount] = useState(INITIAL_SLOT_COUNT)
  const [slots, setSlots] = useState<BodyId[][]>(() => {
    const init: BodyId[][] = []
    for (let i = 0; i < INITIAL_SLOT_COUNT; i++) init.push([])
    init[0] = ['C']
    return init
  })
  const [slot0Capacity, setSlot0Capacity] = useState(1)
  const [autoPluckSlots, setAutoPluckSlots] = useState<ReadonlySet<number>>(() => new Set())
  const [noteYieldLvls, setNoteYieldLvls] = useState<Partial<Record<BodyId, number>>>({})
  const slotCapacities = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => (i === 0 ? slot0Capacity : 1)),
    [slotCount, slot0Capacity],
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

  const swellsRef = useRef<Map<BodyId, VoiceState>>(
    new Map(TARGETS.map((b) => [b.id, { held: VOICE_FLOOR_GAIN, releasing: false, armed: true }])),
  )
  const launchRequestRef = useRef<BodyId | null>(null)
  const phaseRef = useRef<Map<BodyId, number>>(new Map())
  const tabRef = useRef<Tab>(tab)

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
      const launchedId = launchRequestRef.current
      if (launchedId) {
        launchRequestRef.current = null
        const s = swells.get(launchedId)
        if (s && s.held > VOICE_FLOOR_GAIN + 0.001) {
          s.releasing = true
          s.armed = false
        }
      }

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

      const nextArmed: ArmedMap = {}
      for (const body of TARGETS) {
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

      for (const { body, angle, r } of positions) {
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        const isEarth = body.id === EARTH.id
        ctx.fillStyle = isEarth ? textH : nextArmed[body.id] ? accent : textM
        ctx.beginPath()
        ctx.arc(px, py, isEarth ? 6 : 5, 0, 2 * Math.PI)
        ctx.fill()
      }

      const toRemove: BodyId[] = []
      probesRef.current.forEach((probe, id) => {
        const u = (now - probe.startMs) / 1000 / PROBE_DURATION_S
        if (u >= 1) {
          toRemove.push(id)
          return
        }
        const target = positions.find((p) => p.body.id === id)
        if (!target) return
        const r = earthPos.r + (target.r - earthPos.r) * u
        let delta = (target.angle - earthAngle) % (2 * Math.PI)
        if (delta > Math.PI) delta -= 2 * Math.PI
        if (delta < -Math.PI) delta += 2 * Math.PI
        const angle = earthAngle + delta * u
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(px, py, 3.5, 0, 2 * Math.PI)
        ctx.fill()
      })
      if (toRemove.length) {
        for (const id of toRemove) probesRef.current.delete(id)
        setFlying((prev) => {
          if (toRemove.every((id) => !prev.has(id))) return prev
          const next = new Set(prev)
          for (const id of toRemove) next.delete(id)
          return next
        })
      }

      const prevArmed = armedRef.current
      let changed = false
      for (const body of TARGETS) {
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
  const idleHasFlow = useMemo(
    () => Object.values(idleRate).some((v) => (v ?? 0) > 0),
    [idleRate],
  )

  // Off-tab idle accrual. The on-tab auto-pluck path credits directly via
  // handleSlot → onEarn → earn(); running this ticker simultaneously would
  // double-count. Mark seen currencies for everything the rate produces so
  // chips appear in the UI even if the player is away.
  useEffect(() => {
    if (!anyAutoPluck) return
    if (tab === 'harvest') return
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
  }, [tab, anyAutoPluck, idleHasFlow, idleRate, earn])

  const handleSlotChange = useCallback((slotIdx: number, newNotes: readonly BodyId[]) => {
    setSlots((prev) => {
      const next = prev.map((s) => s.slice())
      for (const note of newNotes) {
        for (let i = 0; i < next.length; i++) {
          if (i !== slotIdx) next[i] = next[i].filter((n) => n !== note)
        }
      }
      next[slotIdx] = newNotes.slice()
      return next
    })
  }, [])

  const spendIfAffordable = useCallback(
    (cost: CurrencyPurse): boolean => {
      if (!canAffordPurse(currencies, cost)) return false
      setCurrencies((prev) => subtractCost(prev, cost))
      return true
    },
    [currencies],
  )

  const handleUnlock = useCallback((id: BodyId) => {
    if (unlockedIds.includes(id)) return
    const cost = UNLOCK_COSTS[id]
    if (!spendIfAffordable(cost)) return
    setUnlockedIds((prev) => [...prev, id])
    setSeenCurrencies((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [unlockedIds, spendIfAffordable])

  const handleUnlockAutoPluck = useCallback((slotIdx: number) => {
    if (autoPluckSlots.has(slotIdx)) return
    if (slotIdx >= slotCount) return
    if (unlockedIds.length < AUTO_PLUCK_MIN_UNLOCKS) return
    const cost = autoPluckCost(slotIdx)
    if (!spendIfAffordable(cost)) return
    setAutoPluckSlots((prev) => {
      const next = new Set(prev)
      next.add(slotIdx)
      return next
    })
  }, [autoPluckSlots, slotCount, unlockedIds.length, spendIfAffordable])

  const handleUnlockSlot = useCallback(() => {
    const nextIdx = slotCount
    if (nextIdx >= MAX_SLOT_COUNT) return
    const cost = SLOT_UNLOCK_COSTS[nextIdx + 1]
    if (!cost) return
    if (!spendIfAffordable(cost)) return
    setSlotCount((c) => c + 1)
    setSlots((prev) => [...prev, []])
  }, [slotCount, spendIfAffordable])

  const handleUpgradeSlot0Capacity = useCallback(() => {
    const nextCap = slot0Capacity + 1
    if (nextCap > MAX_SLOT0_CAPACITY) return
    const cost = SLOT0_CAPACITY_COSTS[nextCap]
    if (!cost) return
    if (!spendIfAffordable(cost)) return
    setSlot0Capacity(nextCap)
  }, [slot0Capacity, spendIfAffordable])

  const buyNoteYield = useCallback(
    (id: BodyId) => {
      const lvl = noteYieldLvls[id] ?? 0
      const cost = noteYieldCost(id, lvl)
      if (!spendIfAffordable(cost)) return
      setNoteYieldLvls((prev) => ({ ...prev, [id]: lvl + 1 }))
    },
    [noteYieldLvls, spendIfAffordable],
  )

  const nextUnlocks = UNLOCK_LADDER.filter((id) => !unlockedIds.includes(id)).slice(0, 2)
  const nextSlotIdx = slotCount + 1
  const slotGate = SLOT_UNLOCK_GATES[nextSlotIdx]
  const slotGatePassed = slotGate ? unlockedIds.includes(slotGate) : true
  const nextSlotCost = slotGatePassed ? SLOT_UNLOCK_COSTS[nextSlotIdx] : undefined
  const canAffordSlot = nextSlotCost ? canAffordPurse(currencies, nextSlotCost) : false
  const nextSlot0Cap = slot0Capacity + 1
  const slot0CapCost =
    nextSlot0Cap <= MAX_SLOT0_CAPACITY && unlockedIds.length >= 2
      ? SLOT0_CAPACITY_COSTS[nextSlot0Cap]
      : undefined
  const canAffordSlot0Cap = slot0CapCost ? canAffordPurse(currencies, slot0CapCost) : false
  const autoPluckGate = unlockedIds.length >= AUTO_PLUCK_MIN_UNLOCKS
  const autoPluckSlotsToOffer = autoPluckGate
    ? Array.from({ length: slotCount }, (_, i) => i).filter((i) => !autoPluckSlots.has(i))
    : []

  const onLaunch = useCallback((body: Body) => {
    if (!armedRef.current[body.id]) return
    if (probesRef.current.has(body.id)) return
    probesRef.current.set(body.id, { startMs: performance.now() })
    launchRequestRef.current = body.id
    setFlying((prev) => {
      const next = new Set(prev)
      next.add(body.id)
      return next
    })
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
      <h1>Orbital</h1>
      <p className="tagline">
        {tab === 'orbits'
          ? 'Diatonic wheel · Earth tonic · tap to launch, hold to upgrade'
          : 'Resonator · every note mints its own currency · land coincidences to mint H2..H6'}
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
      <section className="currencies-panel" aria-label="Currencies">
        <ul className="cur-row cur-notes" role="list" aria-label="Note currencies">
          {visibleNoteCurrencies.length === 0 ? (
            <li className="cur-empty">tap a slot to mint your first currency</li>
          ) : (
            visibleNoteCurrencies.map((k) => {
              const v = currencies[k] ?? 0
              const color = PAD_COLORS[k]
              return (
                <li
                  key={k}
                  className="cur-chip"
                  data-cur-key={k}
                  style={{ ['--chip-color' as string]: color }}
                  title={`${k} currency — mint by tapping ${k}`}
                >
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
              return (
                <li
                  key={k}
                  className="cur-chip cur-chip-harm"
                  data-cur-key={k}
                  style={{ ['--chip-color' as string]: color }}
                  title={`f${ratio} — coincidence frequency ${ratio}·tonic (${interval})`}
                >
                  <span className="cur-key">f{ratio}</span>
                  <span className="cur-value">{formatCurrency(v)}</span>
                </li>
              )
            })}
          </ul>
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
        <ul className="tiles" role="list">
          {TARGETS.map((body) => (
            <li key={body.id}>
              <PlanetTile
                body={body}
                armed={armed[body.id] ?? false}
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
            unlockedIds={unlockedIds}
            slots={slots}
            slotCount={slotCount}
            slotCapacities={slotCapacities}
            autoPluckSlots={autoPluckSlots}
            noteYieldMul={noteYieldMul}
            onSlotChange={handleSlotChange}
            onEarn={earn}
          />
          <section className="resonator-progress" aria-label="Progression">
            {anyAutoPluck && visibleIdleEntries.length > 0 && (
              <p className="idle-rate" aria-label="Idle rate">
                <span className="idle-label">Idle</span>
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
            )}
            {(nextUnlocks.length > 0 ||
              nextSlotCost ||
              slot0CapCost ||
              autoPluckSlotsToOffer.length > 0) && (
              <ul className="unlocks" role="list">
                {nextUnlocks.map((id, i) => {
                  const cost = UNLOCK_COSTS[id]
                  const affordable = canAffordPurse(currencies, cost)
                  return (
                    <li key={id} className={`unlock${i === 0 ? ' next' : ''}`}>
                      <div className="unlock-info">
                        <span className="unlock-note">{id}</span>
                        <CostChips cost={cost} />
                      </div>
                      <button
                        type="button"
                        className="unlock-btn"
                        disabled={!affordable}
                        onClick={() => handleUnlock(id)}
                      >
                        Unlock
                      </button>
                    </li>
                  )
                })}
                {nextSlotCost && (
                  <li className="unlock unlock-slot next">
                    <div className="unlock-info">
                      <span className="unlock-note">Slot {nextSlotIdx}</span>
                      <CostChips cost={nextSlotCost} />
                      <span className="unlock-desc">
                        {nextSlotIdx === 2
                          ? 'a home for your second note'
                          : '3-note resonance unlocks'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="unlock-btn"
                      disabled={!canAffordSlot}
                      onClick={handleUnlockSlot}
                    >
                      Unlock
                    </button>
                  </li>
                )}
                {slot0CapCost && (
                  <li className="unlock unlock-stack">
                    <div className="unlock-info">
                      <span className="unlock-note">
                        Slot 1 stack · {slot0Capacity} → {nextSlot0Cap} notes
                      </span>
                      <CostChips cost={slot0CapCost} />
                      <span className="unlock-desc">
                        play a chord on every tap
                      </span>
                    </div>
                    <button
                      type="button"
                      className="unlock-btn"
                      disabled={!canAffordSlot0Cap}
                      onClick={handleUpgradeSlot0Capacity}
                    >
                      Upgrade
                    </button>
                  </li>
                )}
                {autoPluckSlotsToOffer.map((slotIdx) => {
                  const cost = autoPluckCost(slotIdx)
                  const affordable = canAffordPurse(currencies, cost)
                  return (
                    <li key={`auto-${slotIdx}`} className="unlock unlock-auto">
                      <div className="unlock-info">
                        <span className="unlock-note">⚡ Auto-pluck slot {slotIdx + 1}</span>
                        <CostChips cost={cost} />
                        <span className="unlock-desc">half yield, fires itself</span>
                      </div>
                      <button
                        type="button"
                        className="unlock-btn"
                        disabled={!affordable}
                        onClick={() => handleUnlockAutoPluck(slotIdx)}
                      >
                        Unlock
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {unlockedIds.length > 0 && (
              <ul className="upgrades" role="list" aria-label="Per-note yield upgrades">
                {unlockedIds.map((id) => {
                  const lvl = noteYieldLvls[id] ?? 0
                  const mul = noteYieldMultiplier(lvl)
                  const cost = noteYieldCost(id, lvl)
                  const costNote = FIFTH_NEXT[id]
                  const gateUnlocked = unlockedIds.includes(costNote)
                  const affordable = gateUnlocked && canAffordPurse(currencies, cost)
                  const nextMul = mul * YIELD_STEP
                  return (
                    <li
                      key={id}
                      className="upgrade upgrade-note"
                      style={{ ['--chip-color' as string]: PAD_COLORS[id] ?? 'var(--text)' }}
                    >
                      <div className="upgrade-info">
                        <span className="upgrade-name">{id} yield</span>
                        <span className="upgrade-stat">
                          ×{mul.toFixed(2)} · lvl {lvl}
                          {!gateUnlocked && ` · needs ${costNote}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="upgrade-btn"
                        disabled={!affordable}
                        onClick={() => buyNoteYield(id)}
                        title={gateUnlocked ? formatCost(cost) : `Unlock ${costNote} first`}
                      >
                        ×{nextMul.toFixed(2)} · {cost[costNote as NoteCurrency] ?? 0} {costNote}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
