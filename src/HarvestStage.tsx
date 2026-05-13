import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createAudioGraph, teardownAudioGraph } from './audio'
import type { AudioGraph } from './audio'
import { BODIES, ratioLabel as toRatioLabel } from './bodies'
import type { BodyId } from './bodies'
import {
  AUTO_PLUCK_PENALTY,
  COINCIDENCE_TOL,
  FREQ_CURRENCIES,
  FREQ_INTERVAL_LABEL,
  HARMONIC_COUNT,
  MAX_SLOT_COUNT,
  PAD_COLORS,
  RING_DURATION_MS,
  RING_DURATION_S,
  TONIC_HZ,
  freqToCurrency,
} from './harvest-config'
import type { CurrencyPurse } from './harvest-config'
import {
  defaultAmp,
  harmonicSeries,
  scanCoincidences,
} from './harmonics'
import type { Coincidence, Harmonic } from './harmonics'

const PLUCK_GAIN = 0.18
const PLUCK_HIT_BOOST = 2.2

const BURST_MS = 600
const GLOW_LIFE_MS = 420

const SLOT_KEYS = ['a', 's', 'd', 'f']

// Auto-pluck cadence equals slot cooldown so consecutive auto-plucks land
// exactly when the slot becomes available again. Slot 2 fires offset by
// half a cadence so both clouds overlap mid-life — that's when their
// coincidence bonus is biggest.
const AUTO_CADENCE_MS = RING_DURATION_MS
const AUTO_STAGGER_MS = RING_DURATION_MS / 2

// Pitch-helix visualizer math. A frequency `f` maps to pitch `p =
// log2(f/tonic)` (octaves above tonic), and from there to a polar position:
//   radius = r₀ + (rMax − r₀) · (p / P_MAX)         — climbs one ring per octave
//   angle  = ((p mod 1) · 2π) − π/2                 — chroma; C sits at top
// Because every frequency lands on a single (r, θ), coincident partials
// (e.g. C·H3 and G·H2 at 392 Hz) overlap as the same dot — coincidence is
// literal visual overlap, no rotating chord needed. P_MAX is the pitch of
// the highest reachable partial (B·H_HARMONIC_COUNT) so the outermost ring
// always lines up with the ladder's ceiling.
const P_MAX = Math.log2((15 / 8) * HARMONIC_COUNT)

const pitchOf = (freq: number) => Math.log2(freq / TONIC_HZ)
const chromaAngleOf = (freq: number) => {
  const p = pitchOf(freq)
  const frac = ((p % 1) + 1) % 1
  return frac * 2 * Math.PI - Math.PI / 2
}

// SVG viewBox + geometry. The container is square (CSS aspect-ratio: 1),
// so the viewBox is too — no wasted horizontal space, and the helix fills
// the disc. Fixed coordinate system means the renderer never has to listen
// for resize; the CSS scales the <svg> and preserveAspectRatio keeps the
// helix centred at any aspect ratio.
const SVG_NS = 'http://www.w3.org/2000/svg'
const VIEW_W = 400
const VIEW_H = 400
const CX = VIEW_W / 2
const CY = VIEW_H / 2
const R_OUTER = 180
const R_BASE = 64

const radiusOf = (freq: number) => {
  const p = Math.max(0, pitchOf(freq))
  return R_BASE + (R_OUTER - R_BASE) * Math.min(1, p / P_MAX)
}
const polar = (freq: number): [number, number] => {
  const r = radiusOf(freq)
  const a = chromaAngleOf(freq)
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
}

// Locate the currency chip for `key` and return its centre in the helix
// SVG's viewBox coords, or null if the chip isn't mounted (locked currency,
// different tab, etc.). With aspect-ratio:1 on the SVG and a square
// viewBox, the per-axis scale is uniform, so a single ratio converts both
// axes — and points outside the viewBox (the chips sit above it) come back
// with negative y, which is exactly what overflow:visible lets us render.
function chipTargetVB(key: string, svgEl: SVGSVGElement | null): [number, number] | null {
  if (!svgEl) return null
  const chip = document.querySelector(`[data-cur-key="${key}"]`) as HTMLElement | null
  if (!chip) return null
  const chipRect = chip.getBoundingClientRect()
  const svgRect = svgEl.getBoundingClientRect()
  if (svgRect.width === 0 || svgRect.height === 0) return null
  const scale = VIEW_W / svgRect.width
  const x = (chipRect.left + chipRect.width / 2 - svgRect.left) * scale
  const y = (chipRect.top + chipRect.height / 2 - svgRect.top) * scale
  return [x, y]
}

type Burst = {
  id: number
  freq: number
  bornMs: number
  magnitude: number
  // Floating currency reward label from main (e.g. "+f3:2 · P5"); empty
  // string when the coincidence falls outside the harvestable set.
  label: string
  // Note colors of the two coincident partials. The halo is blended from
  // these; the floating label adopts the blend too so the reward visually
  // ties back to the notes that produced it.
  colorIn: string
  colorCloud: string
}

// Soft "noticed" feedback: a single partial just landed on a coincidence
// hint, but no second partial is there yet to actually trigger a payout.
// One brief expanding ring in the partial's color over the hint slot.
type HintGlow = {
  id: number
  freq: number
  bornMs: number
  color: string
}

// Full "properly hit" feedback: a coincidence fired and minted currency.
// Each particle eases from its spawn point to a target — usually the DOM
// rect of the currency chip the payout went to (looked up via
// `data-cur-key`), so the reward visually arrives where the counter ticks
// up. Falls back to a point well above the helix when the chip can't be
// located (locked currency, off-screen, etc.).
type Particle = {
  id: number
  x0: number
  y0: number
  tx: number
  ty: number
  bornMs: number
  life: number
  color: string
  size: number
}

type Props = {
  unlockedIds: readonly BodyId[]
  slots: ReadonlyArray<readonly BodyId[]>
  slotCount: number
  slotCapacities: readonly number[]
  autoPluckSlots: ReadonlySet<number>
  noteYieldMul: (id: BodyId) => number
  onSlotChange: (slotIdx: number, newNotes: readonly BodyId[]) => void
  onEarn: (delta: CurrencyPurse) => void
}

export function HarvestStage({
  unlockedIds,
  slots,
  slotCount,
  slotCapacities,
  autoPluckSlots,
  noteYieldMul,
  onSlotChange,
  onEarn,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const cloudGroupRef = useRef<SVGGElement>(null)
  const burstGroupRef = useRef<SVGGElement>(null)
  const glowGroupRef = useRef<SVGGElement>(null)
  const particleGroupRef = useRef<SVGGElement>(null)
  const emptyHintRef = useRef<SVGTextElement>(null)
  const audioRef = useRef<AudioGraph | null>(null)
  const cloudRef = useRef<Harmonic[]>([])
  const burstsRef = useRef<Burst[]>([])
  const hintGlowsRef = useRef<HintGlow[]>([])
  const particlesRef = useRef<Particle[]>([])
  const nextBurstIdRef = useRef(1)
  const coolingRef = useRef<Set<number>>(new Set())
  const [cooling, setCooling] = useState<ReadonlySet<number>>(() => new Set())
  const [openPickerIdx, setOpenPickerIdx] = useState<number | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  // Pointer-id keyed so multi-touch can't cross-fire one finger's gesture
  // with another's. Each entry is the in-flight swipe candidate for that
  // pointer; resolved on pointerup/cancel.
  const gesturesRef = useRef(
    new Map<number, { idx: number; startX: number; startY: number; startT: number }>(),
  )
  const slotsRef = useRef(slots)
  const autoSlotsRef = useRef(autoPluckSlots)
  const onEarnRef = useRef(onEarn)
  const noteYieldMulRef = useRef(noteYieldMul)

  // Set of every note currently in any slot. Used to highlight chroma-compass
  // anchors so the player can read which notes are loaded without having to
  // glance down at the pads.
  const slotted = useMemo(() => {
    const s = new Set<BodyId>()
    for (const slotNotes of slots) for (const id of slotNotes) s.add(id)
    return s
  }, [slots])

  // Every coincidence spot reachable with the currently-unlocked notes:
  // frequencies where two or more notes' harmonic series intersect. Solo
  // partial positions are dropped — they're math markers, not gameplay
  // anchors. Start at H2 because the chroma compass already covers H1.
  const harmonicHints = useMemo(() => {
    type Hint = { freq: number; colors: string[]; key: string }
    const map = new Map<string, Hint>()
    for (const id of unlockedIds) {
      const body = BODIES.find((b) => b.id === id)
      if (!body) continue
      const color = PAD_COLORS[id]
      for (let n = 2; n <= HARMONIC_COUNT; n++) {
        const freq = TONIC_HZ * body.ratio * n
        const key = freq.toFixed(3)
        const existing = map.get(key)
        if (existing) {
          if (!existing.colors.includes(color)) existing.colors.push(color)
        } else {
          map.set(key, { freq, colors: [color], key })
        }
      }
    }
    return Array.from(map.values()).filter((h) => h.colors.length > 1)
  }, [unlockedIds])

  // Fast lookup the rAF/handleSlot paths use to decide whether a partial
  // just landed on a hint slot (triggering the soft glow feedback).
  const hintFreqSet = useMemo(() => {
    const s = new Set<string>()
    for (const h of harmonicHints) s.add(h.key)
    return s
  }, [harmonicHints])
  const hintFreqSetRef = useRef(hintFreqSet)
  useEffect(() => {
    hintFreqSetRef.current = hintFreqSet
  }, [hintFreqSet])

  useEffect(() => {
    onEarnRef.current = onEarn
  }, [onEarn])
  useEffect(() => {
    noteYieldMulRef.current = noteYieldMul
  }, [noteYieldMul])
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])
  useEffect(() => {
    autoSlotsRef.current = autoPluckSlots
  }, [autoPluckSlots])

  // rAF: decay the cloud + bursts, then push their current state into the
  // two dynamic SVG groups. The static layer (octave rings, base ring,
  // chroma compass) is declared in JSX below and never touched here —
  // React handles slot-driven changes via re-render.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let wasEmpty: boolean | null = null

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

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

      // Hint glows fade over GLOW_LIFE_MS; particles fly outward then fade
      // over their per-particle life. Both decay arrays in-place to avoid
      // GC pressure at 60 fps.
      const glows = hintGlowsRef.current
      let gW = 0
      for (let i = 0; i < glows.length; i++) {
        if (now - glows[i].bornMs < GLOW_LIFE_MS) glows[gW++] = glows[i]
      }
      glows.length = gW

      const particles = particlesRef.current
      let pW = 0
      for (let i = 0; i < particles.length; i++) {
        const part = particles[i]
        if (now - part.bornMs >= part.life) continue
        particles[pW++] = part
      }
      particles.length = pW

      const cloudG = cloudGroupRef.current
      if (cloudG) {
        const nodes: SVGElement[] = []

        // Per-pluck spirals: group partials by (noteId, bornAt) so each
        // pluck draws its own log-spiral curve. r and θ are both linear in
        // pitch p = log2(f/tonic), so the underlying curve is a true
        // Archimedean spiral. SVG has no native spiral primitive (Beziers
        // are polynomial, spirals are transcendental), but the standard
        // trick — chain cubic Beziers, one per ≤ quarter-turn, using the
        // exact endpoint tangents — is C¹-smooth and visually exact (radial
        // error < 0.03% of r per segment). One short C command replaces
        // ~24 line segments at the same fidelity.
        const groups = new Map<string, Harmonic[]>()
        for (const h of cloud) {
          const k = `${h.noteId}:${h.bornAt}`
          const arr = groups.get(k)
          if (arr) arr.push(h)
          else groups.set(k, [h])
        }
        const spiralRadius = (p: number) =>
          R_BASE + (R_OUTER - R_BASE) * Math.min(1, p / P_MAX)
        const spiralPoint = (p: number): [number, number] => {
          const ang = p * 2 * Math.PI - Math.PI / 2
          const r = spiralRadius(p)
          return [CX + r * Math.cos(ang), CY + r * Math.sin(ang)]
        }
        // dP/dp evaluated analytically — gives the exact tangent vector at
        // any point on the spiral for the cubic-Bezier control points.
        const spiralTangent = (p: number): [number, number] => {
          const ang = p * 2 * Math.PI - Math.PI / 2
          const r = spiralRadius(p)
          const drDp = p < P_MAX ? (R_OUTER - R_BASE) / P_MAX : 0
          const dθDp = 2 * Math.PI
          return [
            drDp * Math.cos(ang) - r * Math.sin(ang) * dθDp,
            drDp * Math.sin(ang) + r * Math.cos(ang) * dθDp,
          ]
        }
        for (const g of groups.values()) {
          if (g.length < 2) continue
          g.sort((a, b) => a.partial - b.partial)
          const first = g[0]
          const last = g[g.length - 1]
          const norm = Math.max(0, Math.min(1, first.amp / Math.max(first.bornAmp, 1e-6)))
          if (norm <= 0.05) continue
          const pStart = pitchOf(first.freq)
          const pEnd = pitchOf(last.freq)
          // 4 segments per octave → each segment subtends at most a
          // quarter-turn, where the cubic-Bezier-arc approximation is
          // accurate to ~3·10⁻⁴ of the radius.
          const segCount = Math.max(1, Math.ceil((pEnd - pStart) * 4))
          const dp = (pEnd - pStart) / segCount
          let [px0, py0] = spiralPoint(pStart)
          let [tx0, ty0] = spiralTangent(pStart)
          let d = `M${px0.toFixed(2)} ${py0.toFixed(2)} `
          for (let i = 0; i < segCount; i++) {
            const p1 = pStart + (i + 1) * dp
            const [px1, py1] = spiralPoint(p1)
            const [tx1, ty1] = spiralTangent(p1)
            const c1x = px0 + (dp / 3) * tx0
            const c1y = py0 + (dp / 3) * ty0
            const c2x = px1 - (dp / 3) * tx1
            const c2y = py1 - (dp / 3) * ty1
            d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${px1.toFixed(2)} ${py1.toFixed(2)} `
            px0 = px1
            py0 = py1
            tx0 = tx1
            ty0 = ty1
          }
          const path = document.createElementNS(SVG_NS, 'path')
          path.setAttribute('d', d.trim())
          path.setAttribute('fill', 'none')
          path.setAttribute('stroke', PAD_COLORS[first.noteId] ?? '#aa3bff')
          path.setAttribute('stroke-opacity', String(norm * 0.35))
          path.setAttribute('stroke-width', '1')
          path.setAttribute('stroke-linecap', 'round')
          path.setAttribute('stroke-linejoin', 'round')
          nodes.push(path)
        }

        for (const h of cloud) {
          const [x, y] = polar(h.freq)
          const norm = Math.max(0, Math.min(1, h.amp / Math.max(h.bornAmp, 1e-6)))
          const opacity = Math.max(0.25, norm)
          const color = PAD_COLORS[h.noteId] ?? '#aa3bff'
          const isFund = h.partial === 1
          const dotR = isFund ? 12 : Math.max(4, 8 / h.partial)

          const dot = document.createElementNS(SVG_NS, 'circle')
          dot.setAttribute('cx', x.toFixed(2))
          dot.setAttribute('cy', y.toFixed(2))
          dot.setAttribute('r', dotR.toFixed(2))
          dot.setAttribute('fill', color)
          dot.setAttribute('fill-opacity', String(opacity * (isFund ? 1 : 0.95)))
          nodes.push(dot)

          if (isFund) {
            const ring = document.createElementNS(SVG_NS, 'circle')
            ring.setAttribute('cx', x.toFixed(2))
            ring.setAttribute('cy', y.toFixed(2))
            ring.setAttribute('r', (dotR + 3.5).toFixed(2))
            ring.setAttribute('fill', 'none')
            ring.setAttribute('stroke', color)
            ring.setAttribute('stroke-opacity', String(opacity * 0.9))
            ring.setAttribute('stroke-width', '1.75')
            nodes.push(ring)
          }
        }
        cloudG.replaceChildren(...nodes)
      }

      const burstG = burstGroupRef.current
      if (burstG) {
        const nodes: SVGElement[] = []
        for (const b of bursts) {
          const u = (now - b.bornMs) / BURST_MS
          const [x, y] = polar(b.freq)
          const alpha = (1 - u) * 0.9
          const blended = blendColors(b.colorIn, b.colorCloud, 0.5)
          const haloR = 6 + 22 * u * Math.min(1, b.magnitude * 4)

          const fill = document.createElementNS(SVG_NS, 'circle')
          fill.setAttribute('cx', x.toFixed(2))
          fill.setAttribute('cy', y.toFixed(2))
          fill.setAttribute('r', haloR.toFixed(2))
          fill.setAttribute('fill', blended)
          fill.setAttribute('fill-opacity', String(alpha * 0.3))
          nodes.push(fill)

          const stroke = document.createElementNS(SVG_NS, 'circle')
          stroke.setAttribute('cx', x.toFixed(2))
          stroke.setAttribute('cy', y.toFixed(2))
          stroke.setAttribute('r', haloR.toFixed(2))
          stroke.setAttribute('fill', 'none')
          stroke.setAttribute('stroke', blended)
          stroke.setAttribute('stroke-opacity', String(alpha))
          stroke.setAttribute('stroke-width', '1.5')
          nodes.push(stroke)

          if (b.label) {
            // Currency reward floats radially outward over the burst's life
            // so stacked hits read as a column of named gains rather than a
            // single overlapping ring.
            const ang = chromaAngleOf(b.freq)
            const rise = 14 + 16 * u
            const lx = x + rise * Math.cos(ang)
            const ly = y + rise * Math.sin(ang)
            const text = document.createElementNS(SVG_NS, 'text')
            text.setAttribute('x', lx.toFixed(2))
            text.setAttribute('y', ly.toFixed(2))
            text.setAttribute('text-anchor', 'middle')
            text.setAttribute('dominant-baseline', 'middle')
            text.setAttribute('font-family', 'ui-monospace, Menlo, Consolas, monospace')
            text.setAttribute('font-size', '10')
            text.setAttribute('fill', blended)
            text.setAttribute('fill-opacity', String(alpha))
            text.textContent = b.label
            nodes.push(text)
          }
        }
        burstG.replaceChildren(...nodes)
      }

      // Hint glows: short expanding ring per soft hit (one partial landed
      // on a coincidence slot, no payout yet). Renders above the static
      // hint circles, below the cloud dots.
      const glowG = glowGroupRef.current
      if (glowG) {
        const nodes: SVGElement[] = []
        for (const g of glows) {
          const u = (now - g.bornMs) / GLOW_LIFE_MS
          const [x, y] = polar(g.freq)
          const r = 6 + 14 * u
          const alpha = (1 - u) * 0.85
          const circle = document.createElementNS(SVG_NS, 'circle')
          circle.setAttribute('cx', x.toFixed(2))
          circle.setAttribute('cy', y.toFixed(2))
          circle.setAttribute('r', r.toFixed(2))
          circle.setAttribute('fill', 'none')
          circle.setAttribute('stroke', g.color)
          circle.setAttribute('stroke-opacity', String(alpha))
          circle.setAttribute('stroke-width', '1.5')
          nodes.push(circle)
        }
        glowG.replaceChildren(...nodes)
      }

      // Particles: each one eases from (x0, y0) on the helix to (tx, ty) on
      // the currency chip the coincidence paid out to. Ease-out cubic gives
      // a fast launch and a soft landing right as the alpha fades to zero,
      // so visually the particle "delivers" the reward to the counter.
      const particleG = particleGroupRef.current
      if (particleG) {
        const nodes: SVGElement[] = []
        for (const part of particles) {
          const u = Math.min(1, (now - part.bornMs) / part.life)
          const eased = 1 - Math.pow(1 - u, 3)
          const x = part.x0 + (part.tx - part.x0) * eased
          const y = part.y0 + (part.ty - part.y0) * eased
          const alpha = Math.max(0, (1 - u) * (1 - u))
          const r = part.size * (1 - u * 0.4)
          const circle = document.createElementNS(SVG_NS, 'circle')
          circle.setAttribute('cx', x.toFixed(2))
          circle.setAttribute('cy', y.toFixed(2))
          circle.setAttribute('r', r.toFixed(2))
          circle.setAttribute('fill', part.color)
          circle.setAttribute('fill-opacity', String(alpha))
          nodes.push(circle)
        }
        particleG.replaceChildren(...nodes)
      }

      const isEmpty =
        cloud.length === 0 && bursts.length === 0 && glows.length === 0 && particles.length === 0
      if (isEmpty !== wasEmpty) {
        wasEmpty = isEmpty
        const hint = emptyHintRef.current
        if (hint) hint.style.opacity = isEmpty ? '0.35' : '0'
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

  // Core slot trigger — manual taps, keyboard, and auto-pluck all route
  // through here so the cooldown / coincidence / audio / cloud paths stay
  // identical regardless of who fired. Auto-fired plucks pay a yield
  // penalty (AUTO_PLUCK_PENALTY) on every currency so manual play is
  // strictly better when the player is at the keyboard.
  //
  // Currency mint, per stack-fire:
  //   - 1 unit of NoteCurrency[noteId] per note in the stack (× per-note
  //     yield × auto penalty).
  //   - For every coincident partial pair, exactly +1 unit of the
  //     FreqCurrency for the frequency at which the partials lined up.
  //     C×E lining up at 5·tonic mints F5 — no matter which partials of
  //     each note happened to coincide.
  //
  // A slot can hold a stack of notes (slot 0's capacity upgrade). The
  // stack fires sequentially in array order — each note scans the cloud
  // *after* the previous note's partials have been added to it, so a
  // 2-note stack pays the chord's coincidence on every tap at FULL
  // amplitude (no decay between same-pluck emits).
  const handleSlot = useCallback((slotIdx: number, opts?: { auto?: boolean }) => {
    const slotsNow = slotsRef.current
    const notes = slotsNow[slotIdx]
    if (!notes || notes.length === 0) return
    if (coolingRef.current.has(slotIdx)) return

    coolingRef.current.add(slotIdx)
    setCooling(new Set(coolingRef.current))
    window.setTimeout(() => {
      if (coolingRef.current.delete(slotIdx)) {
        setCooling(new Set(coolingRef.current))
      }
    }, RING_DURATION_MS)

    // Audio: only attempt to lazily create the context on a real user
    // gesture. iOS Safari requires .resume() to come synchronously from a
    // gesture, so auto-plucks never try.
    if (!opts?.auto && !audioRef.current) {
      const g = createAudioGraph({ lowpassHz: 4000, fadeInS: 0.05 })
      if (g) audioRef.current = g
    }
    const audio = audioRef.current

    const autoMul = opts?.auto ? AUTO_PLUCK_PENALTY : 1
    const now = performance.now()
    const cloud = cloudRef.current
    const purse: CurrencyPurse = {}
    const yieldMul = noteYieldMulRef.current

    for (const noteId of notes) {
      const body = BODIES.find((b) => b.id === noteId)
      if (!body) continue

      const incoming = harmonicSeries(TONIC_HZ * body.ratio, HARMONIC_COUNT, defaultAmp)
      const { hits } = scanCoincidences(cloud, incoming, {
        tolFrac: COINCIDENCE_TOL,
        gain: 1,
      })
      const incomingColor = PAD_COLORS[body.id] ?? ''

      // Note currency: per-note yield × auto penalty.
      purse[noteId] = (purse[noteId] ?? 0) + autoMul * yieldMul(noteId)

      const hintSet = hintFreqSetRef.current

      for (const h of hits) {
        const freqKey = freqToCurrency(h.freq, TONIC_HZ)
        if (freqKey) {
          purse[freqKey] = (purse[freqKey] ?? 0) + autoMul
        }
        const interval = freqKey ? FREQ_INTERVAL_LABEL[freqKey] : ''
        const meta = FREQ_CURRENCIES.find((e) => e.key === freqKey)
        const ratio = meta ? meta.label : ''
        const label = freqKey
          ? interval
            ? `+f${ratio} · ${interval}`
            : `+f${ratio}`
          : ''
        const cloudColor = PAD_COLORS[h.cloudNoteId] ?? incomingColor
        burstsRef.current.push({
          id: nextBurstIdRef.current++,
          freq: h.freq,
          bornMs: now,
          magnitude: h.bonus,
          label,
          colorIn: incomingColor,
          colorCloud: cloudColor,
        })
        // Particle shower from the hit point to wherever this coincidence's
        // currency actually lives in the DOM (the chip with matching
        // data-cur-key). Each particle gets a small spawn offset and a
        // small target offset so they spread out instead of marching in
        // single file. When the chip can't be found (locked currency,
        // off-screen, no key) we fall back to a fan that rises above the
        // helix — still satisfying, just untargeted.
        const [hx, hy] = polar(h.freq)
        const blended = blendColors(incomingColor, cloudColor, 0.5)
        const target = freqKey ? chipTargetVB(freqKey, svgRef.current) : null
        const count = 12
        for (let i = 0; i < count; i++) {
          const spawnA = Math.random() * Math.PI * 2
          const spawnR = Math.random() * 4
          const x0 = hx + Math.cos(spawnA) * spawnR
          const y0 = hy + Math.sin(spawnA) * spawnR
          let tx: number
          let ty: number
          if (target) {
            tx = target[0] + (Math.random() - 0.5) * 18
            ty = target[1] + (Math.random() - 0.5) * 10
          } else {
            // Fallback: an upper-cone fan reaching above the helix.
            const fanA = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9
            const dist = 110 + Math.random() * 60
            tx = hx + Math.cos(fanA) * dist
            ty = hy + Math.sin(fanA) * dist
          }
          particlesRef.current.push({
            id: nextBurstIdRef.current++,
            x0,
            y0,
            tx,
            ty,
            bornMs: now,
            life: 650 + Math.random() * 300,
            color: blended,
            size: 1.8 + Math.random() * 1.6,
          })
        }
      }

      // Soft glow when any new partial lands on a coincidence hint slot —
      // even without a payout yet, the player should see that the spot
      // they're aiming at lit up. The same path will fire bigger
      // (burst + particles) on the second partial that completes the
      // coincidence.
      const coincidenceFreqs = new Set<string>()
      for (const h of hits) coincidenceFreqs.add(h.freq.toFixed(3))
      for (const ih of incoming) {
        const key = ih.freq.toFixed(3)
        // Skip if this partial already triggered the bigger burst path.
        if (coincidenceFreqs.has(key)) continue
        if (!hintSet.has(key)) continue
        hintGlowsRef.current.push({
          id: nextBurstIdRef.current++,
          freq: ih.freq,
          bornMs: now,
          color: incomingColor,
        })
      }

      if (audio) playPluck(audio, incoming, hits)

      for (const ih of incoming) {
        cloud.push({
          noteId: body.id,
          partial: ih.partial,
          freq: ih.freq,
          amp: ih.amp,
          bornAmp: ih.amp,
          bornAt: now,
        })
      }
    }

    onEarnRef.current(purse)
  }, [])

  // Auto-pluck timers exist for every potential slot; whether they actually
  // fire is checked against `autoSlotsRef` at tick time. That way buying
  // auto-pluck for a new slot doesn't reset the rhythm of the slots that
  // already had it. Stagger is `i * AUTO_STAGGER_MS` so the clouds overlap
  // mid-life — that's when their coincidence bonus is biggest.
  useEffect(() => {
    const timers: number[] = []
    const intervalIds: number[] = []
    for (let i = 0; i < MAX_SLOT_COUNT; i++) {
      const slotIdx = i
      const delay = slotIdx * AUTO_STAGGER_MS
      const fire = () => {
        if (autoSlotsRef.current.has(slotIdx)) {
          handleSlot(slotIdx, { auto: true })
        }
      }
      timers.push(
        window.setTimeout(() => {
          fire()
          intervalIds.push(window.setInterval(fire, AUTO_CADENCE_MS))
        }, delay),
      )
    }
    return () => {
      for (const t of timers) window.clearTimeout(t)
      for (const id of intervalIds) window.clearInterval(id)
    }
  }, [handleSlot])

  // Keyboard bindings: A → slot 0, S → slot 1.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const k = e.key.toLowerCase()
      const idx = SLOT_KEYS.indexOf(k)
      if (idx === -1 || idx >= slotCount) return
      e.preventDefault()
      handleSlot(idx)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSlot, slotCount])

  // While the picker modal is open: lock body scroll, trap initial focus on
  // the dialog, restore focus to the trigger on close, and let Escape close.
  // The backdrop handles click-outside, so no document-level pointer listener
  // is needed.
  useEffect(() => {
    if (openPickerIdx === null) return
    lastFocusRef.current = document.activeElement as HTMLElement | null
    modalRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPickerIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      lastFocusRef.current?.focus?.()
    }
  }, [openPickerIdx])

  // Picker click handler. Capacity-1 slots single-select replace and close
  // — re-tapping the active note is a no-op (clearing is the explicit clear
  // button's job). Capacity-N slots toggle the note in/out and stay open
  // for stacking.
  const onPickerSelect = useCallback(
    (slotIdx: number, noteId: BodyId) => {
      const cap = slotCapacities[slotIdx] ?? 1
      const current = slots[slotIdx] ?? []
      const present = current.includes(noteId)
      if (cap === 1) {
        if (!present) onSlotChange(slotIdx, [noteId])
        setOpenPickerIdx(null)
      } else {
        if (present) {
          onSlotChange(slotIdx, current.filter((n) => n !== noteId))
        } else if (current.length < cap) {
          onSlotChange(slotIdx, [...current, noteId])
        }
      }
    },
    [slots, slotCapacities, onSlotChange],
  )

  const onPickerClear = useCallback(
    (slotIdx: number) => {
      onSlotChange(slotIdx, [])
      setOpenPickerIdx(null)
    },
    [onSlotChange],
  )

  // Swipe handler: advance the slot's single note to the next/prev unlocked
  // body that isn't already in another slot (same-note exclusion). Diatonic
  // order from BODIES is the cycle order. Stack slots (cap > 1) opt out —
  // they belong to the picker. Empty slots load the first/last available.
  const cycleSlotNote = useCallback(
    (slotIdx: number, dir: 1 | -1) => {
      const cap = slotCapacities[slotIdx] ?? 1
      if (cap > 1) return
      const current = slots[slotIdx]?.[0] ?? null
      const taken = new Set<BodyId>()
      slots.forEach((s, i) => {
        if (i === slotIdx) return
        for (const id of s) taken.add(id)
      })
      const available = BODIES
        .filter((b) => unlockedIds.includes(b.id) && !taken.has(b.id))
        .map((b) => b.id)
      if (available.length === 0) return
      if (current === null) {
        onSlotChange(slotIdx, [dir === 1 ? available[0] : available[available.length - 1]])
        return
      }
      const i = available.indexOf(current)
      if (i === -1) {
        onSlotChange(slotIdx, [available[0]])
        return
      }
      const next = available[(i + dir + available.length) % available.length]
      onSlotChange(slotIdx, [next])
    },
    [slots, slotCapacities, unlockedIds, onSlotChange],
  )

  // Window-level pointerup so we resolve swipes regardless of where the
  // finger/cursor releases. Trying to do this on the button itself relies
  // on setPointerCapture, which is finicky across browsers and breaks if
  // the button gets re-rendered (state change in pointerdown) mid-gesture.
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      const g = gesturesRef.current.get(e.pointerId)
      if (!g) return
      gesturesRef.current.delete(e.pointerId)
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const dt = performance.now() - g.startT
      if (
        Math.abs(dx) > 36 &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        dt < 700
      ) {
        cycleSlotNote(g.idx, dx > 0 ? 1 : -1)
      }
    }
    const onCancel = (e: PointerEvent) => {
      gesturesRef.current.delete(e.pointerId)
    }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [cycleSlotNote])

  return (
    <section className="harvest" aria-label="Resonator stage">
      <svg
        ref={svgRef}
        className="spectrum"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        // overflow:visible lets coincidence particles fly *out* of the
        // viewBox up to the currency chips above the helix.
        style={{ overflow: 'visible' }}
      >
        {/* Octave guide rings — one per integer p, where the chroma wraps. */}
        {Array.from({ length: Math.floor(P_MAX) }, (_, i) => {
          const oct = i + 1
          const r = R_BASE + (R_OUTER - R_BASE) * (oct / P_MAX)
          return (
            <circle
              key={`oct-${oct}`}
              cx={CX}
              cy={CY}
              r={r}
              fill="none"
              strokeWidth="1"
              strokeDasharray="2 5"
              style={{ stroke: 'var(--border)', strokeOpacity: 0.45 }}
            />
          )
        })}

        {/* Solid base ring — home of every note's fundamental. */}
        <circle
          cx={CX}
          cy={CY}
          r={R_BASE}
          fill="none"
          strokeWidth="1"
          style={{ stroke: 'var(--border)', strokeOpacity: 0.7 }}
        />

        {/* Chroma compass: all 7 diatonic notes anchored at their just-
            intonation chroma angles on the base ring. Slotted notes glow,
            unslotted ones stay faint anchors. */}
        {BODIES.map((body) => {
          const ang = chromaAngleOf(TONIC_HZ * body.ratio)
          const x = CX + R_BASE * Math.cos(ang)
          const y = CY + R_BASE * Math.sin(ang)
          const lx = CX + (R_BASE + 17) * Math.cos(ang)
          const ly = CY + (R_BASE + 17) * Math.sin(ang)
          const isOn = slotted.has(body.id)
          const color = PAD_COLORS[body.id] ?? '#aa3bff'
          return (
            <g key={body.id}>
              <circle
                cx={x}
                cy={y}
                r={isOn ? 5.5 : 3.5}
                fill={color}
                fillOpacity={isOn ? 0.5 : 0.22}
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="ui-monospace, Menlo, Consolas, monospace"
                fontSize="13"
                fontWeight={isOn ? 600 : 400}
                fill={color}
                fillOpacity={isOn ? 1 : 0.55}
              >
                {body.id}
              </text>
            </g>
          )
        })}

        {/* Coincidence landing hints — every frequency where two or more
            unlocked notes' harmonic series intersect (e.g. C·H3 ≡ G·H2 at
            392 Hz). Stroke is the average of every contributing note's
            color, so the eye reads "this spot is shared by these notes".
            These are the harvestable targets; solo-partial positions are
            intentionally omitted so the helix doesn't get noisy. */}
        {harmonicHints.map((hint) => {
          const [hx, hy] = polar(hint.freq)
          const color = averageColors(hint.colors)
          return (
            <g key={hint.key}>
              <circle
                cx={hx}
                cy={hy}
                r={6.5}
                fill={color}
                fillOpacity={0.08}
                stroke={color}
                strokeOpacity={0.7}
                strokeWidth={1.5}
              />
              <circle
                cx={hx}
                cy={hy}
                r={2}
                fill={color}
                fillOpacity={0.55}
              />
            </g>
          )
        })}

        {/* Tonic anchor at the centre. */}
        <circle
          cx={CX}
          cy={CY}
          r={2}
          style={{ fill: 'var(--border)', fillOpacity: 0.6 }}
        />

        {/* Hint glows — soft pulses when a single partial lands on a
            coincidence slot (no payout yet). */}
        <g ref={glowGroupRef} />

        {/* Dynamic layers — populated imperatively by the rAF loop. */}
        <g ref={cloudGroupRef} />
        <g ref={burstGroupRef} />

        {/* Particles — kinetic reward shower when a coincidence fires. */}
        <g ref={particleGroupRef} />

        {/* Empty-state hint — faded in/out from rAF when both layers empty.
            Sits inside the base ring so it doesn't fight the chroma compass. */}
        <text
          ref={emptyHintRef}
          x={CX}
          y={CY + R_BASE * 0.55}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
          fontSize="13"
          style={{ fill: 'var(--text-h)', opacity: 0.35, transition: 'opacity 120ms ease' }}
        >
          tap a slot to play
        </text>
      </svg>
      <ul className="pads" role="list">
        {Array.from({ length: slotCount }, (_, idx) => {
          const notes = slots[idx] ?? []
          const cap = slotCapacities[idx] ?? 1
          const firstBody = notes[0] ? BODIES.find((b) => b.id === notes[0]) ?? null : null
          const color = firstBody ? PAD_COLORS[firstBody.id] : 'var(--border)'
          const isEmpty = notes.length === 0
          const isStack = cap > 1
          const isCooling = cooling.has(idx)
          const slotKey = SLOT_KEYS[idx]
          const pickerOpen = openPickerIdx === idx
          const isAuto = autoPluckSlots.has(idx)
          const swipeable = !isStack
          const padLabel = isEmpty
            ? `Empty slot ${idx + 1} — swipe or use ▾ to pick a note`
            : swipeable
              ? `Play ${notes.join('+')} (slot ${idx + 1}, key ${slotKey?.toUpperCase()}) — swipe to change note`
              : `Play ${notes.join('+')} (slot ${idx + 1}, key ${slotKey?.toUpperCase()})`
          return (
            <li key={idx} className="slot">
              <button
                type="button"
                className={`pad${isCooling ? ' cooling' : ''}${isEmpty ? ' empty' : ''}${isAuto ? ' auto' : ''}${isStack ? ' stack' : ''}`}
                onPointerDown={(e) => {
                  gesturesRef.current.set(e.pointerId, {
                    idx,
                    startX: e.clientX,
                    startY: e.clientY,
                    startT: performance.now(),
                  })
                  if (!isEmpty && !isCooling) handleSlot(idx)
                }}
                aria-label={padLabel}
                style={{
                  ['--cooldown-ms' as string]: `${RING_DURATION_MS}ms`,
                  ['--pad-color' as string]: color,
                }}
              >
                <span className="pad-key" aria-hidden="true">{slotKey?.toUpperCase()}</span>
                {isAuto && !isEmpty && (
                  <span className="pad-auto" aria-label="auto-pluck on" title="Auto-pluck on">⚡</span>
                )}
                {isEmpty ? (
                  <>
                    <span className="pad-note pad-note-empty" aria-hidden="true">+</span>
                    <span className="pad-empty-cta">swipe or tap ▾</span>
                  </>
                ) : notes.length === 1 ? (
                  <>
                    <span className="pad-note">{notes[0]}</span>
                    <span className="pad-ratio">{firstBody ? toRatioLabel(firstBody.ratio) : ''}</span>
                  </>
                ) : (
                  <>
                    <span className="pad-note pad-note-chord">
                      {notes.map((n, i) => (
                        <span key={n} style={{ color: PAD_COLORS[n] }}>
                          {i > 0 ? <span className="pad-note-sep" aria-hidden="true">·</span> : null}
                          {n}
                        </span>
                      ))}
                    </span>
                    <span className="pad-ratio">chord · {notes.length}/{cap}</span>
                  </>
                )}
                <span className="pad-cooldown" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`slot-picker-toggle${pickerOpen ? ' open' : ''}${isEmpty ? ' attention' : ''}`}
                onClick={() => setOpenPickerIdx(idx)}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                aria-label={`Choose note for slot ${idx + 1}`}
              >
                <span aria-hidden="true">▾</span>
              </button>
            </li>
          )
        })}
      </ul>
      {openPickerIdx !== null && (() => {
        const idx = openPickerIdx
        const notes = slots[idx] ?? []
        const cap = slotCapacities[idx] ?? 1
        const isEmpty = notes.length === 0
        const isStack = cap > 1
        const titleId = `slot-picker-title-${idx}`
        const subtitle = isStack
          ? `chord ${notes.length}/${cap}`
          : 'pick a note'
        return (
          <div
            className="slot-picker-backdrop"
            role="presentation"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setOpenPickerIdx(null)
            }}
          >
            <div
              ref={modalRef}
              className="slot-picker-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
            >
              <header className="slot-picker-header">
                <span id={titleId} className="slot-picker-title">
                  Slot {idx + 1} <span className="slot-picker-subtitle">· {subtitle}</span>
                </span>
                <button
                  type="button"
                  className="slot-picker-close"
                  onClick={() => setOpenPickerIdx(null)}
                  aria-label="Close note picker"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </header>
              <div
                className="slot-picker-list"
                role="listbox"
                aria-label={`Slot ${idx + 1} note`}
              >
                {!isEmpty && (
                  <button
                    type="button"
                    className="slot-picker-item slot-picker-clear"
                    onClick={() => onPickerClear(idx)}
                  >
                    <span className="slot-picker-swatch" aria-hidden="true" />
                    <span className="slot-picker-label">clear</span>
                    <span className="slot-picker-ratio" />
                    <span className="slot-picker-check" aria-hidden="true" />
                  </button>
                )}
                {BODIES.map((b) => {
                  if (!unlockedIds.includes(b.id)) return null
                  const inOther = slots.some((s, i) => i !== idx && s.includes(b.id))
                  const isHere = notes.includes(b.id)
                  // Only stack slots can be "full" — for cap-1 the picker
                  // is a replace, so other notes must stay tappable.
                  const atCap = isStack && !isHere && notes.length >= cap
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="option"
                      aria-selected={isHere}
                      className={`slot-picker-item${isHere ? ' on' : ''}`}
                      disabled={inOther || atCap}
                      onClick={() => onPickerSelect(idx, b.id)}
                    >
                      <span
                        className="slot-picker-swatch"
                        aria-hidden="true"
                        style={{ background: PAD_COLORS[b.id] }}
                      />
                      <span className="slot-picker-label">{b.id}</span>
                      <span className="slot-picker-ratio">{toRatioLabel(b.ratio)}</span>
                      <span className="slot-picker-check" aria-hidden="true">
                        {isHere ? '✓' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}
      <p className="harvest-hint">
        Tap a slot (or press {SLOT_KEYS.slice(0, slotCount).map((k) => k.toUpperCase()).join('/')}) to play; swipe
        left/right to swap its note. Each note mints its own currency; land coincident partials while the first
        rings to mint a freq currency. Auto-plucked slots fire themselves at half yield (⚡).
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

  window.setTimeout(
    () => {
      try {
        env.disconnect()
      } catch {
        // already disconnected — ignore.
      }
    },
    (RING_DURATION_S + 0.2) * 1000,
  )
}

function parseHex(color: string): [number, number, number] | null {
  if (color.startsWith('#') && color.length === 7) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ]
  }
  return null
}

function blendColors(c1: string, c2: string, t = 0.5): string {
  const a = parseHex(c1)
  const b = parseHex(c2)
  if (!a || !b) return c1 || c2
  const r = Math.round(a[0] * (1 - t) + b[0] * t)
  const g = Math.round(a[1] * (1 - t) + b[1] * t)
  const bl = Math.round(a[2] * (1 - t) + b[2] * t)
  return `rgb(${r},${g},${bl})`
}

function averageColors(colors: readonly string[]): string {
  if (colors.length === 0) return '#aa3bff'
  if (colors.length === 1) return colors[0]
  let r = 0, g = 0, b = 0, n = 0
  for (const c of colors) {
    const parsed = parseHex(c)
    if (!parsed) continue
    r += parsed[0]
    g += parsed[1]
    b += parsed[2]
    n++
  }
  if (n === 0) return colors[0]
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
}

