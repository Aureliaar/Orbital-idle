import { useEffect, useRef, useState } from 'react'
import './App.css'

const EARTH_PERIOD_S = 8
const MEDIANT_PERIOD_S = (EARTH_PERIOD_S * 4) / 5
const DOMINANT_PERIOD_S = (EARTH_PERIOD_S * 2) / 3
const PROBE_DURATION_S = 1.0
const ALIGN_LINE_PROXIMITY = 0.93

// Earth → A2 (110 Hz). 5:4 puts Mediant on C#3, 3:2 puts Dominant on E3.
// Together: a just-tuned A major triad (4:5:6).
const AUDIO_TRANSPOSE = 110 / (1 / EARTH_PERIOD_S)
const EARTH_HZ = (1 / EARTH_PERIOD_S) * AUDIO_TRANSPOSE
const MEDIANT_HZ = (1 / MEDIANT_PERIOD_S) * AUDIO_TRANSPOSE
const DOMINANT_HZ = (1 / DOMINANT_PERIOD_S) * AUDIO_TRANSPOSE

// Earth is the constant tonic. Each non-tonic voice peak-and-holds: gain
// climbs slowly toward a proximity-driven target and never decays back on
// its own. Pressing launch triggers the release that resolves the chord.
const EARTH_DRONE_GAIN = 0.025
const VOICE_FLOOR_GAIN = 0.002
const VOICE_PEAK_GAIN = 0.22
const SWELL_ATTACK_TAU = 1.8
const SWELL_DECAY_TAU = 3.5
const SWELL_RELEASE_TAU = 0.55
const LAUNCH_ARM_GAIN = VOICE_PEAK_GAIN * 0.55
// After a launch the voice stays disarmed (won't rebuild) until its target
// drops back near floor, so the body has to actually leave the area before
// the next swell can begin.
const REARM_TARGET = VOICE_FLOOR_GAIN + (VOICE_PEAK_GAIN - VOICE_FLOOR_GAIN) * 0.05

type Probe = { startMs: number; angle: number; rStart: number; rEnd: number }
type VoiceState = { held: number; releasing: boolean; armed: boolean }
type AudioGraph = { ctx: AudioContext; master: GainNode; voices: GainNode[] }

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [armed, setArmed] = useState(false)
  const [audioOn, setAudioOn] = useState(false)
  const probeRef = useRef<Probe | null>(null)
  const audioRef = useRef<AudioGraph | null>(null)
  const swellsRef = useRef<VoiceState[]>([
    { held: VOICE_FLOOR_GAIN, releasing: false, armed: true },
    { held: VOICE_FLOOR_GAIN, releasing: false, armed: true },
  ])
  const launchTargetRef = useRef<{ angle: number; rStart: number; rEnd: number } | null>(null)
  const launchPendingRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

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
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx2d.clearRect(0, 0, cssW, cssH)

      const cx = cssW / 2
      const cy = cssH / 2
      const R = Math.min(cssW, cssH) * 0.4
      const rOuter = R
      const rMid = R * 0.81
      const rInner = R * 0.62

      const earthAngle = (t / EARTH_PERIOD_S) * 2 * Math.PI
      const medAngle = (t / MEDIANT_PERIOD_S) * 2 * Math.PI
      const domAngle = (t / DOMINANT_PERIOD_S) * 2 * Math.PI

      const styles = getComputedStyle(document.documentElement)
      const border = styles.getPropertyValue('--border').trim() || '#e5e4e7'
      const accent = styles.getPropertyValue('--accent').trim() || '#aa3bff'
      const accentBg = styles.getPropertyValue('--accent-bg').trim() || 'rgba(170,59,255,0.1)'
      const textH = styles.getPropertyValue('--text-h').trim() || '#08060d'

      const angleDelta = (a: number) => {
        let d = Math.abs(((earthAngle - a) % (2 * Math.PI)))
        if (d > Math.PI) d = 2 * Math.PI - d
        return d
      }

      const bodies = [
        { delta: angleDelta(medAngle), angle: medAngle, ring: rMid },
        { delta: angleDelta(domAngle), angle: domAngle, ring: rInner },
      ]

      const swells = swellsRef.current
      if (launchPendingRef.current) {
        launchPendingRef.current = false
        for (const s of swells) {
          if (s.held > VOICE_FLOOR_GAIN + 0.001) {
            s.releasing = true
            s.armed = false
          }
        }
      }
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]
        const s = swells[i]
        const proximity = 1 - b.delta / Math.PI
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
        for (let i = 0; i < swells.length; i++) {
          a.voices[i].gain.setTargetAtTime(swells[i].held, tnow, 0.04)
        }
      }

      let bestIdx = -1
      let bestGain = LAUNCH_ARM_GAIN
      for (let i = 0; i < swells.length; i++) {
        if (!swells[i].releasing && swells[i].held > bestGain) {
          bestGain = swells[i].held
          bestIdx = i
        }
      }
      const isArmed = bestIdx >= 0
      launchTargetRef.current = isArmed
        ? { angle: bodies[bestIdx].angle, rStart: bodies[bestIdx].ring, rEnd: rOuter }
        : null

      ctx2d.strokeStyle = border
      ctx2d.lineWidth = 1
      for (const r of [rOuter, rMid, rInner]) {
        ctx2d.beginPath()
        ctx2d.arc(cx, cy, r, 0, 2 * Math.PI)
        ctx2d.stroke()
      }

      const ex = cx + Math.cos(earthAngle) * rOuter
      const ey = cy + Math.sin(earthAngle) * rOuter

      ctx2d.strokeStyle = accent
      ctx2d.fillStyle = accentBg
      ctx2d.lineWidth = 1.5
      for (const b of bodies) {
        const proximity = 1 - b.delta / Math.PI
        if (proximity > ALIGN_LINE_PROXIMITY) {
          const px = cx + Math.cos(b.angle) * b.ring
          const py = cy + Math.sin(b.angle) * b.ring
          ctx2d.beginPath()
          ctx2d.moveTo(ex, ey)
          ctx2d.lineTo(px, py)
          ctx2d.stroke()
        }
      }

      ctx2d.fillStyle = textH
      ctx2d.beginPath()
      ctx2d.arc(cx, cy, 3, 0, 2 * Math.PI)
      ctx2d.fill()

      ctx2d.fillStyle = textH
      ctx2d.beginPath()
      ctx2d.arc(ex, ey, 7, 0, 2 * Math.PI)
      ctx2d.fill()

      ctx2d.fillStyle = accent
      for (const b of bodies) {
        const bx = cx + Math.cos(b.angle) * b.ring
        const by = cy + Math.sin(b.angle) * b.ring
        ctx2d.beginPath()
        ctx2d.arc(bx, by, 5.5, 0, 2 * Math.PI)
        ctx2d.fill()
      }

      const probe = probeRef.current
      if (probe) {
        const u = (now - probe.startMs) / 1000 / PROBE_DURATION_S
        if (u >= 1) {
          probeRef.current = null
        } else {
          const r = probe.rStart + (probe.rEnd - probe.rStart) * u
          const ppx = cx + Math.cos(probe.angle) * r
          const ppy = cy + Math.sin(probe.angle) * r
          ctx2d.fillStyle = accent
          ctx2d.beginPath()
          ctx2d.arc(ppx, ppy, 3.5, 0, 2 * Math.PI)
          ctx2d.fill()
        }
      }

      setArmed((prev) => (prev === isArmed ? prev : isArmed))
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
    filter.frequency.value = 1200
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
    const med = buildVoice(MEDIANT_HZ, -0.3, swellsRef.current[0].held, 0.21)
    const dom = buildVoice(DOMINANT_HZ, 0.3, swellsRef.current[1].held, 0.19)
    audioRef.current = { ctx, master, voices: [med, dom] }

    return () => {
      audioRef.current = null
      const t = ctx.currentTime
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(master.gain.value, t)
      master.gain.linearRampToValueAtTime(0, t + 0.3)
      for (const o of stops) o.stop(t + 0.35)
      window.setTimeout(() => void ctx.close(), 450)
    }
  }, [audioOn])

  const onLaunch = () => {
    const target = launchTargetRef.current
    if (!target || probeRef.current) return
    launchPendingRef.current = true
    probeRef.current = {
      startMs: performance.now(),
      angle: target.angle,
      rStart: target.rStart,
      rEnd: target.rEnd,
    }
  }

  return (
    <main>
      <h1>Orbital</h1>
      <p className="tagline">Earth · Mediant · Dominant — 4:5:6 chord</p>
      <canvas ref={canvasRef} className="orbit" aria-label="Three bodies in 4:5:6 resonance" />
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
        <button
          type="button"
          className={`launch${armed ? ' armed' : ''}`}
          onClick={onLaunch}
          disabled={!armed}
          aria-label="Launch transfer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 L19 19 L12 15 L5 19 Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </main>
  )
}

export default App
