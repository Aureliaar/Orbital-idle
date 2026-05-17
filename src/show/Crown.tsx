// ShowCrown — the fixed header that sits above every stage.
// Displays Folio · Act · Scene · Bar plus an audience attention bar with
// hatched parchment fill. Ported from production.jsx · ShowCrown.

import type { CSSProperties } from 'react'
import { obs, type Note } from './data'
import { BARS_PER_ACT } from './state'

export type Tab = 'pit' | 'wheel' | 'research'

const TAB_TITLES: Record<Tab, string> = {
  pit: 'The Pit',
  wheel: 'Wheel',
  research: 'Research',
}

export function ShowCrown({
  tab,
  act,
  scene,
  bar,
  attention,
}: {
  tab: Tab
  act: string
  scene: string
  bar: number
  attention: number
}) {
  return (
    <div className="show-crown">
      <div className="sc show-crown-meta">
        <span>Folio I · {TAB_TITLES[tab]}</span>
        <span className="show-crown-live">● live</span>
      </div>
      <div className="show-crown-title-row">
        <h1 className="display show-crown-title">
          The Show<span className="show-crown-title-dot">.</span>
        </h1>
        <span className="display show-crown-subtitle">
          Act {act} · Sc. {scene} · bar{' '}
          <span className="mono">{bar}</span>/{BARS_PER_ACT}
        </span>
      </div>
      <AttentionBar attention={attention} />
    </div>
  )
}

function AttentionBar({ attention }: { attention: number }) {
  const pct = Math.round(attention * 100)
  return (
    <div className="attention-bar">
      <div className="sc attention-bar-labels">
        <span>Audience attention</span>
        <span className="mono attention-bar-pct">{pct}%</span>
      </div>
      <div className="attention-bar-track">
        <svg
          className="attention-bar-svg"
          preserveAspectRatio="none"
          viewBox="0 0 100 10"
        >
          <defs>
            <pattern
              id="audhatch"
              width="3"
              height="3"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="3" stroke={obs.ink} strokeWidth="0.4" opacity="0.6" />
            </pattern>
          </defs>
          <rect width={attention * 100} height="10" fill={obs.rust} />
          <rect width={attention * 100} height="10" fill="url(#audhatch)" opacity="0.4" />
          <line x1="25" y1="0" x2="25" y2="10" stroke={obs.ink} strokeWidth="0.5" strokeDasharray="1 1" opacity="0.5" />
          <line x1="10" y1="0" x2="10" y2="10" stroke={obs.rust} strokeWidth="0.6" />
        </svg>
      </div>
    </div>
  )
}

// Three tabs at the top — sitting below the Crown. The bottom-bar
// version in the handoff spec wasn't required; one row of tabs reads
// fine on web too.
export function StageTabs({
  active,
  onChange,
}: {
  active: Tab
  onChange: (t: Tab) => void
}) {
  const tabs: Array<{ id: Tab; roman: string; label: string }> = [
    { id: 'pit', roman: 'I', label: 'The Pit' },
    { id: 'wheel', roman: 'II', label: 'Wheel' },
    { id: 'research', roman: 'III', label: 'Research' },
  ]
  return (
    <div role="tablist" className="stage-tabs">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className="stage-tab"
          >
            <span className="sc stage-tab-eyebrow">Stage {t.roman}</span>
            <span className="display stage-tab-title">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// Small reusable atom — coin chip with diatonic colour, parchment fill,
// dashed border for costs / locked entries. Square corners.
export function CoinChip({
  note,
  qty,
  dim = false,
  dashed = false,
  size = 'sm',
}: {
  note: Note | 'ƒ3' | 'ƒ5' | '∮' | '✎'
  qty?: number
  dim?: boolean
  dashed?: boolean
  size?: 'sm' | 'lg'
}) {
  // The chip palette is duplicated from data.COIN_COLOR but referenced
  // by literal here to keep the leaf import shallow.
  const colours: Record<string, string> = {
    C: '#dc4836', D: '#dd8a36', E: '#c9a83a', F: '#4aa84a',
    G: '#3a9fb8', A: '#3a6dc8', B: '#9a3ac8',
    'ƒ3': '#5a6cf0', 'ƒ5': '#3ab07a', '∮': '#7a5a1a', '✎': '#3d2c1a',
  }
  const c = colours[note] ?? obs.ink
  return (
    <span
      className="mono coin-chip"
      data-size={size}
      data-dim={dim || undefined}
      data-dashed={dashed || undefined}
      style={{ '--coin-color': c } as CSSProperties}
    >
      <span className="coin-chip-dot" />
      <span className="coin-chip-note">{note}</span>
      {qty != null && <span>{qty}</span>}
    </span>
  )
}
