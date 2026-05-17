// Stage III — Research. Writ-roll counter, active inquiry, the tech
// tree, and the two research stations underneath. Ported from
// production-research.jsx · ResearchScreen.

import {
  BRANCH_COLOR,
  obs,
  RESEARCH_EDGES,
  RESEARCH_NODES,
  STATIONS,
  STATION_RECIPES,
  type ResearchNode,
} from './data'
import { StationCard } from './Station'
import type { ShowState } from './state'

const RESEARCH_STATION_IDS = ['scriptorium', 'camera'] as const

function ResearchNodeMark({
  node,
  x,
  y,
  w = 84,
  h = 36,
  activeProgress,
}: {
  node: ResearchNode
  x: number
  y: number
  w?: number
  h?: number
  activeProgress: number
}) {
  const c = BRANCH_COLOR[node.branch] ?? obs.ink
  const isActive = node.status === 'active'
  const isLocked = node.status === 'locked'
  const isReady = node.status === 'ready'
  const progress = isActive ? activeProgress : node.progress ?? 0
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`}>
      <rect
        width={w}
        height={h}
        fill={
          isLocked
            ? obs.bg2
            : isActive
              ? c + '20'
              : isReady
                ? obs.paper
                : obs.bg
        }
        stroke={isActive ? c : obs.ink}
        strokeWidth={isActive ? 1.2 : 0.5}
        strokeDasharray={isLocked ? '2 2' : 'none'}
      />
      <circle cx="6" cy="6" r="2" fill={c} opacity={isLocked ? 0.35 : 0.9} />
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        fontFamily="IM Fell English"
        fontStyle="italic"
        fontSize="10"
        fill={isLocked ? obs.ink3 : obs.ink}
      >
        {node.title}
      </text>
      <text
        x={w / 2}
        y={h - 4}
        textAnchor="middle"
        fontFamily="JetBrains Mono"
        fontSize="7.5"
        fill={isLocked ? obs.ink3 : isActive ? c : obs.ink2}
      >
        {node.status === 'done'
          ? '✓ writ'
          : isActive
            ? `${Math.round(progress * 100)}% • ✎${node.cost}`
            : `✎ ${node.cost}`}
      </text>
      {isActive && <rect x="0" y={h - 1.5} width={w * progress} height="1.5" fill={c} />}
      {isReady && (
        <g transform={`translate(${w - 10} -5) rotate(-6)`}>
          <rect width="14" height="9" fill={obs.rust} />
          <text
            x="7"
            y="6.5"
            textAnchor="middle"
            fontFamily="IM Fell English SC"
            fontSize="6"
            fill={obs.bg}
            letterSpacing="0.5"
          >
            RDY
          </text>
        </g>
      )}
    </g>
  )
}

function ResearchTree({ activeProgress }: { activeProgress: number }) {
  const W = 358
  const H = 380
  const colsX = [60, 179, 298]
  const tierY = [40, 110, 180, 250, 320]
  const pos = (n: ResearchNode) => ({ x: colsX[n.col], y: tierY[n.tier] })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <defs>
        <pattern
          id="hatchRsch"
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="3" stroke={obs.ink} strokeWidth="0.15" opacity="0.45" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#hatchRsch)" opacity="0.3" />

      {RESEARCH_EDGES.map(([a, b], i) => {
        const na = RESEARCH_NODES.find((n) => n.id === a)
        const nb = RESEARCH_NODES.find((n) => n.id === b)
        if (!na || !nb) return null
        const pa = pos(na)
        const pb = pos(nb)
        const reachable = na.status === 'done'
        return (
          <path
            key={i}
            d={`M ${pa.x} ${pa.y + 18} C ${pa.x} ${(pa.y + pb.y) / 2} ${pb.x} ${(pa.y + pb.y) / 2} ${pb.x} ${pb.y - 18}`}
            fill="none"
            stroke={reachable ? BRANCH_COLOR[nb.branch] : obs.ink}
            strokeWidth={reachable ? 0.7 : 0.4}
            strokeOpacity={reachable ? 0.85 : 0.4}
            strokeDasharray={reachable ? 'none' : '2 3'}
          />
        )
      })}

      {RESEARCH_NODES.map((n) => {
        const p = pos(n)
        return <ResearchNodeMark key={n.id} node={n} x={p.x} y={p.y} activeProgress={activeProgress} />
      })}

      {tierY.map((y, i) => (
        <text
          key={i}
          x="6"
          y={y + 3}
          fontFamily="IM Fell English SC"
          fontSize="7.5"
          fill={obs.ink3}
        >
          {['I', 'II', 'III', 'IV', 'V'][i]}
        </text>
      ))}

      <g transform={`translate(${W - 96} ${H - 14})`}>
        {[
          ['pit', BRANCH_COLOR.pit],
          ['wheel', BRANCH_COLOR.wheel],
          ['core', BRANCH_COLOR.core],
        ].map(([label, color], i) => (
          <g key={label} transform={`translate(${i * 32} 0)`}>
            <circle cx="3" cy="0" r="2.2" fill={color} />
            <text
              x="9"
              y="3"
              fontFamily="IM Fell English SC"
              fontSize="7"
              fill={obs.ink2}
              letterSpacing="0.5"
            >
              {label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

export function ResearchStage({ state }: { state: ShowState }) {
  const active = RESEARCH_NODES.find((n) => n.status === 'active')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div
        style={{
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `0.5px dotted ${obs.ink}55`,
          background: obs.bg2 + '22',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <span className="sc" style={{ fontSize: 9, color: obs.ink2, letterSpacing: '0.22em' }}>
          writ-roll
        </span>
        <span
          className="display"
          style={{
            fontStyle: 'italic',
            fontSize: 22,
            color: obs.ink2,
            lineHeight: 1,
            marginLeft: 2,
          }}
        >
          ✎ <span style={{ color: obs.ink }}>{state.writs}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 9, color: obs.ink3 }}>
          +0.18 ✎ / bar
        </span>
      </div>

      {active && (
        <div style={{ padding: '10px 14px 6px', position: 'relative', zIndex: 2 }}>
          <div className="sc" style={{ fontSize: 9, color: obs.rust, letterSpacing: '0.22em' }}>
            Active inquiry
          </div>
          <div
            style={{
              marginTop: 4,
              padding: '10px 12px',
              border: `0.5px solid ${obs.rust}`,
              background: obs.rust + '0e',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span
                className="sc"
                style={{
                  fontSize: 8,
                  padding: '1px 5px',
                  background: obs.rust,
                  color: obs.bg,
                  letterSpacing: '0.2em',
                }}
              >
                tier {['I', 'II', 'III', 'IV', 'V'][active.tier]} · {active.branch}
              </span>
              <h3
                className="display"
                style={{ fontSize: 19, fontStyle: 'italic', lineHeight: 1, margin: 0, fontWeight: 400 }}
              >
                {active.title}
              </h3>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11, color: obs.rust }}>
                {Math.round(state.activeInquiryProgress * 100)}%
              </span>
            </div>
            <div
              className="display"
              style={{
                fontStyle: 'italic',
                fontSize: 12,
                color: obs.ink2,
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {active.body}
            </div>
            <div
              style={{
                position: 'relative',
                height: 5,
                marginTop: 8,
                border: `0.5px solid ${obs.ink}`,
                background: obs.paper,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${state.activeInquiryProgress * 100}%`,
                  background: obs.rust,
                }}
              />
            </div>
            <div
              className="mono"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 9,
                color: obs.ink3,
                marginTop: 3,
              }}
            >
              <span>
                ✎ {Math.round(state.activeInquiryProgress * active.cost)} / {active.cost} inscribed
              </span>
              <span>
                ETA ≈ {Math.round((1 - state.activeInquiryProgress) * active.cost * 2)} bars
              </span>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '6px 14px', position: 'relative', zIndex: 2 }}>
        <div
          className="sc"
          style={{
            fontSize: 9,
            color: obs.ink2,
            letterSpacing: '0.22em',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Tab. I — the tree</span>
          <span className="mono" style={{ color: obs.ink3 }}>tap a node to queue</span>
        </div>
        <div
          style={{ marginTop: 4, background: obs.paper, border: `0.5px solid ${obs.ink}` }}
        >
          <ResearchTree activeProgress={state.activeInquiryProgress} />
        </div>
      </div>

      <div
        style={{
          padding: '8px 18px 14px 16px',
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div className="sc" style={{ fontSize: 9, color: obs.ink2, letterSpacing: '0.22em' }}>
          Apparatus inscribing now
        </div>
        {RESEARCH_STATION_IDS.map((id, i) => {
          const def = STATIONS[id]
          const lib = STATION_RECIPES[id]
          if (!def || !lib) return null
          const fakeState = {
            id,
            slots: [
              { state: 'active' as const, recipeId: lib[0].id },
              ...(id === 'camera' ? [{ state: 'empty' as const }] : []),
            ],
            capacity: id === 'camera' ? 2 : 1,
            heat: id === 'scriptorium' ? 0.82 : 0.39,
            cycle: id === 'scriptorium' ? 0.42 : 0.71,
            auto: id === 'camera',
            alarm: false,
          }
          return <StationCard key={id} idx={i + 1} state={fakeState} />
        })}
      </div>
    </div>
  )
}
