import { useCallback, useEffect, useRef, useState } from 'react'
import { createAudioGraph, teardownAudioGraph } from './audio'
import type { AudioGraph } from './audio'
import { BODIES, ratioLabel as toRatioLabel } from './bodies'
import type { BodyId } from './bodies'
import {
  AUTO_PLUCK_PENALTY,
  COINCIDENCE_TOL,
  HARMONIC_COUNT,
  MAX_SLOT_COUNT,
  PAD_COLORS,
  RESONANCE_GAIN,
  RING_DURATION_MS,
  RING_DURATION_S,
  TONE_PER_TAP,
  TONIC_HZ,
} from './harvest-config'
import {
  defaultAmp,
  harmonicSeries,
  scanCoincidences,
} from './harmonics'
import type { Coincidence, Harmonic } from './harmonics'

const PLUCK_GAIN = 0.18
const PLUCK_HIT_BOOST = 2.2

const BURST_MS = 600

const SLOT_KEYS = ['a', 's', 'd', 'f']

// Auto-pluck cadence equals slot cooldown so consecutive auto-plucks land
// exactly when the slot becomes available again. Slot 2 fires offset by
// half a cadence so both clouds overlap mid-life — that's when their
// coincidence bonus is biggest.
const AUTO_CADENCE_MS = RING_DURATION_MS
const AUTO_STAGGER_MS = RING_DURATION_MS / 2

// Orbital visualizer tuning. Angular speed scales with frequency relative to
// the tonic; one revolution of the tonic fundamental takes VISUAL_REF_PERIOD_S
// seconds, so C·H6 laps it 6× faster, B·H6 ≈ 11.25× faster. Coincident
// partials (same freq) share an orbit AND an angular speed — they stay
// locked at whatever offset they were born with.
const VISUAL_REF_FREQ_HZ = TONIC_HZ
const VISUAL_REF_PERIOD_S = 6
// Each slot fires from a fixed home angle around the orbit, so the player
// reads which slot a streak of partials came from. -π/2 puts slot 0 at the
// top; subsequent slots step clockwise around the circle.
const slotHomeAngle = (slotIdx: number) =>
  -Math.PI / 2 + (slotIdx / MAX_SLOT_COUNT) * 2 * Math.PI

type Burst = {
  id: number
  freq: number
  bornMs: number
  magnitude: number
  // Angles (radians) of the incoming and cloud partials at the moment of
  // coincidence. Both advance at the same ω at draw time (same freq → same
  // orbit), so the chord drawn between them rotates rigidly with the orbit.
  angleIn: number
  angleCloud: number
  colorIn: string
  colorCloud: string
}

type Props = {
  unlockedIds: readonly BodyId[]
  slots: ReadonlyArray<readonly BodyId[]>
  slotCount: number
  slotCapacities: readonly number[]
  autoPluckSlots: ReadonlySet<number>
  onSlotChange: (slotIdx: number, newNotes: readonly BodyId[]) => void
  onTone: (delta: number) => void
  onResonance: (delta: number) => void
}

export function HarvestStage({
  unlockedIds,
  slots,
  slotCount,
  slotCapacities,
  autoPluckSlots,
  onSlotChange,
  onTone,
  onResonance,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<AudioGraph | null>(null)
  const cloudRef = useRef<Harmonic[]>([])
  const burstsRef = useRef<Burst[]>([])
  const nextBurstIdRef = useRef(1)
  const coolingRef = useRef<Set<number>>(new Set())
  const [cooling, setCooling] = useState<ReadonlySet<number>>(() => new Set())
  const [openPickerIdx, setOpenPickerIdx] = useState<number | null>(null)
  const slotsRef = useRef(slots)
  const autoSlotsRef = useRef(autoPluckSlots)
  const onToneRef = useRef(onTone)
  const onResonanceRef = useRef(onResonance)

  useEffect(() => {
    onToneRef.current = onTone
  }, [onTone])
  useEffect(() => {
    onResonanceRef.current = onResonance
  }, [onResonance])
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])
  useEffect(() => {
    autoSlotsRef.current = autoPluckSlots
  }, [autoPluckSlots])

  // rAF: decay cloud + bursts, redraw orbital plot. Each partial is a dot on
  // a circle whose radius is set by its frequency (high freq = inner, slow
  // outer drone = outer), and whose angle advances at ω ∝ freq. Two
  // coincident partials (e.g. C·H3 and G·H2) sit on the SAME orbit and turn
  // at the SAME ω, so a coincidence chord drawn between them rotates rigidly
  // — a literal mean-motion resonance.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    let raf = 0
    let last = performance.now()

    // Radius scale is fixed across the full diatonic ladder so orbits don't
    // shift as the player unlocks more notes.
    const maxRatio = BODIES.reduce((m, b) => (b.ratio > m ? b.ratio : m), 1)
    const fMin = TONIC_HZ * 0.95
    const fMax = TONIC_HZ * maxRatio * HARMONIC_COUNT * 1.05
    const logSpan = Math.log(fMax / fMin)

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

      const cx = cssW / 2
      const cy = cssH / 2
      const rMax = Math.max(20, Math.min(cssW, cssH) / 2 - 18)
      const rMin = Math.min(18, rMax - 4)

      // High freq → small radius (fast inner orbit). Low freq → large radius
      // (slow outer drone), matching Kepler's third law.
      const radiusOf = (f: number) => {
        const u = logSpan > 0 ? Math.log(f / fMin) / logSpan : 0
        return rMax - (rMax - rMin) * Math.max(0, Math.min(1, u))
      }
      const angleOf = (freq: number, ageS: number, startAngle: number) => {
        const omega = ((2 * Math.PI) / VISUAL_REF_PERIOD_S) * (freq / VISUAL_REF_FREQ_HZ)
        return startAngle + omega * ageS
      }

      // Faint guide ring + radial label for each currently-slotted note's
      // fundamental, so the player can read where each note "lives".
      const slotsNow = slotsRef.current
      const drawnNotes = new Set<BodyId>()
      ctx2d.font = '10px ui-monospace, Menlo, Consolas, monospace'
      ctx2d.textAlign = 'left'
      ctx2d.textBaseline = 'middle'
      for (const slotNotes of slotsNow) {
        for (const id of slotNotes) {
          if (drawnNotes.has(id)) continue
          drawnNotes.add(id)
          const body = BODIES.find((b) => b.id === id)
          if (!body) continue
          const r = radiusOf(TONIC_HZ * body.ratio)
          const color = PAD_COLORS[id] ?? accent
          ctx2d.strokeStyle = withAlpha(color, 0.18)
          ctx2d.lineWidth = 1
          ctx2d.setLineDash([2, 4])
          ctx2d.beginPath()
          ctx2d.arc(cx, cy, r, 0, 2 * Math.PI)
          ctx2d.stroke()
          ctx2d.setLineDash([])
          ctx2d.fillStyle = withAlpha(color, 0.55)
          ctx2d.fillText(id, cx + r + 4, cy)
        }
      }

      // Tonic anchor — a faint dot at the centre so the empty stage still
      // reads as a system, not a void.
      ctx2d.fillStyle = withAlpha(border, 0.6)
      ctx2d.beginPath()
      ctx2d.arc(cx, cy, 2, 0, 2 * Math.PI)
      ctx2d.fill()

      // Cloud partials as dots. Higher partials are smaller and dimmer;
      // fundamentals get an outline + note letter so the slot's "voice" is
      // legible at a glance even when its harmonics fan out.
      for (const h of cloud) {
        const ageS = Math.max(0, (now - h.bornAt) / 1000)
        const ang = angleOf(h.freq, ageS, h.startAngle ?? 0)
        const r = radiusOf(h.freq)
        const x = cx + r * Math.cos(ang)
        const y = cy + r * Math.sin(ang)
        const norm = Math.max(0, Math.min(1, h.amp / Math.max(h.bornAmp, 1e-6)))
        const opacity = Math.max(0.15, norm)
        const color = PAD_COLORS[h.noteId] ?? accent
        const isFund = h.partial === 1
        const dotR = isFund ? 5.5 : Math.max(1.4, 4 / h.partial)

        ctx2d.fillStyle = withAlpha(color, opacity * (isFund ? 1 : 0.75))
        ctx2d.beginPath()
        ctx2d.arc(x, y, dotR, 0, 2 * Math.PI)
        ctx2d.fill()

        if (isFund) {
          ctx2d.strokeStyle = withAlpha(color, opacity * 0.85)
          ctx2d.lineWidth = 1.25
          ctx2d.beginPath()
          ctx2d.arc(x, y, dotR + 2.5, 0, 2 * Math.PI)
          ctx2d.stroke()

          ctx2d.font = '11px ui-monospace, Menlo, Consolas, monospace'
          ctx2d.textAlign = 'center'
          ctx2d.textBaseline = 'middle'
          // Push the letter outward along the radial so it doesn't sit on
          // top of the dot when orbits crowd near the centre.
          const lx = cx + (r + 11) * Math.cos(ang)
          const ly = cy + (r + 11) * Math.sin(ang)
          ctx2d.fillStyle = withAlpha(color, opacity)
          ctx2d.fillText(h.noteId, lx, ly)
        }
      }

      // Coincidence chord: a line between the two partials that locked.
      // Both ride the same orbit at the same ω so the chord rotates rigidly
      // — visually the resonance.
      for (const b of bursts) {
        const ageBS = Math.max(0, (now - b.bornMs) / 1000)
        const u = (now - b.bornMs) / BURST_MS
        const r = radiusOf(b.freq)
        const omega = ((2 * Math.PI) / VISUAL_REF_PERIOD_S) * (b.freq / VISUAL_REF_FREQ_HZ)
        const a1 = b.angleIn + omega * ageBS
        const a2 = b.angleCloud + omega * ageBS
        const x1 = cx + r * Math.cos(a1)
        const y1 = cy + r * Math.sin(a1)
        const x2 = cx + r * Math.cos(a2)
        const y2 = cy + r * Math.sin(a2)
        const alpha = (1 - u) * 0.9
        const blended = blendColors(b.colorIn, b.colorCloud, 0.5)
        const ringR = 5 + 22 * u * Math.min(1, b.magnitude * 4)

        ctx2d.strokeStyle = withAlpha(blended, alpha * 0.7)
        ctx2d.lineWidth = 1.5
        ctx2d.beginPath()
        ctx2d.moveTo(x1, y1)
        ctx2d.lineTo(x2, y2)
        ctx2d.stroke()

        for (const [bx, by, bc] of [
          [x1, y1, b.colorIn] as const,
          [x2, y2, b.colorCloud] as const,
        ]) {
          ctx2d.fillStyle = withAlpha(bc, alpha * 0.35)
          ctx2d.beginPath()
          ctx2d.arc(bx, by, ringR, 0, 2 * Math.PI)
          ctx2d.fill()
          ctx2d.strokeStyle = withAlpha(bc, alpha)
          ctx2d.lineWidth = 1.5
          ctx2d.beginPath()
          ctx2d.arc(bx, by, ringR, 0, 2 * Math.PI)
          ctx2d.stroke()
        }
      }

      if (cloud.length === 0 && bursts.length === 0) {
        ctx2d.fillStyle = textH
        ctx2d.globalAlpha = 0.35
        ctx2d.textAlign = 'center'
        ctx2d.textBaseline = 'middle'
        ctx2d.font = '12px ui-monospace, Menlo, Consolas, monospace'
        ctx2d.fillText('tap a slot to play', cx, Math.min(cssH - 12, cy + rMax + 16))
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

  // Core slot trigger — manual taps, keyboard, and auto-pluck all route
  // through here so the cooldown / coincidence / audio / cloud paths stay
  // identical regardless of who fired. Auto-fired plucks pay a yield
  // penalty (AUTO_PLUCK_PENALTY) on Tone + Resonance so manual play is
  // strictly better when the player is at the keyboard.
  //
  // A slot can hold a stack of notes (slot 0's capacity upgrade). The
  // stack fires sequentially in array order — each note scans the cloud
  // *after* the previous note's partials have been added to it, so a
  // 2-note stack pays the chord's pair bonus on every tap at FULL
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

    const yieldMul = opts?.auto ? AUTO_PLUCK_PENALTY : 1
    const now = performance.now()
    const cloud = cloudRef.current
    const startAngle = slotHomeAngle(slotIdx)

    for (const noteId of notes) {
      const body = BODIES.find((b) => b.id === noteId)
      if (!body) continue

      const incoming = harmonicSeries(TONIC_HZ * body.ratio, HARMONIC_COUNT, defaultAmp)
      const { total, hits } = scanCoincidences(cloud, incoming, {
        tolFrac: COINCIDENCE_TOL,
        gain: RESONANCE_GAIN,
      })
      const incomingColor = PAD_COLORS[body.id] ?? ''

      onToneRef.current(TONE_PER_TAP * yieldMul)
      if (total > 0) {
        onResonanceRef.current(total * yieldMul)
        for (const h of hits) {
          // Cloud partial's current angle: ω·age + its own startAngle.
          // The incoming partial is brand new, so its angle is the slot's
          // home angle.
          const cloudEntry = cloud.find(
            (c) => c.noteId === h.cloudNoteId && c.partial === h.cloudPartial,
          )
          const omega =
            ((2 * Math.PI) / VISUAL_REF_PERIOD_S) * (h.freq / VISUAL_REF_FREQ_HZ)
          const cloudAge = cloudEntry ? (now - cloudEntry.bornAt) / 1000 : 0
          const cloudAngle = cloudEntry
            ? (cloudEntry.startAngle ?? 0) + omega * cloudAge
            : startAngle
          burstsRef.current.push({
            id: nextBurstIdRef.current++,
            freq: h.freq,
            bornMs: now,
            magnitude: h.bonus,
            angleIn: startAngle,
            angleCloud: cloudAngle,
            colorIn: incomingColor,
            colorCloud: PAD_COLORS[h.cloudNoteId] ?? incomingColor,
          })
        }
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
          startAngle,
        })
      }
    }
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

  // Click-outside / Escape closes any open picker.
  useEffect(() => {
    if (openPickerIdx === null) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('.slot-picker') || t.closest('.slot-picker-toggle')) return
      setOpenPickerIdx(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPickerIdx(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [openPickerIdx])

  // Picker click handler. Capacity-1 slots single-select replace and close;
  // capacity-N slots toggle the note in/out and stay open for stacking.
  const onPickerSelect = useCallback(
    (slotIdx: number, noteId: BodyId) => {
      const cap = slotCapacities[slotIdx] ?? 1
      const current = slots[slotIdx] ?? []
      const present = current.includes(noteId)
      if (cap === 1) {
        onSlotChange(slotIdx, present ? [] : [noteId])
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

  return (
    <section className="harvest" aria-label="Resonator stage">
      <canvas ref={canvasRef} className="spectrum" aria-hidden="true" />
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
          const padLabel = isEmpty
            ? `Empty slot ${idx + 1} — use the ▾ picker to add a note`
            : `Play ${notes.join('+')} (slot ${idx + 1}, key ${slotKey?.toUpperCase()})`
          return (
            <li key={idx} className="slot">
              <button
                type="button"
                className={`pad${isCooling ? ' cooling' : ''}${isEmpty ? ' empty' : ''}${isAuto ? ' auto' : ''}${isStack ? ' stack' : ''}`}
                onPointerDown={() => {
                  if (isEmpty) return
                  handleSlot(idx)
                }}
                disabled={isEmpty || isCooling}
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
                    <span className="pad-empty-cta">add a note via ▾</span>
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
                onClick={() => setOpenPickerIdx(pickerOpen ? null : idx)}
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                aria-label={`Choose note for slot ${idx + 1}`}
              >
                <span aria-hidden="true">▾</span>
              </button>
              {pickerOpen && (
                <div className="slot-picker" role="listbox" aria-label={`Slot ${idx + 1} note`}>
                  {isStack && (
                    <div className="slot-picker-header" aria-hidden="true">
                      stack {notes.length}/{cap}
                    </div>
                  )}
                  {!isEmpty && (
                    <button
                      type="button"
                      className="slot-picker-item slot-picker-clear"
                      onClick={() => onPickerClear(idx)}
                    >
                      <span className="slot-picker-swatch" aria-hidden="true" />
                      <span className="slot-picker-label">clear</span>
                    </button>
                  )}
                  {BODIES.map((b) => {
                    if (!unlockedIds.includes(b.id)) return null
                    const inOther = slots.some((s, i) => i !== idx && s.includes(b.id))
                    const isHere = notes.includes(b.id)
                    const atCap = !isHere && notes.length >= cap
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
                        {isStack && isHere && (
                          <span className="slot-picker-check" aria-hidden="true">✓</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="harvest-hint">
        Tap a slot (or press {SLOT_KEYS.slice(0, slotCount).map((k) => k.toUpperCase()).join('/')}) to play. Hit
        another while the first rings — coincident partials pay Resonance.
        Auto-plucked slots fire themselves at half yield (⚡).
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
