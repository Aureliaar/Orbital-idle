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

type Burst = { id: number; freq: number; bornMs: number; magnitude: number }

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
  const modalRef = useRef<HTMLDivElement | null>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
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

  // rAF: decay cloud + bursts, redraw spectrum strip.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    let raf = 0
    let last = performance.now()

    // Spectrum X-axis is fixed across the full diatonic ladder (max ratio =
    // B at 15/8, max partial = HARMONIC_COUNT) so the scale doesn't jump as
    // the player unlocks more notes.
    const maxRatio = BODIES.reduce((m, b) => (b.ratio > m ? b.ratio : m), 1)
    const fMin = TONIC_HZ * 0.95
    const fMax = TONIC_HZ * maxRatio * HARMONIC_COUNT * 1.05

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

      const padX = 14
      const xOf = (f: number) => {
        const u = Math.log(f / fMin) / Math.log(fMax / fMin)
        return padX + (cssW - 2 * padX) * Math.max(0, Math.min(1, u))
      }
      const baselineY = cssH - 18

      ctx2d.strokeStyle = border
      ctx2d.lineWidth = 1
      ctx2d.beginPath()
      ctx2d.moveTo(0, baselineY)
      ctx2d.lineTo(cssW, baselineY)
      ctx2d.stroke()
      ctx2d.font = '10px ui-monospace, Menlo, Consolas, monospace'
      ctx2d.textAlign = 'center'
      ctx2d.textBaseline = 'top'

      // Tick + letter for each currently-slotted note. Same-note exclusion
      // means a note appears at most once even across stacked slot 0.
      const slotsNow = slotsRef.current
      const drawnNotes = new Set<BodyId>()
      for (const slotNotes of slotsNow) {
        for (const id of slotNotes) {
          if (drawnNotes.has(id)) continue
          drawnNotes.add(id)
          const body = BODIES.find((b) => b.id === id)
          if (!body) continue
          const x = xOf(TONIC_HZ * body.ratio)
          const color = PAD_COLORS[id] ?? accent
          ctx2d.strokeStyle = color
          ctx2d.beginPath()
          ctx2d.moveTo(x, baselineY)
          ctx2d.lineTo(x, baselineY + 4)
          ctx2d.stroke()
          ctx2d.fillStyle = withAlpha(color, 0.85)
          ctx2d.fillText(id, x, baselineY + 6)
        }
      }

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
        ctx2d.fillText('tap a slot to play', cssW / 2, cssH / 2)
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

    for (const noteId of notes) {
      const body = BODIES.find((b) => b.id === noteId)
      if (!body) continue

      const incoming = harmonicSeries(TONIC_HZ * body.ratio, HARMONIC_COUNT, defaultAmp)
      const { total, hits } = scanCoincidences(cloud, incoming, {
        tolFrac: COINCIDENCE_TOL,
        gain: RESONANCE_GAIN,
      })

      onToneRef.current(TONE_PER_TAP * yieldMul)
      if (total > 0) {
        onResonanceRef.current(total * yieldMul)
        for (const h of hits) {
          burstsRef.current.push({
            id: nextBurstIdRef.current++,
            freq: h.freq,
            bornMs: now,
            magnitude: h.bonus,
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
