// Station card + supporting atoms (HeatMeter, ConditionBadge, RoleBadge,
// ModuleChip, ModuleRack). Each pit station has a role (gen or ref)
// toggled from the header, and a row of module slots that the player
// cycles through with taps. Heat / cycle progress is station-wide
// because the recipe is role-derived.

import type { CSSProperties } from 'react'
import { Apparatus } from './Apparatus'
import {
  COIN_COLOR,
  MODULES,
  STATION_MAX_CAPACITY,
  STATIONS,
  obs,
  type Coin,
  type ModuleId,
  type StationRole,
} from './data'
import type { Condition, ShowState, Slot, StationState } from './state'
import {
  conditionOf,
  effectiveStationRecipe,
  moduleCost,
} from './state'

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

const ROLE_GLYPH: Record<StationRole, string> = { gen: '◇', ref: '△' }
const ROLE_LABEL: Record<StationRole, string> = { gen: 'gen · C', ref: 'ref · ∮' }

function RoleBadge({ role, onToggle }: { role: StationRole; onToggle?: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      className="role-badge"
      data-role={role}
      title="tap to flip role"
    >
      <span className="role-badge-glyph">{ROLE_GLYPH[role]}</span>
      <span className="sc role-badge-label">{ROLE_LABEL[role]}</span>
      {onToggle && <span className="role-badge-flip">⇄</span>}
    </button>
  )
}

function ModuleChip({
  slot,
  nextCost,
  onCycle,
}: {
  slot: Slot
  nextCost: number | null
  onCycle?: () => void
}) {
  if (slot.state === 'locked') {
    return (
      <div className="slot-chip" data-state="locked">
        <span className="sc slot-chip-locked-label">✕ writ</span>
      </div>
    )
  }
  if (slot.state === 'empty' || !slot.moduleId) {
    return (
      <button
        type="button"
        onClick={onCycle}
        disabled={!onCycle}
        className="slot-chip"
        data-state="empty"
      >
        <span className="sc slot-chip-empty-label">+ module</span>
        {nextCost != null && (
          <span className="mono slot-chip-cost">{nextCost} ∮</span>
        )}
      </button>
    )
  }
  const m = MODULES[slot.moduleId]
  const inactive = slot.state === 'inactive'
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={!onCycle}
      className="slot-chip"
      data-state={inactive ? 'inactive' : 'installed'}
      style={{ '--slot-color': obs.gold } as CSSProperties}
    >
      <span className="slot-chip-corner" />
      <div className="slot-chip-row">
        <span className="display slot-chip-module">{m.name}</span>
        <span className="slot-chip-spacer" />
        {inactive && <span className="sc slot-chip-inactive">idle</span>}
      </div>
      <div className="mono slot-chip-recipe">
        {m.blurb}
        {m.roleLock && <span className="slot-chip-rolelock"> · {m.roleLock}</span>}
      </div>
    </button>
  )
}

function ModuleRack({
  station,
  showState,
  onCycleSlot,
}: {
  station: StationState
  showState: ShowState
  onCycleSlot?: (slot: number) => void
}) {
  const max = STATION_MAX_CAPACITY[station.id] || station.capacity || 1
  const slots = station.slots.slice(0, station.capacity)
  while (slots.length < station.capacity) slots.push({ state: 'empty' })
  const locked: Slot[] = Array.from(
    { length: Math.max(0, max - station.capacity) },
    () => ({ state: 'locked' }),
  )
  const all: Slot[] = [...slots, ...locked]

  // Hint cost: the cheapest install the player can afford right now,
  // computed against the full state so the global install-count is
  // taken into account. Empty slots show this; the action recomputes.
  const have = showState.purse['∮'] ?? 0
  let cheapestCost: number | null = null
  for (const id of ['brinePump', 'crusher', 'pipework', 'damper'] as ModuleId[]) {
    const c = moduleCost(showState, id)
    if (c <= have && (cheapestCost === null || c < cheapestCost)) cheapestCost = c
  }

  const installedCount = station.slots.filter(
    (s) => s.state === 'installed',
  ).length

  return (
    <div>
      <div className="sc slot-rack-header">
        <span>
          modules{' '}
          <span className="mono slot-rack-header-count">
            {installedCount}/{station.capacity}
          </span>
        </span>
        <span>tap to swap</span>
      </div>
      <div className="slot-rack-row">
        {all.map((s, i) => (
          <ModuleChip
            key={i}
            slot={s}
            nextCost={i < station.capacity ? cheapestCost : null}
            onCycle={
              onCycleSlot && i < station.capacity ? () => onCycleSlot(i) : undefined
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
  showState,
  onTend,
  onRelight,
  onToggleRole,
  onCycleSlot,
}: {
  idx: number
  state: StationState
  showState: ShowState
  onTend?: () => void
  onRelight?: () => void
  onToggleRole?: () => void
  onCycleSlot?: (slot: number) => void
}) {
  const def = STATIONS[state.id]
  if (!def) return null
  const condition = conditionOf(state.heat)
  const recipe = effectiveStationRecipe(state)
  const accent = COIN_COLOR[recipe.out.note as Coin] ?? obs.ink
  return (
    <div
      className="station-card"
      data-condition={condition}
      data-alarm={state.alarm || undefined}
      data-role={state.role}
      style={{ '--station-color': accent } as CSSProperties}
    >
      <span className="mono station-card-badge">{String(idx).padStart(2, '0')}</span>

      <div className="station-card-header">
        <RoleBadge role={state.role} onToggle={onToggleRole} />
        <h3 className="display station-name">{def.name}</h3>
        <span className="station-card-spacer" />
        <ConditionBadge condition={condition} />
      </div>

      <div className="station-body">
        <div className="station-apparatus-cell">
          <Apparatus kind={state.id} condition={condition} />
          <div className="mono station-apparatus-cycle">
            cycle {recipe.cycle.toFixed(1)}s · {state.role === 'gen' ? `∅→${recipe.out.qty}C` : `1C→${recipe.out.qty}∮`}
          </div>
        </div>
        <div className="station-info-cell">
          <ModuleRack
            station={state}
            showState={showState}
            onCycleSlot={onCycleSlot}
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

