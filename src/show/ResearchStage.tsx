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
    <svg viewBox={`0 0 ${W} ${H}`} className="research-tree-svg">
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
    <div className="research-stage">
      <div className="research-writ-strip">
        <span className="sc research-writ-label">writ-roll</span>
        <span className="display research-writ-amount">
          ✎ <span className="research-writ-amount-value">{state.writs}</span>
        </span>
        <span className="research-writ-spacer" />
        <span className="mono research-writ-rate">+0.18 ✎ / bar</span>
      </div>

      {active && (
        <div className="research-active-section">
          <div className="sc research-active-header">Active inquiry</div>
          <div className="research-active-card">
            <div className="research-active-row">
              <span className="sc research-active-tier-badge">
                tier {['I', 'II', 'III', 'IV', 'V'][active.tier]} · {active.branch}
              </span>
              <h3 className="display research-active-title">{active.title}</h3>
              <span className="research-active-spacer" />
              <span className="mono research-active-pct">
                {Math.round(state.activeInquiryProgress * 100)}%
              </span>
            </div>
            <div className="display research-active-body">{active.body}</div>
            <div className="research-active-track">
              <span
                className="research-active-fill"
                style={{ width: `${state.activeInquiryProgress * 100}%` }}
              />
            </div>
            <div className="mono research-active-footer">
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

      <div className="research-tree-section">
        <div className="sc research-tree-row">
          <span>Tab. I — the tree</span>
          <span className="mono research-tree-hint">tap a node to queue</span>
        </div>
        <div className="research-tree-frame">
          <ResearchTree activeProgress={state.activeInquiryProgress} />
        </div>
      </div>

      <div className="research-stations-section">
        <div className="sc research-stations-label">Apparatus inscribing now</div>
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
