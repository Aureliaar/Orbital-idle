import { useEffect } from 'react'
import type { Body } from './bodies'
import { periodOf, ratioLabel } from './bodies'

type Props = {
  body: Body
  onClose: () => void
}

const STUBS = [
  { key: 'payout',    title: 'Probe payout',       hint: 'Lump sum on cadence return' },
  { key: 'efficiency', title: 'Transfer efficiency', hint: 'Cheaper launches in window' },
  { key: 'tolerance', title: 'Window tolerance',   hint: 'Wider arc counts as a window' },
  { key: 'comsat',    title: 'Comsat constellation', hint: 'Idle income while parked' },
]

export function UpgradePanel({ body, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="upgrade-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
    >
      <button
        type="button"
        className="upgrade-scrim"
        aria-label="Close upgrade panel"
        onClick={onClose}
      />
      <div className="upgrade-panel">
        <header className="upgrade-head">
          <div>
            <h2 id="upgrade-title">{body.name}</h2>
            <p className="upgrade-sub">
              {body.note} · {body.romanNumeral} · {body.intervalLabel} from Earth
            </p>
          </div>
          <button
            type="button"
            className="upgrade-x"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <dl className="upgrade-stats">
          <div>
            <dt>Period</dt>
            <dd>{periodOf(body).toFixed(2)}s</dd>
          </div>
          <div>
            <dt>Ratio</dt>
            <dd>{ratioLabel(body.ratio)}</dd>
          </div>
          <div>
            <dt>Probes</dt>
            <dd>0</dd>
          </div>
        </dl>

        <ul className="upgrade-list">
          {STUBS.map((s) => (
            <li key={s.key} className="upgrade-row">
              <div className="upgrade-row-text">
                <h3>{s.title}</h3>
                <p>{s.hint}</p>
              </div>
              <div className="upgrade-row-action">
                <span className="upgrade-level">Lv 0</span>
                <button type="button" disabled>
                  +1
                </button>
              </div>
            </li>
          ))}
        </ul>

        <p className="upgrade-foot">
          Upgrades are stubs — wiring lands once the economy loop does.
        </p>
      </div>
    </div>
  )
}
