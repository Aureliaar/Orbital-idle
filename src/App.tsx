import { useEffect, useRef, useState } from 'react'
import './App.css'

const EARTH_PERIOD_S = 8
const DOMINANT_PERIOD_S = (EARTH_PERIOD_S * 2) / 3
const WINDOW_THRESHOLD_RAD = 0.18
const PROBE_DURATION_S = 1.0

type Probe = { startMs: number }

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const probeRef = useRef<Probe | null>(null)

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
        ctx.fillStyle = accentBg
        const ex = cx + Math.cos(earthAngle) * rOuter
        const ey = cy + Math.sin(earthAngle) * rOuter
        const dx = cx + Math.cos(domAngle) * rInner
        const dy = cy + Math.sin(domAngle) * rInner
        ctx.beginPath()
        ctx.arc(ex, ey, 16, 0, 2 * Math.PI)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(dx, dy, 14, 0, 2 * Math.PI)
        ctx.fill()
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
          const px = cx + Math.cos(earthAngle) * r
          const py = cy + Math.sin(earthAngle) * r
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

  const onLaunch = () => {
    if (!windowOpen || probeRef.current) return
    probeRef.current = { startMs: performance.now() }
  }

  return (
    <main>
      <h1>Orbital</h1>
      <p className="tagline">Earth · Dominant — 3:2 resonance</p>
      <canvas ref={canvasRef} className="orbit" aria-label="Two bodies in 3:2 resonance" />
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
    </main>
  )
}

export default App
