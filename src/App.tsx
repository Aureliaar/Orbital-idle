import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import type { Body, BodyId } from './bodies'
import { BODIES, EARTH, EARTH_PERIOD_S, TARGETS, periodOf } from './bodies'
import { PlanetTile } from './PlanetTile'
import { UpgradePanel } from './UpgradePanel'

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
type AudioGraph = { ctx: AudioContext; master: GainNode; voices: Map<BodyId, GainNode> }

const ORBITS = [...BODIES].sort((a, b) => a.ratio - b.ratio)

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const probesRef = useRef<Map<BodyId, Probe>>(new Map())
  const armedRef = useRef<ArmedMap>({})
  const [armed, setArmed] = useState<ArmedMap>({})
  const [flying, setFlying] = useState<Set<BodyId>>(() => new Set())
  const [upgradeFor, setUpgradeFor] = useState<Body | null>(null)
  const [audioOn, setAudioOn] = useState(false)
  const audioRef = useRef<AudioGraph | null>(null)
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
        const tnow = a.ctx.currentTime
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
        const angle = earthAngle + (target.angle - earthAngle) * u
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

  useEffect(() => {
    if (!audioOn) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    void ctx.resume()

    const master = ctx.createGain()
    master.gain.value = 0
    master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1500
    filter.Q.value = 0.5
    filter.connect(master).connect(ctx.destination)

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

    audioRef.current = { ctx, master, voices }

    return () => {
      audioRef.current = null
      const tnow = ctx.currentTime
      master.gain.cancelScheduledValues(tnow)
      master.gain.setValueAtTime(master.gain.value, tnow)
      master.gain.linearRampToValueAtTime(0, tnow + 0.3)
      for (const o of stops) o.stop(tnow + 0.35)
      window.setTimeout(() => void ctx.close(), 450)
    }
  }, [audioOn])

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
      <p className="tagline">Diatonic wheel · Earth tonic · tap to launch, hold to upgrade</p>
      <div className="controls">
        <button
          type="button"
          className={`sound${audioOn ? ' on' : ''}`}
          onClick={() => setAudioOn((v) => !v)}
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
    </main>
  )
}

export default App
