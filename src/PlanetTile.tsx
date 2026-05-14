import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Body } from './bodies'

const LONG_PRESS_MS = 420

type Props = {
  body: Body
  // Interval from the current source station to this body. The body's
  // intrinsic intervalLabel is always relative to C/Earth; this prop
  // overrides it so the label tracks the active launch station.
  interval?: string
  armed: boolean
  flying: boolean
  onLaunch: () => void
  onLongPress: () => void
}

export function PlanetTile({ body, interval, armed, flying, onLaunch, onLongPress }: Props) {
  const timerRef = useRef<number | null>(null)
  const longFiredRef = useRef(false)
  const [pressing, setPressing] = useState(false)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => () => clearTimer(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    longFiredRef.current = false
    setPressing(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      longFiredRef.current = true
      setPressing(false)
      onLongPress()
    }, LONG_PRESS_MS)
  }

  const onPointerUp = () => {
    const wasShort = timerRef.current !== null
    clearTimer()
    setPressing(false)
    if (wasShort && !longFiredRef.current && armed && !flying) {
      onLaunch()
    }
  }

  const onPointerCancel = () => {
    clearTimer()
    setPressing(false)
  }

  const className = [
    'tile',
    armed ? 'armed' : '',
    pressing ? 'pressing' : '',
    flying ? 'flying' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Launch to ${body.name}. Long-press to upgrade.`}
    >
      <span className="tile-progress" aria-hidden="true" />
      <span className="tile-row">
        <span className="tile-note">{body.note}</span>
        <span className="tile-roman">{body.romanNumeral}</span>
      </span>
      <span className="tile-name">{body.name}</span>
      <span className="tile-interval">{interval ?? body.intervalLabel}</span>
      <span className="tile-status" aria-hidden="true">
        {flying ? 'in transit' : armed ? 'window open' : '—'}
      </span>
    </button>
  )
}
