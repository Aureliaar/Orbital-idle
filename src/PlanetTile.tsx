import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Body } from './bodies'

const LONG_PRESS_MS = 420

type Props = {
  body: Body
  armed: boolean
  active: boolean
  locked: boolean
  unlockHint?: string
  affordable: boolean
  onSelect: () => void
  onLongPress: () => void
}

export function PlanetTile({
  body,
  armed,
  active,
  locked,
  unlockHint,
  affordable,
  onSelect,
  onLongPress,
}: Props) {
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
    if (wasShort && !longFiredRef.current) onSelect()
  }

  const onPointerCancel = () => {
    clearTimer()
    setPressing(false)
  }

  const className = [
    'tile',
    armed ? 'armed' : '',
    pressing ? 'pressing' : '',
    active ? 'active' : '',
    locked ? 'locked' : '',
    locked && !affordable ? 'unaffordable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = locked
    ? `Unlock ${body.name}'s resonator${unlockHint ? ` (${unlockHint})` : ''}`
    : active
      ? `${body.name} resonator (active). Long-press for orbital stats.`
      : `Open ${body.name}'s resonator. Long-press for orbital stats.`

  return (
    <button
      type="button"
      className={className}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
      aria-pressed={active}
    >
      <span className="tile-progress" aria-hidden="true" />
      <span className="tile-row">
        <span className="tile-note">{body.note}</span>
        <span className="tile-roman">{body.romanNumeral}</span>
      </span>
      <span className="tile-name">{body.name}</span>
      <span className="tile-interval">{body.intervalLabel}</span>
      <span className="tile-status" aria-hidden="true">
        {locked
          ? unlockHint
            ? `unlock · ${unlockHint}`
            : 'locked'
          : active
            ? 'active'
            : armed
              ? 'window open'
              : 'open resonator'}
      </span>
    </button>
  )
}
