import { useCallback, useEffect, useRef, useState } from 'react'
import { AMSynth, Context, FMSynth, Gain, Panner, PluckSynth, setContext } from 'tone'
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

// Each body strikes once per orbital period. The "swell" envelope from the
// proximity logic is sampled at strike time and becomes the note's velocity:
// distant bodies tick quietly, alignments crescendo, a launch resolves and
// drops the body back to a floor velocity.
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
type AudioGraph = {
  ctx: AudioContext
  master: Gain
  voices: Map<BodyId, ToneVoice>
  earth: ToneVoice
  audioEl: HTMLAudioElement | null
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

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const probesRef = useRef<Map<BodyId, Probe>>(new Map())
  const armedRef = useRef<ArmedMap>({})
  const [armed, setArmed] = useState<ArmedMap>({})
  const [flying, setFlying] = useState<Set<BodyId>>(() => new Set())
  const [upgradeFor, setUpgradeFor] = useState<Body | null>(null)
  const [audioOn, setAudioOn] = useState(false)
  const [timbre, setTimbre] = useState<Timbre>('pluck')
  const audioRef = useRef<AudioGraph | null>(null)
  const swellsRef = useRef<Map<BodyId, VoiceState>>(
    new Map(TARGETS.map((b) => [b.id, { held: VOICE_FLOOR_GAIN, releasing: false, armed: true }])),
  )
  const launchRequestRef = useRef<BodyId | null>(null)
  const phaseRef = useRef<Map<BodyId, number>>(new Map())

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
      const phases = phaseRef.current
      const strike = (voice: ToneVoice, velocity: number) => {
        if (!a) return
        const v = Math.max(0, Math.min(1, velocity))
        if (v < 0.001) return
        voice.synth.triggerAttackRelease(voice.freq, STRIKE_DURATION, undefined, v)
      }
      for (const { body } of positions) {
        const phase = (t / periodOf(body)) % 1
        const last = phases.get(body.id)
        phases.set(body.id, phase)
        if (last === undefined) continue
        const wrapped = phase < last
        if (!wrapped) continue
        if (!a) continue
        if (body.id === EARTH.id) {
          strike(a.earth, EARTH_VELOCITY)
        } else {
          const voice = a.voices.get(body.id)
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

  // iOS Safari only honors AudioContext.resume() called *synchronously* inside the
  // user gesture that started it. Doing it from a useEffect after a setState (the
  // previous shape of this code) leaves the context suspended on iPhone and no sound
  // plays. Build the whole graph inside the click handler instead.
  const stopAudio = useCallback((graph: AudioGraph) => {
    const { ctx, master, voices, earth, audioEl } = graph
    master.gain.rampTo(0, 0.3)
    window.setTimeout(() => {
      for (const v of voices.values()) {
        v.synth.dispose()
        v.panner.dispose()
      }
      earth.synth.dispose()
      earth.panner.dispose()
      master.dispose()
      if (audioEl) {
        audioEl.pause()
        audioEl.srcObject = null
      }
      void ctx.close()
    }, 450)
  }, [])

  const buildAudio = useCallback((nextTimbre: Timbre): AudioGraph | null => {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    void ctx.resume()
    // 1-sample silent buffer: legacy iOS unlock so subsequent oscillator output is audible.
    const unlock = ctx.createBufferSource()
    unlock.buffer = ctx.createBuffer(1, 1, 22050)
    unlock.connect(ctx.destination)
    unlock.start(0)

    setContext(new Context({ context: ctx }))

    const master = new Gain(0)
    master.gain.rampTo(1, 0.6)

    // iOS routes raw WebAudio through the "ambient" audio session category,
    // which the silent/ringer switch mutes. Routing master → MediaStream →
    // <audio playsinline> uses the "playback" category instead, so the drone
    // plays even with silent mode on. Falls back to ctx.destination if the
    // browser doesn't support MediaStream output.
    let audioEl: HTMLAudioElement | null
    try {
      const streamDest = ctx.createMediaStreamDestination()
      master.connect(streamDest)
      audioEl = document.createElement('audio')
      audioEl.setAttribute('playsinline', '')
      audioEl.autoplay = true
      audioEl.srcObject = streamDest.stream
      void audioEl.play()
    } catch {
      audioEl = null
      master.connect(ctx.destination)
    }

    const buildVoice = (hz: number, pan: number): ToneVoice => {
      const synth = buildSynth(nextTimbre)
      const panner = new Panner(pan)
      synth.connect(panner)
      panner.connect(master)
      return { synth, panner, freq: hz }
    }

    const earth = buildVoice(EARTH_HZ, 0)
    const voices = new Map<BodyId, ToneVoice>()
    TARGETS.forEach((body, i) => {
      const pan = -0.4 + (i / Math.max(1, TARGETS.length - 1)) * 0.8
      const hz = EARTH_HZ * body.ratio
      voices.set(body.id, buildVoice(hz, pan))
    })

    return { ctx, master, voices, earth, audioEl, timbre: nextTimbre }
  }, [])

  const handleSoundToggle = useCallback(() => {
    const existing = audioRef.current
    if (existing) {
      audioRef.current = null
      stopAudio(existing)
      setAudioOn(false)
      return
    }
    const graph = buildAudio(timbre)
    if (!graph) return
    // Prime phases just below 1 so the next frame detects a wrap and every body
    // strikes a tonic chord immediately on enable, rather than waiting up to a
    // full period for its first natural wraparound.
    phaseRef.current.clear()
    for (const body of BODIES) phaseRef.current.set(body.id, 0.999)
    audioRef.current = graph
    setAudioOn(true)
  }, [buildAudio, stopAudio, timbre])

  const handleTimbreChange = useCallback(
    (next: Timbre) => {
      setTimbre(next)
      const existing = audioRef.current
      if (!existing) return
      audioRef.current = null
      stopAudio(existing)
      const graph = buildAudio(next)
      if (!graph) {
        setAudioOn(false)
        return
      }
      // Prime phases just below 1 so the next frame detects a wrap and every body
    // strikes a tonic chord immediately on enable, rather than waiting up to a
    // full period for its first natural wraparound.
    phaseRef.current.clear()
    for (const body of BODIES) phaseRef.current.set(body.id, 0.999)
      audioRef.current = graph
    },
    [buildAudio, stopAudio],
  )

  useEffect(() => {
    return () => {
      const graph = audioRef.current
      if (!graph) return
      audioRef.current = null
      stopAudio(graph)
    }
  }, [stopAudio])

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
    </main>
  )
}

export default App
