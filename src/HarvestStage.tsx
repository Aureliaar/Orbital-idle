import { useCallback, useEffect, useRef, useState } from 'react'
import { createAudioGraph, teardownAudioGraph } from './audio'
import type { AudioGraph } from './audio'
import {
  defaultAmp,
  harmonicSeries,
  scanCoincidences,
} from './harmonics'
import type { Coincidence, Harmonic } from './harmonics'

// Tonic frequency: C3 (130.81 Hz). Matches the orbital stage's EARTH_HZ so
// dropping the harvest pluck synth on top of the orbital drone stays in tune.
const TONIC_HZ = 261.63 / 2

// How many partials per tap. With H1..H4, the first coincidence for octave
// (2:1), fifth (3:2), and fourth (4:3) is reachable; thirds (5:4, 6:5) need
// H≥5; M2 (9:8) needs H≥8; M7 (15:8) needs H≥15. That's the unlock ladder.
const HARMONIC_COUNT = 4

// Single source of truth for "how long does a tap ring?" — visual partials
// fade linearly to zero over this window, the pluck synth's envelope ends
// at the same instant, and a tapped pad stays on cooldown for the same
// duration. Anything else creates the visual-vs-audio mismatch.
const RING_DURATION_S = 1.5
const RING_DURATION_MS = RING_DURATION_S * 1000

// Coincidence detection tolerance — 0.5% ≈ 8.6 cents. Just-intonation pairs
// match exactly; the slack is forgiveness for future equal-temperament.
const COINCIDENCE_TOL = 0.005

// Tuned so a perfect-fifth coincidence (H3·H2 = 1/3·1/2 ≈ 0.167) tapped
// near the start of the ring gives ~5 Resonance.
const RESONANCE_GAIN = 32
const TONE_PER_TAP = 1

// Pluck synth envelope.
const PLUCK_GAIN = 0.18
const PLUCK_HIT_BOOST = 2.2

const BURST_MS = 600

type Pad = {
  id: string
  label: string
  ratio: number
  ratioLabel: string
  color: string
  // Keyboard binding (lowercase, single key). Pads beyond ASDF will need
  // more keys in PAD_KEYS once the unlock ladder ships.
  key: string
}

// Diatonic-color mapping (Newton / Boomwhacker tradition). Reserved up-front
// for all seven unlock-ladder pads so cloud partials can be colored by
// noteId regardless of which pads have shipped yet.
const PAD_COLORS: Record<string, string> = {
  C: '#dc4836', // red
  D: '#dd8a36', // orange
  E: '#c9a83a', // gold
  F: '#4aa84a', // green
  G: '#3a9fb8', // teal
  A: '#3a6dc8', // blue
  B: '#9a3ac8', // violet
}

// Unlock ladder per the design plan: C → G → E → F → D → A → B. Keys assigned
// left-to-right on the home row — first four pads cover ASDF.
const PAD_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j']
const PADS: Pad[] = [
  { id: 'C', label: 'C', ratio: 1,     ratioLabel: '1:1', color: PAD_COLORS.C, key: PAD_KEYS[0] },
  { id: 'G', label: 'G', ratio: 3 / 2, ratioLabel: '3:2', color: PAD_COLORS.G, key: PAD_KEYS[1] },
]

type Burst = { id: number; freq: number; bornMs: number; magnitude: number }

type Props = {
  onTone: (delta: number) => void
  onResonance: (delta: number) => void
}

export function HarvestStage({ onTone, onResonance }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<AudioGraph | null>(null)
  const cloudRef = useRef<Harmonic[]>([])
  const burstsRef = useRef<Burst[]>([])
  const nextBurstIdRef = useRef(1)
  const coolingRef = useRef<Set<string>>(new Set())
  const [cooling, setCooling] = useState<ReadonlySet<string>>(() => new Set())
  const onToneRef = useRef(onTone)
  const onResonanceRef = useRef(onResonance)

  useEffect(() => {
    onToneRef.current = onTone
  }, [onTone])
  useEffect(() => {
    onResonanceRef.current = onResonance
  }, [onResonance])

  // rAF: decay cloud + bursts, redraw spectrum strip.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    let raf = 0
    let last = performance.now()

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      // Linear decay over RING_DURATION_S so visuals die at exactly the same
      // instant the audio envelope ends. amp drops by (bornAmp / ring) per
      // second; pruned the moment it crosses zero.
      const cloud = cloudRef.current
      let w = 0
      for (let i = 0; i < cloud.length; i++) {
        const h = cloud[i]
        h.amp -= h.bornAmp * (dt / RING_DURATION_S)
        if (h.amp > 0) cloud[w++] = h
      }
      cloud.length = w

      const bursts = burstsRef.current
      let bw = 0
      for (let i = 0; i < bursts.length; i++) {
        if (now - bursts[i].bornMs < BURST_MS) bursts[bw++] = bursts[i]
      }
      bursts.length = bw

      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = Math.max(1, cssW * dpr)
        canvas.height = Math.max(1, cssH * dpr)
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx2d.clearRect(0, 0, cssW, cssH)

      const styles = getComputedStyle(document.documentElement)
      const accent = styles.getPropertyValue('--accent').trim() || '#aa3bff'
      const border = styles.getPropertyValue('--border').trim() || '#e5e4e7'
      const textH = styles.getPropertyValue('--text-h').trim() || '#08060d'

      const maxRatio = PADS.reduce((m, p) => (p.ratio > m ? p.ratio : m), 1)
      const fMin = TONIC_HZ * 0.95
      const fMax = TONIC_HZ * maxRatio * HARMONIC_COUNT * 1.05
      const padX = 14
      const xOf = (f: number) => {
        const u = Math.log(f / fMin) / Math.log(fMax / fMin)
        return padX + (cssW - 2 * padX) * Math.max(0, Math.min(1, u))
      }
      const baselineY = cssH - 18

      // baseline + pad ticks (each tick takes its pad's color)
      ctx2d.strokeStyle = border
      ctx2d.lineWidth = 1
      ctx2d.beginPath()
      ctx2d.moveTo(0, baselineY)
      ctx2d.lineTo(cssW, baselineY)
      ctx2d.stroke()
      ctx2d.font = '10px ui-monospace, Menlo, Consolas, monospace'
      ctx2d.textAlign = 'center'
      ctx2d.textBaseline = 'top'
      for (const p of PADS) {
        const x = xOf(TONIC_HZ * p.ratio)
        ctx2d.strokeStyle = p.color
        ctx2d.beginPath()
        ctx2d.moveTo(x, baselineY)
        ctx2d.lineTo(x, baselineY + 4)
        ctx2d.stroke()
        ctx2d.fillStyle = withAlpha(p.color, 0.85)
        ctx2d.fillText(p.label, x, baselineY + 6)
      }

      // Cloud partials, colored by emitting pad, with the fundamental (H1)
      // visually distinguished from its overtones (H2+):
      //   H1: thick stick, large filled dot, note-letter label above
      //   H2+: thinner stick, smaller dot, tiny partial-number label
      const stickMax = cssH - 38
      ctx2d.textBaseline = 'alphabetic'
      for (const h of cloud) {
        const x = xOf(h.freq)
        const norm = Math.max(0, Math.min(1, h.amp / Math.max(h.bornAmp, 1e-6)))
        const len = stickMax * 0.85 * norm
        const opacity = Math.max(0.15, norm)
        const color = PAD_COLORS[h.noteId] ?? accent
        const isFund = h.partial === 1

        ctx2d.strokeStyle = withAlpha(color, opacity * (isFund ? 0.85 : 0.5))
        ctx2d.lineWidth = isFund ? 3 : 1.5
        ctx2d.beginPath()
        ctx2d.moveTo(x, baselineY - 1)
        ctx2d.lineTo(x, baselineY - 1 - len)
        ctx2d.stroke()

        const topY = baselineY - 1 - len
        ctx2d.fillStyle = withAlpha(color, opacity)
        ctx2d.beginPath()
        ctx2d.arc(x, topY, isFund ? 4.5 : 2.2, 0, 2 * Math.PI)
        ctx2d.fill()

        if (isFund) {
          ctx2d.font = '11px ui-monospace, Menlo, Consolas, monospace'
          ctx2d.textAlign = 'center'
          ctx2d.fillStyle = withAlpha(color, opacity)
          ctx2d.fillText(h.noteId, x, topY - 7)
        } else if (norm > 0.3) {
          ctx2d.font = '9px ui-monospace, Menlo, Consolas, monospace'
          ctx2d.textAlign = 'left'
          ctx2d.fillStyle = withAlpha(color, opacity * 0.8)
          ctx2d.fillText(String(h.partial), x + 4, topY + 3)
        }
      }

      // coincidence bursts
      for (const b of bursts) {
        const u = (now - b.bornMs) / BURST_MS
        const x = xOf(b.freq)
        const y = baselineY - stickMax * 0.5
        const r = 6 + 28 * u * Math.min(1, b.magnitude * 4)
        const alpha = (1 - u) * 0.75
        ctx2d.fillStyle = withAlpha(accent, alpha * 0.35)
        ctx2d.beginPath()
        ctx2d.arc(x, y, r, 0, 2 * Math.PI)
        ctx2d.fill()
        ctx2d.strokeStyle = withAlpha(accent, alpha)
        ctx2d.lineWidth = 1.5
        ctx2d.beginPath()
        ctx2d.arc(x, y, r, 0, 2 * Math.PI)
        ctx2d.stroke()
      }

      if (cloud.length === 0 && bursts.length === 0) {
        ctx2d.fillStyle = textH
        ctx2d.globalAlpha = 0.35
        ctx2d.textAlign = 'center'
        ctx2d.textBaseline = 'middle'
        ctx2d.font = '12px ui-monospace, Menlo, Consolas, monospace'
        ctx2d.fillText('tap a note — its overtones will linger here', cssW / 2, cssH / 2)
        ctx2d.globalAlpha = 1
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Audio teardown on unmount (e.g. tab switch away).
  useEffect(() => {
    return () => {
      const audio = audioRef.current
      if (audio) {
        audioRef.current = null
        teardownAudioGraph(audio, [])
      }
    }
  }, [])

  const handlePad = useCallback((pad: Pad) => {
    // Cooldown blocks a pad until its prior pluck has fully decayed. This is
    // both UX (no double-trigger spam) and a clean way to prevent same-note
    // self-coincidence: when the cooldown ends, that pad's partials are at
    // amp=0 and have been pruned, so there's nothing in the cloud to match.
    if (coolingRef.current.has(pad.id)) return
    coolingRef.current.add(pad.id)
    setCooling(new Set(coolingRef.current))
    window.setTimeout(() => {
      if (coolingRef.current.delete(pad.id)) {
        setCooling(new Set(coolingRef.current))
      }
    }, RING_DURATION_MS)

    const now = performance.now()
    const fund = TONIC_HZ * pad.ratio
    const incoming = harmonicSeries(fund, HARMONIC_COUNT, defaultAmp)

    const cloud = cloudRef.current
    const { total, hits } = scanCoincidences(cloud, incoming, {
      tolFrac: COINCIDENCE_TOL,
      gain: RESONANCE_GAIN,
    })

    onToneRef.current(TONE_PER_TAP)
    if (total > 0) {
      onResonanceRef.current(total)
      for (const h of hits) {
        burstsRef.current.push({
          id: nextBurstIdRef.current++,
          freq: h.freq,
          bornMs: now,
          magnitude: h.bonus,
        })
      }
    }

    // iOS Safari requires AudioContext.resume() *synchronously* in the gesture.
    // Build the graph lazily, but inside this click handler — never in an effect.
    if (!audioRef.current) {
      const g = createAudioGraph({ lowpassHz: 4000, fadeInS: 0.05 })
      if (g) audioRef.current = g
    }
    const audio = audioRef.current
    if (audio) playPluck(audio, incoming, hits)

    // Push this tap's partials.
    for (const ih of incoming) {
      cloud.push({
        noteId: pad.id,
        partial: ih.partial,
        freq: ih.freq,
        amp: ih.amp,
        bornAmp: ih.amp,
        bornAt: now,
      })
    }
  }, [])

  // Keyboard bindings: each pad's `key` triggers handlePad. Ignored on
  // repeat (cooldown handles spam, but holding a key shouldn't queue) and
  // when a modifier is held so browser shortcuts still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const k = e.key.toLowerCase()
      const pad = PADS.find((p) => p.key === k)
      if (!pad) return
      e.preventDefault()
      handlePad(pad)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlePad])

  return (
    <section className="harvest" aria-label="Resonator stage">
      <canvas ref={canvasRef} className="spectrum" aria-hidden="true" />
      <ul className="pads" role="list">
        {PADS.map((pad) => {
          const isCooling = cooling.has(pad.id)
          return (
            <li key={pad.id}>
              <button
                type="button"
                className={`pad${isCooling ? ' cooling' : ''}`}
                onPointerDown={() => handlePad(pad)}
                disabled={isCooling}
                aria-label={`Play ${pad.label} (key ${pad.key.toUpperCase()})`}
                style={{
                  ['--cooldown-ms' as string]: `${RING_DURATION_MS}ms`,
                  ['--pad-color' as string]: pad.color,
                }}
              >
                <span className="pad-key" aria-hidden="true">{pad.key.toUpperCase()}</span>
                <span className="pad-note">{pad.label}</span>
                <span className="pad-ratio">{pad.ratioLabel}</span>
                <span className="pad-cooldown" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
      <p className="harvest-hint">
        Tap a note (or press its key) for Tone. Hit a second note while the
        first is still ringing and their shared partials pay Resonance.
      </p>
    </section>
  )
}

function playPluck(
  audio: AudioGraph,
  incoming: ReturnType<typeof harmonicSeries>,
  hits: Coincidence[],
): void {
  const { ctx, filter } = audio
  const t0 = ctx.currentTime

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(PLUCK_GAIN, t0 + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + RING_DURATION_S)
  env.connect(filter)

  const boostedPartials = new Set<number>()
  for (const hit of hits) boostedPartials.add(hit.incomingPartial)

  for (const h of incoming) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = h.freq
    const g = ctx.createGain()
    const boost = boostedPartials.has(h.partial) ? PLUCK_HIT_BOOST : 1
    g.gain.value = h.amp * boost
    o.connect(g).connect(env)
    o.start(t0)
    o.stop(t0 + RING_DURATION_S + 0.05)
  }

  // Disconnect the per-tap envelope after it has decayed so we don't pile up
  // dangling nodes on the filter input.
  window.setTimeout(
    () => {
      try {
        env.disconnect()
      } catch {
        // already disconnected (context closed) — ignore.
      }
    },
    (RING_DURATION_S + 0.2) * 1000,
  )
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${a})`
  }
  if (color.startsWith('rgba(')) {
    return color.replace(/,[^,]*\)$/, `,${a})`)
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `,${a})`)
  }
  return color
}
