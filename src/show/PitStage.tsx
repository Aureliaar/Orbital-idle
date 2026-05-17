// Stage I — The Pit. Vertical chain of station cards under a coin purse
// strip. Ported from production-screens.jsx · PitScreen.

import { CoinChip } from './Crown'
import { obs, type Coin } from './data'
import { StationCard } from './Station'
import type { ShowState } from './state'

const PURSE_ORDER: Coin[] = ['C', 'E', 'G', 'ƒ3', '∮']

export function PitStage({ state }: { state: ShowState }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          borderBottom: `0.5px dotted ${obs.ink}55`,
          background: obs.bg2 + '22',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <span
          className="sc"
          style={{
            fontSize: 8,
            color: obs.ink2,
            letterSpacing: '0.22em',
            alignSelf: 'center',
            marginRight: 4,
          }}
        >
          purse
        </span>
        {PURSE_ORDER.map((k) => {
          const qty = state.purse[k] ?? 0
          return <CoinChip key={k} note={k} qty={qty} dim={qty === 0} dashed={k === 'ƒ3'} />
        })}
      </div>

      <div
        style={{
          flex: 1,
          padding: '12px 20px 16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {state.stations.map((s, i) => (
          <StationCard key={s.id} idx={i + 1} state={s} />
        ))}
        <div
          style={{
            border: `1px dashed ${obs.ink}77`,
            background: obs.bg2 + '33',
            padding: '12px 12px',
            textAlign: 'center',
            position: 'relative',
          }}
        >
          <div
            className="display"
            style={{ fontSize: 15, fontStyle: 'italic', color: obs.ink2 }}
          >
            + a fourth station
          </div>
          <div className="mono" style={{ fontSize: 9, color: obs.ink3, marginTop: 2 }}>
            costs <span style={{ color: obs.rust }}>8 ∮</span> +{' '}
            <span style={{ color: obs.ink2 }}>3 ✎</span> · unlock via research
          </div>
        </div>
      </div>
    </div>
  )
}
