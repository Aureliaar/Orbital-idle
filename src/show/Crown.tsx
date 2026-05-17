// ShowCrown — the fixed header that sits above every stage.
// Displays Folio · Act · Scene · Bar plus an audience attention bar with
// hatched parchment fill. Ported from production.jsx · ShowCrown.

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
    <div
      style={{
        padding: '12px 16px 8px',
        position: 'relative',
        zIndex: 2,
        borderBottom: `0.5px solid ${obs.ink}`,
      }}
    >
      <div
        className="sc"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 8,
          color: obs.ink2,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
        }}
      >
        <span>Folio I · {TAB_TITLES[tab]}</span>
        <span style={{ color: obs.rust }}>● live</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginTop: 2,
        }}
      >
        <h1
          className="display"
          style={{ fontSize: 26, fontStyle: 'italic', lineHeight: 1, margin: 0, fontWeight: 400 }}
        >
          The Show<span style={{ color: obs.rust, fontStyle: 'normal' }}>.</span>
        </h1>
        <span
          className="display"
          style={{ fontStyle: 'italic', fontSize: 12, color: obs.ink2 }}
        >
          Act {act} · Sc. {scene} · bar{' '}
          <span className="mono" style={{ color: obs.ink }}>{bar}</span>/{BARS_PER_ACT}
        </span>
      </div>
      <AttentionBar attention={attention} />
    </div>
  )
}

function AttentionBar({ attention }: { attention: number }) {
  const pct = Math.round(attention * 100)
  return (
    <div style={{ marginTop: 8 }}>
      <div
        className="sc"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 8,
          color: obs.ink2,
          letterSpacing: '0.22em',
          marginBottom: 2,
        }}
      >
        <span>Audience attention</span>
        <span className="mono" style={{ color: obs.rust }}>{pct}%</span>
      </div>
      <div
        style={{
          position: 'relative',
          height: 9,
          border: `0.5px solid ${obs.ink}`,
          background: obs.paper,
          overflow: 'hidden',
        }}
      >
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
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
    <div
      role="tablist"
      style={{
        display: 'flex',
        borderTop: `0.5px solid ${obs.ink}`,
        borderBottom: `0.5px solid ${obs.ink}`,
        position: 'relative',
        zIndex: 2,
      }}
    >
      {tabs.map((t, i) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            style={{
              flex: 1,
              padding: '7px 8px',
              background: on ? obs.ink : 'transparent',
              color: on ? obs.bg : obs.ink,
              border: 'none',
              borderRight: i < tabs.length - 1 ? `0.5px solid ${obs.ink}` : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span
              className="sc"
              style={{ fontSize: 8, letterSpacing: '0.22em', color: on ? obs.rustSoft : obs.rust }}
            >
              Stage {t.roman}
            </span>
            <span className="display" style={{ fontStyle: 'italic', fontSize: 14, lineHeight: 1.1 }}>
              {t.label}
            </span>
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
  const fontSize = size === 'lg' ? 13 : 11
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        padding: size === 'lg' ? '3px 8px' : '2px 6px',
        border: `${dashed ? '1px dashed' : '0.5px solid'} ${c}`,
        background: c + '14',
        fontSize,
        opacity: dim ? 0.5 : 1,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: c,
          display: 'inline-block',
        }}
      />
      <span style={{ color: c, fontWeight: 700 }}>{note}</span>
      {qty != null && <span>{qty}</span>}
    </span>
  )
}
