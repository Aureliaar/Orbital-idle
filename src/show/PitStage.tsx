// Stage I — The Pit. Three pit stations (Cistern, Bellows, Retort)
// share a purse strip at the top. Each station has a role (Gen ↔ Ref)
// that you toggle from the card header, and a small rack of module
// slots that the player fills with enhancements as ∮ accumulates.
//
// The central decision is the gen:ref split across the three stations
// (2G+1R ↔ 1G+2R), with the module loadout pushing each side's
// throughput. Role-locked modules (Brine Pump, Crusher) make flipping a
// station's role a real commitment — those modules go inactive on the
// wrong role.

import type { ShowAction } from '../App'
import { CoinChip } from './Crown'
import { type Coin } from './data'
import { StationCard } from './Station'
import { projectedApplauseRate, type ShowState } from './state'

const PURSE_ORDER: Coin[] = ['C', '∮', 'ƒ3']

export function PitStage({
  state,
  dispatch,
}: {
  state: ShowState
  dispatch: (a: ShowAction) => void
}) {
  // Attention modulates cycle speed (0.5× at 0, 1.5× at full house).
  // Show the actual instantaneous rate so the player notices the
  // attention drain rather than wondering why ∮ accumulates slower
  // than the headline number.
  const baseRate = projectedApplauseRate(state)
  const cycleSpeed = 0.5 + state.attention
  const rate = baseRate * cycleSpeed
  return (
    <div className="pit-stage">
      <div className="pit-purse">
        <span className="sc pit-purse-label">purse</span>
        {PURSE_ORDER.map((k) => {
          const qty = Math.floor(state.purse[k] ?? 0)
          return <CoinChip key={k} note={k} qty={qty} dim={qty === 0} dashed={k === 'ƒ3'} />
        })}
        <span className="pit-purse-spacer" />
        <span className="sc pit-rate" title="∮/s at current attention; full house = 1.5× base">
          <span className="mono pit-rate-value">{rate.toFixed(2)}</span> ∮/s
        </span>
      </div>

      <div className="pit-stations">
        {state.stations.map((s, i) => (
          <StationCard
            key={s.id}
            idx={i + 1}
            state={s}
            showState={state}
            onTend={() => dispatch({ type: 'tend', station: i })}
            onRelight={() => dispatch({ type: 'relight', station: i })}
            onToggleRole={() => dispatch({ type: 'toggleRole', station: i })}
            onCycleSlot={(slot) => dispatch({ type: 'cycleModule', station: i, slot })}
          />
        ))}
      </div>
    </div>
  )
}
