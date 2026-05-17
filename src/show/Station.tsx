// Station card + supporting atoms (HeatMeter, ConditionBadge, SlotChip,
// SlotRack). Ported from production-stations.jsx. The card layout is
// mobile-first but stretches fine on web.

import type { CSSProperties } from 'react'
import { Apparatus } from './Apparatus'
import {
  COIN_COLOR,
  KIND_META,
  STATION_MAX_CAPACITY,
  STATIONS,
  obs,
  recipeLabel,
  type Coin,
  type Recipe,
} from './data'
import {
  STATION_CAPACITY,
  STATION_RECIPES,
} from './data'
import type { Condition, Slot, StationState } from './state'
import { conditionOf } from './state'

const CONDITION_GLYPH: Record<Condition, string> = {
  warm: '●',
  tepid: '◐',
  cold: '○',
}

export function ConditionBadge({ condition }: { condition: Condition }) {
  return (
    <span className="sc condition-badge" data-condition={condition}>
      <span className="condition-badge-glyph">{CONDITION_GLYPH[condition]}</span>{' '}
      {condition}
    </span>
  )
}

export function HeatMeter({ value, condition }: { value: number; condition: Condition }) {
  const color = condition === 'warm' ? obs.rust : condition === 'tepid' ? obs.gold : obs.ink3
  return (
    <div className="heat-meter">
      <svg
        className="heat-meter-svg"
        preserveAspectRatio="none"
        viewBox="0 0 100 8"
      >
        <defs>
          <pattern id="heat-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="3" stroke={obs.ink} strokeWidth="0.4" opacity="0.55" />
          </pattern>
        </defs>
        <rect width={value * 100} height="8" fill={color} />
        <rect width={value * 100} height="8" fill="url(#heat-hatch)" opacity="0.45" />
        {[25, 50, 75].map((t) => (
          <line key={t} x1={t} y1="0" x2={t} y2="8" stroke={obs.ink} strokeWidth="0.4" opacity="0.45" />
        ))}
      </svg>
    </div>
  )
}

function SlotChip({
  slot,
  onSwap,
}: {
  slot: Slot & { recipe?: Recipe }
  onSwap?: () => void
}) {
  if (!slot || slot.state === 'empty') {
    return (
      <button
        type="button"
        onClick={onSwap}
        disabled={!onSwap}
        className="slot-chip"
        data-state="empty"
      >
        <span className="sc slot-chip-empty-label">+ slot</span>
      </button>
    )
  }
  if (slot.state === 'locked') {
    return (
      <div className="slot-chip" data-state="locked">
        <span className="sc slot-chip-locked-label">✕ writ</span>
      </div>
    )
  }
  const r = slot.recipe
  if (!r) return null
  const c = COIN_COLOR[r.out.note] || obs.ink
  const active = slot.state === 'active'
  const starved = slot.state === 'starved'
  return (
    <button
      type="button"
      onClick={onSwap}
      disabled={!onSwap}
      className="slot-chip"
      data-state={slot.state}
      style={{ '--slot-color': c } as CSSProperties}
    >
      <span className="slot-chip-corner" />
      <div className="slot-chip-row">
        <span className="display slot-chip-note">{r.out.note}</span>
        {r.out.qty > 1 && <span className="mono slot-chip-qty">×{r.out.qty}</span>}
        <span className="slot-chip-spacer" />
        {active && !starved && <span className="slot-chip-pulse" />}
        {starved && <span className="sc slot-chip-starve">!</span>}
      </div>
      <div className="mono slot-chip-recipe">{recipeLabel(r)}</div>
    </button>
  )
}

function SlotRack({
  slots,
  capacity,
  max,
  dense = false,
  stationId,
  onSwapSlot,
}: {
  slots: Slot[]
  capacity: number
  max: number
  dense?: boolean
  stationId: string
  onSwapSlot?: (slot: number) => void
}) {
  const lib = STATION_RECIPES[stationId] ?? []
  const resolveRecipe = (slot: Slot) =>
    slot.recipeId ? lib.find((r) => r.id === slot.recipeId) : undefined

  const filled: Array<Slot & { recipe?: Recipe }> = slots
    .slice(0, capacity)
    .map((s) => ({ ...s, recipe: resolveRecipe(s) }))
  while (filled.length < capacity) filled.push({ state: 'empty' })
  const locked: Array<Slot & { recipe?: Recipe }> = Array.from(
    { length: Math.max(0, max - capacity) },
    () => ({ state: 'locked' as const }),
  )
  const all = [...filled, ...locked]
  const activeCount = filled.filter((s) => s.state === 'active').length
  return (
    <div>
      {!dense && (
        <div className="sc slot-rack-header">
          <span>
            slots{' '}
            <span className="mono slot-rack-header-count">
              {activeCount}/{capacity}
            </span>
          </span>
          <span>tap to swap</span>
        </div>
      )}
      <div className="slot-rack-row">
        {all.map((s, i) => (
          <SlotChip
            key={i}
            slot={s}
            onSwap={
              onSwapSlot && i < capacity ? () => onSwapSlot(i) : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

export function StationCard({
  idx,
  state,
  onTend,
  onRelight,
  onSwapSlot,
}: {
  idx: number
  state: StationState
  onTend?: () => void
  onRelight?: () => void
  onSwapSlot?: (slot: number) => void
}) {
  const def = STATIONS[state.id]
  if (!def) return null
  const condition = conditionOf(state.heat)
  const c = COIN_COLOR[def.output.note as Coin] ?? obs.ink
  const km = KIND_META[def.kind]
  return (
    <div
      className="station-card"
      data-condition={condition}
      data-alarm={state.alarm || undefined}
      style={{ '--station-color': c } as CSSProperties}
    >
      <span className="mono station-card-badge">{String(idx).padStart(2, '0')}</span>

      <div className="station-card-header">
        <span
          className="sc station-kind"
          style={{ '--kind-color': km.color } as CSSProperties}
        >
          {km.glyph} {km.label}
        </span>
        <h3 className="display station-name">{def.name}</h3>
        <span className="station-card-spacer" />
        <ConditionBadge condition={condition} />
      </div>

      <div className="station-body">
        <div className="station-apparatus-cell">
          <Apparatus kind={state.id} condition={condition} />
          <div className="mono station-apparatus-cycle">
            cycle {def.cycle}s{state.auto ? ' · ⚡' : ''}
          </div>
        </div>
        <div className="station-info-cell">
          <SlotRack
            slots={state.slots}
            capacity={state.capacity || STATION_CAPACITY[state.id] || 1}
            max={STATION_MAX_CAPACITY[state.id] || state.capacity || 1}
            stationId={state.id}
            onSwapSlot={onSwapSlot}
          />
        </div>
      </div>

      <div className="station-meter-block">
        <div className="sc station-meter-labels">
          <span>cycle</span>
          <span className="mono">{Math.round(state.cycle * 100)}%</span>
        </div>
        <div className="station-cycle-bar">
          <span
            className="station-cycle-fill"
            style={{ width: `${state.cycle * 100}%` }}
          />
        </div>
      </div>

      <div className="station-meter-block">
        <div className="sc station-meter-labels">
          <span>heat</span>
          <span className="mono station-heat-readout" data-condition={condition}>
            {condition === 'cold' ? 'COOLED' : `${Math.round(state.heat * 100)}%`}
          </span>
        </div>
        <HeatMeter value={state.heat} condition={condition} />
      </div>

      {state.alarm && (
        <button
          type="button"
          onClick={condition === 'cold' ? onRelight : onTend}
          className="sc station-relight-btn"
        >
          <span className="station-relight-icon">✦</span>
          {condition === 'cold' ? (
            <>RELIGHT — costs <span className="mono">1 ƒ3</span></>
          ) : (
            <>cooling fast · tap to tend</>
          )}
          <span className="station-card-spacer" />
          <span className="display station-relight-cta">
            {condition === 'cold' ? '✦ relight →' : '⚒ tend →'}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onTend}
        disabled={!onTend}
        aria-label="tend"
        className="station-tend-btn"
      >
        <span className="station-tend-tab">tend</span>
      </button>
    </div>
  )
}
