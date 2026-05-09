import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import type { Body, BodyId } from './bodies'
import { BODIES, EARTH, EARTH_PERIOD_S, TARGETS, periodOf } from './bodies'
import { PlanetTile } from './PlanetTile'
import { UpgradePanel } from './UpgradePanel'

const WINDOW_THRESHOLD_RAD = 0.18
const PROBE_DURATION_S = 1.4

type Probe = { startMs: number }
type ArmedMap = Partial<Record<BodyId, boolean>>

const ORBITS = [...BODIES].sort((a, b) => a.ratio - b.ratio) // Earth innermost, B outermost

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const probesRef = useRef<Map<BodyId, Probe>>(new Map())
  const armedRef = useRef<ArmedMap>({})
  const [armed, setArmed] = useState<ArmedMap>({})
  const [flying, setFlying] = useState<Set<BodyId>>(() => new Set())
  const [upgradeFor, setUpgradeFor] = useState<Body | null>(null)

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
        return { body, angle, r }
      })
      const earthPos = positions.find((p) => p.body.id === EARTH.id)!

      const nextArmed: ArmedMap = {}
      for (const { body, angle } of positions) {
        if (body.id === EARTH.id) continue
        let delta = Math.abs((earthAngle - angle) % (2 * Math.PI))
        if (delta > Math.PI) delta = 2 * Math.PI - delta
        nextArmed[body.id] = delta < WINDOW_THRESHOLD_RAD
      }

      ctx.strokeStyle = border
      ctx.lineWidth = 1
      for (const { r } of positions) {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, 2 * Math.PI)
        ctx.stroke()
      }

      for (const { body, angle, r } of positions) {
        if (body.id === EARTH.id) continue
        if (!nextArmed[body.id]) continue
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        ctx.fillStyle = accentBg
        ctx.beginPath()
        ctx.arc(px, py, 13, 0, 2 * Math.PI)
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

      const prev = armedRef.current
      let changed = false
      for (const body of TARGETS) {
        if ((prev[body.id] ?? false) !== (nextArmed[body.id] ?? false)) {
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

  const onLaunch = useCallback((body: Body) => {
    if (!armedRef.current[body.id]) return
    if (probesRef.current.has(body.id)) return
    probesRef.current.set(body.id, { startMs: performance.now() })
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
