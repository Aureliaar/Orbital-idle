import { useEffect, useRef, useState } from 'react'
import './App.css'

const EARTH_PERIOD_S = 8
const DOMINANT_PERIOD_S = (EARTH_PERIOD_S * 2) / 3
const WINDOW_THRESHOLD_RAD = 0.18
const PROBE_DURATION_S = 1.0

// Orbital frequencies are sub-audible (0.125 Hz, 0.1875 Hz). Multiply by a
// constant to land Earth on A3 (220 Hz); the 3:2 ratio carries the dominant
// to E4 (330 Hz).
const AUDIO_TRANSPOSE = 220 / (1 / EARTH_PERIOD_S)
const EARTH_HZ = (1 / EARTH_PERIOD_S) * AUDIO_TRANSPOSE
const DOMINANT_HZ = (1 / DOMINANT_PERIOD_S) * AUDIO_TRANSPOSE
const DRONE_GAIN = 0.04
const WINDOW_GAIN = 0.12

type Probe = { startMs: number; angle: number }

type AudioGraph = {
  ctx: AudioContext
  master: GainNode
  earthGain: GainNode
  domGain: GainNode
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const [audioOn, setAudioOn] = useState(false)
  const probeRef = useRef<Probe | null>(null)
  const domAngleRef = useRef(0)
  const audioRef = useRef<AudioGraph | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const start = performance.now()

    const draw = (now: number) => {
      const t = (now - start) / 1000
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
      const rOuter = Math.min(cssW, cssH) * 0.38
      const rInner = rOuter * 0.66

      const earthAngle = (t / EARTH_PERIOD_S) * 2 * Math.PI
      const domAngle = (t / DOMINANT_PERIOD_S) * 2 * Math.PI
      domAngleRef.current = domAngle

      const styles = getComputedStyle(document.documentElement)
      const border = styles.getPropertyValue('--border').trim() || '#e5e4e7'
      const accent = styles.getPropertyValue('--accent').trim() || '#aa3bff'
      const accentBg = styles.getPropertyValue('--accent-bg').trim() || 'rgba(170,59,255,0.1)'
      const textH = styles.getPropertyValue('--text-h').trim() || '#08060d'

      let delta = Math.abs(((earthAngle - domAngle) % (2 * Math.PI)))
      if (delta > Math.PI) delta = 2 * Math.PI - delta
      const open = delta < WINDOW_THRESHOLD_RAD

      ctx.strokeStyle = border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, rInner, 0, 2 * Math.PI)
      ctx.stroke()

      if (open) {
        ctx.strokeStyle = accent
        ctx.fillStyle = accentBg
        ctx.lineWidth = 1.5
        const ex = cx + Math.cos(earthAngle) * rOuter
        const ey = cy + Math.sin(earthAngle) * rOuter
        const dx = cx + Math.cos(domAngle) * rInner
        const dy = cy + Math.sin(domAngle) * rInner
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(dx, dy)
        ctx.stroke()
      }

      ctx.fillStyle = textH
      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI)
      ctx.fill()

      const ex = cx + Math.cos(earthAngle) * rOuter
      const ey = cy + Math.sin(earthAngle) * rOuter
      ctx.fillStyle = textH
      ctx.beginPath()
      ctx.arc(ex, ey, 7, 0, 2 * Math.PI)
      ctx.fill()

      const dx = cx + Math.cos(domAngle) * rInner
      const dy = cy + Math.sin(domAngle) * rInner
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(dx, dy, 6, 0, 2 * Math.PI)
      ctx.fill()

      const probe = probeRef.current
      if (probe) {
        const u = (now - probe.startMs) / 1000 / PROBE_DURATION_S
        if (u >= 1) {
          probeRef.current = null
        } else {
          const r = rInner + (rOuter - rInner) * u
          const px = cx + Math.cos(probe.angle) * r
          const py = cy + Math.sin(probe.angle) * r
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(px, py, 3.5, 0, 2 * Math.PI)
          ctx.fill()
        }
      }

      setWindowOpen((prev) => (prev === open ? prev : open))
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
    master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.4)
    master.connect(ctx.destination)

    const make = (hz: number) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = hz
      const g = ctx.createGain()
      g.gain.value = DRONE_GAIN
      osc.connect(g).connect(master)
      osc.start()
      return { osc, g }
    }

    const earth = make(EARTH_HZ)
    const dom = make(DOMINANT_HZ)
    audioRef.current = { ctx, master, earthGain: earth.g, domGain: dom.g }

    return () => {
      audioRef.current = null
      const t = ctx.currentTime
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(master.gain.value, t)
      master.gain.linearRampToValueAtTime(0, t + 0.15)
      earth.osc.stop(t + 0.2)
      dom.osc.stop(t + 0.2)
      window.setTimeout(() => void ctx.close(), 300)
    }
  }, [audioOn])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const target = windowOpen ? WINDOW_GAIN : DRONE_GAIN
    const t = a.ctx.currentTime
    for (const g of [a.earthGain, a.domGain]) {
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(target, t + 0.18)
    }
  }, [windowOpen, audioOn])

  const onLaunch = () => {
    if (!windowOpen || probeRef.current) return
    probeRef.current = { startMs: performance.now(), angle: domAngleRef.current }
  }

  return (
    <main>
      <h1>Orbital</h1>
      <p className="tagline">Earth · Dominant — 3:2 resonance</p>
      <canvas ref={canvasRef} className="orbit" aria-label="Two bodies in 3:2 resonance" />
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
          className={`launch${windowOpen ? ' armed' : ''}`}
          onClick={onLaunch}
          disabled={!windowOpen}
          aria-label="Launch transfer to outer orbit"
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
