// Stage I — The Pit. Vertical chain of station cards under a coin purse
// strip. Ported from production-screens.jsx · PitScreen.

import type { ShowAction } from '../App'
import { CoinChip } from './Crown'
import { type Coin } from './data'
import { StationCard } from './Station'
import type { ShowState } from './state'

const PURSE_ORDER: Coin[] = ['C', 'E', 'G', 'ƒ3', '∮']

export function PitStage({
  state,
  dispatch,
}: {
  state: ShowState
  dispatch: (a: ShowAction) => void
}) {
  return (
    <div className="pit-stage">
      <div className="pit-purse">
        <span className="sc pit-purse-label">purse</span>
        {PURSE_ORDER.map((k) => {
          const qty = state.purse[k] ?? 0
          return <CoinChip key={k} note={k} qty={qty} dim={qty === 0} dashed={k === 'ƒ3'} />
        })}
      </div>

      <div className="pit-stations">
        {state.stations.map((s, i) => (
          <StationCard
            key={s.id}
            idx={i + 1}
            state={s}
            onTend={() => dispatch({ type: 'tend', station: i })}
            onRelight={() => dispatch({ type: 'relight', station: i })}
            onSwapSlot={(slot) => dispatch({ type: 'swap', station: i, slot })}
          />
        ))}
        <div className="pit-add-station">
          <div className="display pit-add-station-title">+ a fourth station</div>
          <div className="mono pit-add-station-cost">
            costs <span className="cost-amber">8 ∮</span> +{' '}
            <span className="cost-writ">3 ✎</span> · unlock via research
          </div>
        </div>
      </div>
    </div>
  )
}
