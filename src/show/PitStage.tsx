// Stage I — The Pit. A single station card (the Cistern) under a coin
// purse strip, with an upgrades panel that lets the player invest ∮ in
// either gen yield (Brine Pump) or ref speed (Pipework). The two tracks
// pull the gen/ref balance in opposite directions; once the math tilts
// far enough, swapping the slot mix (2 Dig + 1 Press ↔ 1 Dig + 2 Press)
// is the move.

import type { ShowAction } from '../App'
import { CoinChip } from './Crown'
import { UPGRADES, type Coin, type UpgradeId } from './data'
import { StationCard } from './Station'
import { projectedApplauseRate, upgradeCost, type ShowState } from './state'

const PURSE_ORDER: Coin[] = ['C', '∮', 'ƒ3']

export function PitStage({
  state,
  dispatch,
}: {
  state: ShowState
  dispatch: (a: ShowAction) => void
}) {
  const rate = projectedApplauseRate(state, 0)
  return (
    <div className="pit-stage">
      <div className="pit-purse">
        <span className="sc pit-purse-label">purse</span>
        {PURSE_ORDER.map((k) => {
          const qty = Math.floor(state.purse[k] ?? 0)
          return <CoinChip key={k} note={k} qty={qty} dim={qty === 0} dashed={k === 'ƒ3'} />
        })}
        <span className="pit-purse-spacer" />
        <span className="sc pit-rate" title="projected ∮/s at base attention">
          <span className="mono pit-rate-value">{rate.toFixed(2)}</span> ∮/s
        </span>
      </div>

      <div className="pit-stations">
        {state.stations.map((s, i) => (
          <StationCard
            key={s.id}
            idx={i + 1}
            state={s}
            upgrades={state.upgrades}
            onTend={() => dispatch({ type: 'tend', station: i })}
            onRelight={() => dispatch({ type: 'relight', station: i })}
            onSwapSlot={(slot) => dispatch({ type: 'swap', station: i, slot })}
          />
        ))}

        <UpgradesPanel state={state} dispatch={dispatch} />
      </div>
    </div>
  )
}

function UpgradesPanel({
  state,
  dispatch,
}: {
  state: ShowState
  dispatch: (a: ShowAction) => void
}) {
  const purse = state.purse['∮'] ?? 0
  const ids: UpgradeId[] = ['genYield', 'refSpeed']
  return (
    <div className="pit-upgrades">
      <div className="sc pit-upgrades-header">upgrades · spend ∮ to tilt the balance</div>
      <div className="pit-upgrades-row">
        {ids.map((id) => {
          const u = UPGRADES[id]
          const level = state.upgrades[id]
          const cost = upgradeCost(id, level)
          const canAfford = purse >= cost
          return (
            <button
              key={id}
              type="button"
              className="pit-upgrade"
              data-affordable={canAfford || undefined}
              onClick={() => dispatch({ type: 'buy', upgrade: id })}
              disabled={!canAfford}
            >
              <div className="pit-upgrade-row">
                <span className="display pit-upgrade-name">{u.name}</span>
                <span className="mono pit-upgrade-level">L{level}</span>
              </div>
              <div className="mono pit-upgrade-blurb">{u.blurb}</div>
              <div className="mono pit-upgrade-cost">
                {cost} <span className="pit-upgrade-cost-mark">∮</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
