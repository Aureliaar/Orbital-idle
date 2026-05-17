// Station card + supporting atoms (HeatMeter, ConditionBadge, SlotChip,
// SlotRack). Ported from production-stations.jsx. The card layout is
// mobile-first but stretches fine on web.

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

export function ConditionBadge({ condition }: { condition: Condition }) {
  const map: Record<Condition, { label: string; color: string; glyph: string }> = {
    warm: { label: 'warm', color: obs.rust, glyph: '●' },
    tepid: { label: 'tepid', color: obs.gold, glyph: '◐' },
    cold: { label: 'cold', color: obs.ink3, glyph: '○' },
  }
  const m = map[condition]
  return (
    <span
      className="sc"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        fontSize: 9,
        letterSpacing: '0.2em',
        border: `0.5px solid ${m.color}`,
        color: m.color,
        background: m.color + '18',
      }}
    >
      <span style={{ fontSize: 10 }}>{m.glyph}</span> {m.label}
    </span>
  )
}

export function HeatMeter({ value, condition }: { value: number; condition: Condition }) {
  const color = condition === 'warm' ? obs.rust : condition === 'tepid' ? obs.gold : obs.ink3
  return (
    <div
      style={{
        position: 'relative',
        height: 7,
        border: `0.5px solid ${obs.ink}`,
        background: obs.paper,
        overflow: 'hidden',
      }}
    >
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
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

function SlotChip({ slot }: { slot: Slot & { recipe?: Recipe } }) {
  if (!slot || slot.state === 'empty') {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          border: `1px dashed ${obs.ink}77`,
          background: 'transparent',
          padding: '4px 6px 5px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: obs.ink3,
          minHeight: 50,
        }}
      >
        <span className="sc" style={{ fontSize: 9, letterSpacing: '0.2em' }}>+ slot</span>
      </div>
    )
  }
  if (slot.state === 'locked') {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          border: `1px dashed ${obs.ink3}`,
          background: obs.bg2 + '44',
          padding: '4px 6px 5px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: obs.ink3,
          minHeight: 50,
          opacity: 0.7,
        }}
      >
        <span className="sc" style={{ fontSize: 8, letterSpacing: '0.18em' }}>✕ writ</span>
      </div>
    )
  }
  const r = slot.recipe
  if (!r) return null
  const c = COIN_COLOR[r.out.note] || obs.ink
  const active = slot.state === 'active'
  const starved = slot.state === 'starved'
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        position: 'relative',
        border: `0.5px solid ${active ? c : obs.ink3}`,
        background: active ? c + '20' : obs.bg,
        padding: '4px 6px 5px',
        opacity: starved ? 0.55 : slot.state === 'idle' ? 0.75 : 1,
        minHeight: 50,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: -1,
          left: -1,
          width: 10,
          height: 6,
          background: active ? c : obs.ink3,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          className="display"
          style={{ fontStyle: 'italic', fontSize: 18, color: c, lineHeight: 1, fontWeight: 500 }}
        >
          {r.out.note}
        </span>
        {r.out.qty > 1 && (
          <span className="mono" style={{ fontSize: 9, color: c }}>×{r.out.qty}</span>
        )}
        <span style={{ flex: 1 }} />
        {active && !starved && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: c,
              boxShadow: `0 0 0 1px ${c}44`,
            }}
          />
        )}
        {starved && (
          <span className="sc" style={{ fontSize: 8, color: obs.rust, letterSpacing: '0.15em' }}>!</span>
        )}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 8.5,
          color: obs.ink2,
          marginTop: 3,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {recipeLabel(r)}
      </div>
    </div>
  )
}

function SlotRack({
  slots,
  capacity,
  max,
  dense = false,
  stationId,
}: {
  slots: Slot[]
  capacity: number
  max: number
  dense?: boolean
  stationId: string
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
        <div
          className="sc"
          style={{
            fontSize: 8,
            color: obs.ink3,
            letterSpacing: '0.2em',
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 3,
          }}
        >
          <span>
            slots{' '}
            <span className="mono" style={{ color: obs.ink2 }}>
              {activeCount}/{capacity}
            </span>
          </span>
          <span>tap to swap</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
        {all.map((s, i) => (
          <SlotChip key={i} slot={s} />
        ))}
      </div>
    </div>
  )
}

export function StationCard({
  idx,
  state,
}: {
  idx: number
  state: StationState
}) {
  const def = STATIONS[state.id]
  if (!def) return null
  const condition = conditionOf(state.heat)
  const c = COIN_COLOR[def.output.note as Coin] ?? obs.ink
  const km = KIND_META[def.kind]
  return (
    <div
      style={{
        position: 'relative',
        border: `${state.alarm ? '1px dashed' : '0.5px solid'} ${state.alarm ? obs.rust : obs.ink}`,
        background:
          condition === 'cold' ? obs.bg2 + '55' : condition === 'tepid' ? obs.paper : obs.paper,
        padding: '10px 12px 12px',
      }}
    >
      <span
        className="mono"
        style={{
          position: 'absolute',
          left: -10,
          top: 10,
          width: 20,
          height: 20,
          background: obs.ink,
          color: obs.bg,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          transform: 'rotate(-4deg)',
        }}
      >
        {String(idx).padStart(2, '0')}
      </span>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span
          className="sc"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 5px',
            fontSize: 8,
            letterSpacing: '0.2em',
            color: km.color,
            border: `0.5px solid ${km.color}77`,
            background: km.color + '14',
          }}
        >
          {km.glyph} {km.label}
        </span>
        <h3 className="display" style={{ fontSize: 17, fontStyle: 'italic', lineHeight: 1, margin: 0, fontWeight: 400 }}>
          {def.name}
        </h3>
        <span style={{ flex: 1 }} />
        <ConditionBadge condition={condition} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr',
          gap: 10,
          marginTop: 8,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ width: 64 }}>
          <Apparatus kind={state.id} condition={condition} />
          <div
            className="mono"
            style={{
              fontSize: 8,
              color: obs.ink3,
              textAlign: 'center',
              marginTop: 2,
              letterSpacing: '0.06em',
            }}
          >
            cycle {def.cycle}s{state.auto ? ' · ⚡' : ''}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <SlotRack
            slots={state.slots}
            capacity={state.capacity || STATION_CAPACITY[state.id] || 1}
            max={STATION_MAX_CAPACITY[state.id] || state.capacity || 1}
            stationId={state.id}
          />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div
          className="sc"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 8,
            letterSpacing: '0.22em',
            color: obs.ink3,
            marginBottom: 2,
          }}
        >
          <span>cycle</span>
          <span className="mono">{Math.round(state.cycle * 100)}%</span>
        </div>
        <div
          style={{
            position: 'relative',
            height: 4,
            background: obs.bg2,
            border: `0.5px solid ${obs.ink}55`,
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${state.cycle * 100}%`,
              background: c,
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div
          className="sc"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 8,
            letterSpacing: '0.22em',
            color: obs.ink3,
            marginBottom: 2,
          }}
        >
          <span>heat</span>
          <span
            className="mono"
            style={{ color: condition === 'cold' ? obs.rust : obs.ink3 }}
          >
            {condition === 'cold' ? 'COOLED' : `${Math.round(state.heat * 100)}%`}
          </span>
        </div>
        <HeatMeter value={state.heat} condition={condition} />
      </div>

      {state.alarm && (
        <div
          className="sc"
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 9,
            letterSpacing: '0.2em',
            color: obs.rust,
            padding: '4px 8px',
            border: `0.5px solid ${obs.rust}`,
            background: obs.rust + '14',
          }}
        >
          <span style={{ fontSize: 11 }}>✦</span>
          {condition === 'cold' ? (
            <>RELIGHT — costs <span className="mono">1 ƒ3</span></>
          ) : (
            <>cooling fast · tap to tend</>
          )}
          <span style={{ flex: 1 }} />
          <span
            className="display"
            style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}
          >
            {condition === 'cold' ? '✦ relight →' : '⚒ tend →'}
          </span>
        </div>
      )}

      <span
        style={{
          position: 'absolute',
          right: -8,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            width: 14,
            height: 22,
            border: `0.5px solid ${obs.ink}`,
            background: obs.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'IM Fell English SC',
            fontSize: 8,
            color: obs.ink2,
            letterSpacing: 0,
            writingMode: 'vertical-rl',
          }}
        >
          tend
        </span>
      </span>
    </div>
  )
}
