import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { AudioGraph } from './audio'
import { createAudioGraph, teardownAudioGraph } from './audio'
import type { Body, BodyId } from './bodies'
import { BODIES, EARTH, EARTH_PERIOD_S, TARGETS, periodOf } from './bodies'
import { HarvestStage } from './HarvestStage'
import {
  computeIdleRate,
  INITIAL_SLOT_COUNT,
  MAX_SLOT0_CAPACITY,
  MAX_SLOT_COUNT,
} from './harvest-config'
import { PlanetTile } from './PlanetTile'
import { UpgradePanel } from './UpgradePanel'

type Tab = 'orbits' | 'harvest'

// Unlock order — chosen so the first purchase (E, M3 5:4) introduces a
// small but real Resonance trickle via C+E coincidence, and the second
// (G, P5 3:2) gives the canonical "fifth" jump (~4× the M3 rate). D and B
// remain low-coincidence with C alone but become useful once paired with
// G or F. C is pre-unlocked; E costs Tone only (no way to earn Resonance
// until a second note exists); all later unlocks cost both currencies.
//
// Costs are tuned for *manual* play: E after 3–5 hits of slot 1, G after
// two correct C↔E combos (each combo = 2 taps → 2 Tone and 1 coincidence
// ≈ 0.7–1.4 Resonance). The auto-pluck idle layer is gated behind a
// separate, deliberately-late unlock so the early game stays a rhythm
// puzzle and only turns into an idle clicker once you've earned it.
const UNLOCK_LADDER: BodyId[] = ['C', 'E', 'G', 'F', 'A', 'D', 'B']
const UNLOCK_COSTS: Record<BodyId, { tone: number; resonance: number }> = {
  C: { tone: 0, resonance: 0 },
  E: { tone: 4, resonance: 0 },
  G: { tone: 4, resonance: 2 },
  F: { tone: 15, resonance: 10 },
  A: { tone: 45, resonance: 30 },
  D: { tone: 120, resonance: 90 },
  B: { tone: 300, resonance: 220 },
}

// Auto-pluck is bought one slot at a time. Surfaces only after 3+ notes
// are unlocked so the player has felt the manual combo loop first. Each
// slot's auto-pluck pays half yield (AUTO_PLUCK_PENALTY) — manual play
// stays the optimal play, auto is the convenient one. Cost roughly 2× per
// subsequent slot so the second/third/fourth auto-pluck stay aspirational.
const AUTO_PLUCK_BASE_COST = { tone: 500, resonance: 350 }
const AUTO_PLUCK_MIN_UNLOCKS = 3
const autoPluckCost = (slotIdx: number) => ({
  tone: Math.round(AUTO_PLUCK_BASE_COST.tone * 1.6 ** slotIdx),
  resonance: Math.round(AUTO_PLUCK_BASE_COST.resonance * 1.6 ** slotIdx),
})

// Slot unlock costs. Slot 2 is intentionally cheap and gated on having
// E bought — the player needs somewhere to put their first paired note,
// and gating it on E means the unlock card surfaces exactly when it's
// useful. Slot 3 stays the mid-game gate that opens 3-note resonance.
const SLOT_UNLOCK_COSTS: Record<number, { tone: number; resonance: number }> = {
  2: { tone: 5, resonance: 0 },
  3: { tone: 80, resonance: 50 },
}
const SLOT_UNLOCK_GATES: Record<number, BodyId> = {
  2: 'E',
}

// Slot-0 capacity ladder: first pad can stack 1 → 2 → 3 notes. Stacked
// notes fire together as a chord on every pad press, so cap 2 doubles
// slot 0's tone yield AND lets later notes coincide against the first
// note's freshly-emitted partials at full amplitude (no decay yet).
// Costs are tuned so cap 2 is mid-game and cap 3 is a real grind.
const SLOT0_CAPACITY_COSTS: Record<number, { tone: number; resonance: number }> = {
  2: { tone: 150, resonance: 100 },
  3: { tone: 600, resonance: 400 },
}

// Two infinite upgrades that compound: each level multiplies its yield by
// YIELD_STEP, and the cost grows by COST_STEP. With YIELD < COST per level
// the marginal value drops, but you can buy the other upgrade with the
// currency you're flush in — so the player oscillates between the two and
// Tone gain accelerates exponentially overall.
const YIELD_STEP = 1.5
const COST_STEP = 2
const TONE_YIELD_BASE_COST = 5 // Resonance for level 1
const RES_YIELD_BASE_COST = 8 // Tone for level 1

const yieldMultiplier = (lvl: number) => YIELD_STEP ** lvl
const toneYieldCost = (lvl: number) => Math.round(TONE_YIELD_BASE_COST * COST_STEP ** lvl)
const resYieldCost = (lvl: number) => Math.round(RES_YIELD_BASE_COST * COST_STEP ** lvl)

const PROBE_DURATION_S = 1.4
const HALO_PROXIMITY = 0.93

// Earth → C3 (130.81 Hz). Each body's just-intonation period ratio places it
// on the diatonic scale starting from C, so the visual note labels match the
// audible pitches: D3, E3, F3, G3, A3, B3.
const EARTH_HZ = 261.63 / 2

// Earth is the constant tonic drone. Each non-tonic voice peak-and-holds:
// gain climbs toward a proximity-driven target with a slow attack, sighs
// back if the window passes without a launch, and resolves sharply when
// the player taps that body's tile.
const EARTH_DRONE_GAIN = 0.025
const VOICE_FLOOR_GAIN = 0.002
const VOICE_PEAK_GAIN = 0.16
const SWELL_ATTACK_TAU = 1.8
const SWELL_DECAY_TAU = 3.5
const SWELL_RELEASE_TAU = 0.55
const LAUNCH_ARM_GAIN = VOICE_PEAK_GAIN * 0.55
const REARM_TARGET = VOICE_FLOOR_GAIN + (VOICE_PEAK_GAIN - VOICE_FLOOR_GAIN) * 0.05

type Probe = { startMs: number }
type ArmedMap = Partial<Record<BodyId, boolean>>
type VoiceState = { held: number; releasing: boolean; armed: boolean }
type OrbitAudio = {
  graph: AudioGraph
  voices: Map<BodyId, GainNode>
  stops: OscillatorNode[]
}

const ORBITS = [...BODIES].sort((a, b) => a.ratio - b.ratio)

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const probesRef = useRef<Map<BodyId, Probe>>(new Map())
  const armedRef = useRef<ArmedMap>({})
  const [armed, setArmed] = useState<ArmedMap>({})
  const [flying, setFlying] = useState<Set<BodyId>>(() => new Set())
  const [upgradeFor, setUpgradeFor] = useState<Body | null>(null)
  const [audioOn, setAudioOn] = useState(false)
  const audioRef = useRef<OrbitAudio | null>(null)
  const [tab, setTab] = useState<Tab>('harvest')
  const [tone, setTone] = useState(0)
  const [resonance, setResonance] = useState(0)
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
  const [toneYieldLvl, setToneYieldLvl] = useState(0)
  const [resYieldLvl, setResYieldLvl] = useState(0)
  const slotCapacities = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => (i === 0 ? slot0Capacity : 1)),
    [slotCount, slot0Capacity],
  )

  const toneMul = yieldMultiplier(toneYieldLvl)
  const resMul = yieldMultiplier(resYieldLvl)
  const swellsRef = useRef<Map<BodyId, VoiceState>>(
    new Map(TARGETS.map((b) => [b.id, { held: VOICE_FLOOR_GAIN, releasing: false, armed: true }])),
  )
  const launchRequestRef = useRef<BodyId | null>(null)

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

      const earthAngle = (t / EARTH_PERIOD_S) * 2 * Math.PI

      const positions = ORBITS.map((body, i) => {
        const r = rMin + (rMax - rMin) * (i / (ORBITS.length - 1))
        const angle = (t / periodOf(body)) * 2 * Math.PI
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
      if (a) {
        const tnow = a.graph.ctx.currentTime
        for (const [id, voice] of a.voices) {
          const s = swells.get(id)
          if (!s) continue
          voice.gain.setTargetAtTime(s.held, tnow, 0.04)
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
        // Wrap to shortest signed arc so the probe sweeps with the orbit (CW),
        // not backward across accumulated revolutions.
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
    teardownAudioGraph(audio.graph, audio.stops)
  }, [])

  const handleSoundToggle = useCallback(() => {
    const existing = audioRef.current
    if (existing) {
      audioRef.current = null
      stopAudio(existing)
      setAudioOn(false)
      return
    }

    const graph = createAudioGraph({ lowpassHz: 1500 })
    if (!graph) return
    const { ctx, filter } = graph

    const stops: OscillatorNode[] = []
    const buildVoice = (hz: number, pan: number, baseGain: number, lfoHz: number) => {
      const voice = ctx.createGain()
      voice.gain.value = baseGain
      const panner = ctx.createStereoPanner()
      panner.pan.value = pan
      voice.connect(panner).connect(filter)

      const fund = ctx.createOscillator()
      fund.type = 'sine'
      fund.frequency.value = hz
      const fg = ctx.createGain()
      fg.gain.value = 1
      fund.connect(fg).connect(voice)

      const harm = ctx.createOscillator()
      harm.type = 'sine'
      harm.frequency.value = hz * 2
      const hg = ctx.createGain()
      hg.gain.value = 0.18
      harm.connect(hg).connect(voice)

      const lfo = ctx.createOscillator()
      lfo.frequency.value = lfoHz
      const ld = ctx.createGain()
      ld.gain.value = hz * 0.0025
      lfo.connect(ld)
      ld.connect(fund.frequency)
      ld.connect(harm.frequency)

      fund.start()
      harm.start()
      lfo.start()
      stops.push(fund, harm, lfo)
      return voice
    }

    buildVoice(EARTH_HZ, 0, EARTH_DRONE_GAIN, 0.17)

    const voices = new Map<BodyId, GainNode>()
    TARGETS.forEach((body, i) => {
      const pan = -0.4 + (i / Math.max(1, TARGETS.length - 1)) * 0.8
      const lfoHz = 0.16 + i * 0.015
      const hz = EARTH_HZ * body.ratio
      const swell = swellsRef.current.get(body.id)
      const base = swell ? swell.held : VOICE_FLOOR_GAIN
      voices.set(body.id, buildVoice(hz, pan, base, lfoHz))
    })

    audioRef.current = { graph, voices, stops }
    setAudioOn(true)
  }, [stopAudio])

  useEffect(() => {
    return () => {
      const audio = audioRef.current
      if (!audio) return
      audioRef.current = null
      stopAudio(audio)
    }
  }, [stopAudio])

  const baseIdleRate = computeIdleRate(slots, autoPluckSlots)
  const idleRate = {
    tonePerSec: baseIdleRate.tonePerSec * toneMul,
    resonancePerSec: baseIdleRate.resonancePerSec * resMul,
  }
  const anyAutoPluck = autoPluckSlots.size > 0

  // Off-tab idle accrual. Only runs once at least one slot has auto-pluck
  // — before that the Resonator is a manual game and there's no idle to
  // accrue. On-tab, auto-plucks credit Tone/Resonance directly via the
  // existing callbacks; running the ticker too would double-count. The
  // on-tap and off-tab paths share the same yield multipliers so
  // progression stays consistent across tab switches.
  useEffect(() => {
    if (!anyAutoPluck) return
    if (tab === 'harvest') return
    if (idleRate.tonePerSec === 0 && idleRate.resonancePerSec === 0) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      if (idleRate.tonePerSec > 0) setTone((t) => t + idleRate.tonePerSec * dt)
      if (idleRate.resonancePerSec > 0) setResonance((r) => r + idleRate.resonancePerSec * dt)
    }, 250)
    return () => window.clearInterval(id)
  }, [tab, anyAutoPluck, idleRate.tonePerSec, idleRate.resonancePerSec])

  const handleSlotChange = useCallback((slotIdx: number, newNotes: readonly BodyId[]) => {
    setSlots((prev) => {
      const next = prev.map((s) => s.slice())
      // Same-note exclusion: any note now in this slot must be removed from
      // every other slot. The picker also enforces this but it's the
      // safety net.
      for (const note of newNotes) {
        for (let i = 0; i < next.length; i++) {
          if (i !== slotIdx) next[i] = next[i].filter((n) => n !== note)
        }
      }
      next[slotIdx] = newNotes.slice()
      return next
    })
  }, [])

  const handleUnlock = useCallback((id: BodyId) => {
    if (unlockedIds.includes(id)) return
    const cost = UNLOCK_COSTS[id]
    if (tone < cost.tone || resonance < cost.resonance) return
    setTone((t) => t - cost.tone)
    setResonance((r) => r - cost.resonance)
    setUnlockedIds((prev) => [...prev, id])
  }, [unlockedIds, tone, resonance])

  const handleUnlockAutoPluck = useCallback((slotIdx: number) => {
    if (autoPluckSlots.has(slotIdx)) return
    if (slotIdx >= slotCount) return
    if (unlockedIds.length < AUTO_PLUCK_MIN_UNLOCKS) return
    const cost = autoPluckCost(slotIdx)
    if (tone < cost.tone || resonance < cost.resonance) return
    setTone((t) => t - cost.tone)
    setResonance((r) => r - cost.resonance)
    setAutoPluckSlots((prev) => {
      const next = new Set(prev)
      next.add(slotIdx)
      return next
    })
  }, [autoPluckSlots, slotCount, unlockedIds.length, tone, resonance])

  const handleUnlockSlot = useCallback(() => {
    const nextIdx = slotCount
    if (nextIdx >= MAX_SLOT_COUNT) return
    const cost = SLOT_UNLOCK_COSTS[nextIdx + 1]
    if (!cost) return
    if (tone < cost.tone || resonance < cost.resonance) return
    setTone((t) => t - cost.tone)
    setResonance((r) => r - cost.resonance)
    setSlotCount((c) => c + 1)
    setSlots((prev) => [...prev, []])
  }, [slotCount, tone, resonance])

  const handleUpgradeSlot0Capacity = useCallback(() => {
    const nextCap = slot0Capacity + 1
    if (nextCap > MAX_SLOT0_CAPACITY) return
    const cost = SLOT0_CAPACITY_COSTS[nextCap]
    if (!cost) return
    if (tone < cost.tone || resonance < cost.resonance) return
    setTone((t) => t - cost.tone)
    setResonance((r) => r - cost.resonance)
    setSlot0Capacity(nextCap)
  }, [slot0Capacity, tone, resonance])

  const buyToneYield = useCallback(() => {
    const cost = toneYieldCost(toneYieldLvl)
    if (resonance < cost) return
    setResonance((r) => r - cost)
    setToneYieldLvl((l) => l + 1)
  }, [toneYieldLvl, resonance])

  const buyResYield = useCallback(() => {
    const cost = resYieldCost(resYieldLvl)
    if (tone < cost) return
    setTone((t) => t - cost)
    setResYieldLvl((l) => l + 1)
  }, [resYieldLvl, tone])

  // Next 1–2 ladder steps the player hasn't unlocked yet.
  const nextUnlocks = UNLOCK_LADDER.filter((id) => !unlockedIds.includes(id)).slice(0, 2)
  // Slot unlock card — show once the previous slot exists AND the gating
  // note (if any) is unlocked.
  const nextSlotIdx = slotCount + 1
  const slotGate = SLOT_UNLOCK_GATES[nextSlotIdx]
  const slotGatePassed = slotGate ? unlockedIds.includes(slotGate) : true
  const nextSlotCost = slotGatePassed ? SLOT_UNLOCK_COSTS[nextSlotIdx] : undefined
  const canAffordSlot = nextSlotCost ? tone >= nextSlotCost.tone && resonance >= nextSlotCost.resonance : false
  // Slot 0 capacity upgrade — only show once the player has 2+ unlocked
  // notes (otherwise stacking has nothing useful to put in the chord).
  const nextSlot0Cap = slot0Capacity + 1
  const slot0CapCost =
    nextSlot0Cap <= MAX_SLOT0_CAPACITY && unlockedIds.length >= 2
      ? SLOT0_CAPACITY_COSTS[nextSlot0Cap]
      : undefined
  const canAffordSlot0Cap = slot0CapCost
    ? tone >= slot0CapCost.tone && resonance >= slot0CapCost.resonance
    : false
  // Auto-pluck cards — one per existing slot that isn't auto-plucked yet.
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

  return (
    <main>
      <h1>Orbital</h1>
      <p className="tagline">
        {tab === 'orbits'
          ? 'Diatonic wheel · Earth tonic · tap to launch, hold to upgrade'
          : 'Resonator · tap a note · catch its overtones'}
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
      <dl className="currencies" aria-label="Currencies">
        <div>
          <dt>Tone</dt>
          <dd>{Math.floor(tone)}</dd>
        </div>
        <div>
          <dt>Resonance</dt>
          <dd>{resonance.toFixed(1)}</dd>
        </div>
      </dl>
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
            onSlotChange={handleSlotChange}
            onTone={(d) => setTone((t) => t + d * toneMul)}
            onResonance={(d) => setResonance((r) => r + d * resMul)}
          />
          <section className="resonator-progress" aria-label="Progression">
            {anyAutoPluck && (
              <p className="idle-rate">
                Idle{' '}
                <span>
                  <strong>{idleRate.resonancePerSec.toFixed(2)}</strong> res/s
                </span>
                {' · '}
                <span>
                  <strong>{idleRate.tonePerSec.toFixed(2)}</strong> tone/s
                </span>
              </p>
            )}
            <ul className="upgrades" role="list">
              <li className="upgrade">
                <div className="upgrade-info">
                  <span className="upgrade-name">Tone yield</span>
                  <span className="upgrade-stat">×{toneMul.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  className="upgrade-btn"
                  disabled={resonance < toneYieldCost(toneYieldLvl)}
                  onClick={buyToneYield}
                >
                  ×{(toneMul * YIELD_STEP).toFixed(2)} · {toneYieldCost(toneYieldLvl)} Res
                </button>
              </li>
              <li className="upgrade">
                <div className="upgrade-info">
                  <span className="upgrade-name">Resonance yield</span>
                  <span className="upgrade-stat">×{resMul.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  className="upgrade-btn"
                  disabled={tone < resYieldCost(resYieldLvl)}
                  onClick={buyResYield}
                >
                  ×{(resMul * YIELD_STEP).toFixed(2)} · {resYieldCost(resYieldLvl)} Tone
                </button>
              </li>
            </ul>
            {(nextUnlocks.length > 0 ||
              nextSlotCost ||
              slot0CapCost ||
              autoPluckSlotsToOffer.length > 0) && (
              <ul className="unlocks" role="list">
                {nextUnlocks.map((id, i) => {
                  const cost = UNLOCK_COSTS[id]
                  const affordable = tone >= cost.tone && resonance >= cost.resonance
                  return (
                    <li key={id} className={`unlock${i === 0 ? ' next' : ''}`}>
                      <div className="unlock-info">
                        <span className="unlock-note">{id}</span>
                        <span className="unlock-cost">
                          {cost.tone} Tone
                          {cost.resonance > 0 ? ` · ${cost.resonance} Resonance` : ''}
                        </span>
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
                      <span className="unlock-cost">
                        {nextSlotCost.tone} Tone
                        {nextSlotCost.resonance > 0 ? ` · ${nextSlotCost.resonance} Resonance` : ''}
                      </span>
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
                      <span className="unlock-cost">
                        {slot0CapCost.tone} Tone · {slot0CapCost.resonance} Resonance
                      </span>
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
                  const affordable = tone >= cost.tone && resonance >= cost.resonance
                  return (
                    <li key={`auto-${slotIdx}`} className="unlock unlock-auto">
                      <div className="unlock-info">
                        <span className="unlock-note">⚡ Auto-pluck slot {slotIdx + 1}</span>
                        <span className="unlock-cost">
                          {cost.tone} Tone · {cost.resonance} Resonance
                        </span>
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
          </section>
        </>
      )}
    </main>
  )
}

export default App
