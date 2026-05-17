// Stage II — The Conductor's Wheel. Armillary with seven planets, a
// rust dashed beam between the open conjunction pair, and a list of
// upcoming windows. The shuttle panel is a static mockup for now;
// dragging a coin is not wired (the read-only sim doesn't move
// currencies between planets).

import type { CSSProperties } from 'react'
import { COIN_COLOR, PAD, obs } from './data'
import { formatBarTime, type ShowState } from './state'

export function WheelStage({ state }: { state: ShowState }) {
  const cx = 175
  const cy = 185
  const R = 130
  const planetAngles = state.planets.map((_, i, arr) => -Math.PI / 2 + (i * Math.PI * 2) / arr.length)

  const openIdx = state.conjunctions.findIndex((c) => c.open)
  const open = openIdx >= 0 ? state.conjunctions[openIdx] : null

  return (
    <div className="wheel-stage">
      <div className="wheel-header">
        <div className="sc wheel-header-row">
          <span>Tab. I — the wheel</span>
          {open && (
            <span className="mono wheel-header-open">
              ● conjunction open · {open.durationBars}s
            </span>
          )}
        </div>
      </div>

      <div className="wheel-body">
        <div className="wheel-armillary-frame">
          <svg viewBox="0 0 350 370" className="wheel-armillary-svg">
            <defs>
              <pattern
                id="hatchW"
                width="3"
                height="3"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="3" stroke={obs.ink} strokeWidth="0.2" opacity="0.4" />
              </pattern>
              <radialGradient id="sunW">
                <stop offset="0%" stopColor={obs.rustSoft} />
                <stop offset="80%" stopColor={obs.rust} />
                <stop offset="100%" stopColor={obs.ink} />
              </radialGradient>
            </defs>
            <rect width="350" height="370" fill="url(#hatchW)" opacity="0.35" />

            <circle cx={cx} cy={cy} r={R + 14} fill="none" stroke={obs.ink} strokeWidth="0.4" strokeDasharray="1 3" />
            <circle cx={cx} cy={cy} r={R} fill="none" stroke={obs.ink} strokeWidth="0.6" />
            <circle cx={cx} cy={cy} r={R - 30} fill="none" stroke={obs.ink} strokeWidth="0.3" strokeDasharray="1 3" opacity="0.6" />

            {Array.from({ length: 12 }).map((_, n) => {
              const a = (n / 12) * Math.PI * 2 - Math.PI / 2
              const r1 = R + 14
              const r2 = R + 22
              return (
                <line
                  key={n}
                  x1={cx + Math.cos(a) * r1}
                  y1={cy + Math.sin(a) * r1}
                  x2={cx + Math.cos(a) * r2}
                  y2={cy + Math.sin(a) * r2}
                  stroke={obs.ink}
                  strokeWidth={n % 3 === 0 ? 0.8 : 0.4}
                />
              )
            })}

            <circle cx={cx} cy={cy} r="18" fill="url(#sunW)" />
            {Array.from({ length: 16 }).map((_, k) => {
              const a = (k / 16) * Math.PI * 2
              return (
                <line
                  key={k}
                  x1={cx + Math.cos(a) * 20}
                  y1={cy + Math.sin(a) * 20}
                  x2={cx + Math.cos(a) * (k % 2 ? 26 : 32)}
                  y2={cy + Math.sin(a) * (k % 2 ? 26 : 32)}
                  stroke={obs.rust}
                  strokeWidth="0.5"
                />
              )
            })}

            {open &&
              (() => {
                const aIdx = state.planets.findIndex((p) => p.id === open.pair[0])
                const bIdx = state.planets.findIndex((p) => p.id === open.pair[1])
                if (aIdx < 0 || bIdx < 0) return null
                const a = planetAngles[aIdx]
                const b = planetAngles[bIdx]
                return (
                  <line
                    x1={cx + Math.cos(a) * R}
                    y1={cy + Math.sin(a) * R}
                    x2={cx + Math.cos(b) * R}
                    y2={cy + Math.sin(b) * R}
                    stroke={obs.rust}
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  >
                    <animate
                      attributeName="opacity"
                      values="1;0.5;1"
                      dur="1s"
                      repeatCount="indefinite"
                    />
                  </line>
                )
              })()}

            {state.planets.map((p, i) => {
              const angle = planetAngles[i]
              const px = cx + Math.cos(angle) * R
              const py = cy + Math.sin(angle) * R
              const isActive = !!open && open.pair.includes(p.id)
              const r = isActive ? 11 : Math.max(5, 7 * (p.stock / p.stockMax + 0.4))
              const c = COIN_COLOR[p.id] ?? obs.ink
              return (
                <g key={p.id}>
                  {isActive && (
                    <>
                      <circle cx={px} cy={py} r={r + 7} fill={obs.rust} opacity="0.1" />
                      <circle
                        cx={px}
                        cy={py}
                        r={r + 4}
                        fill="none"
                        stroke={obs.rust}
                        strokeWidth="0.5"
                        strokeDasharray="1 2"
                      />
                    </>
                  )}
                  <circle cx={px} cy={py} r={r} fill={c} stroke={obs.ink} strokeWidth="0.5" />
                  <circle
                    cx={px - r / 3}
                    cy={py - r / 3}
                    r={r / 3.5}
                    fill={obs.paper}
                    opacity="0.4"
                  />
                  <text
                    x={px}
                    y={py + r + 11}
                    textAnchor="middle"
                    fontFamily="JetBrains Mono"
                    fontSize="9"
                    fill={obs.ink}
                  >
                    {Math.round(p.stock)}/{p.stockMax}
                  </text>
                  <text
                    x={px + Math.cos(angle) * 22}
                    y={py + Math.sin(angle) * 22 + 3}
                    textAnchor="middle"
                    fontFamily="IM Fell English"
                    fontStyle="italic"
                    fontSize="14"
                    fill={isActive ? obs.rust : obs.ink}
                  >
                    {p.id}
                  </text>
                </g>
              )
            })}

            <g transform="translate(14 14)">
              <rect width="116" height="18" fill={obs.paper} stroke={obs.ink} strokeWidth="0.4" />
              <text
                x="58"
                y="12"
                textAnchor="middle"
                fontFamily="IM Fell English SC"
                fontSize="9"
                fill={obs.ink}
              >
                fig. I · {open ? `${open.pair[0]} ⋈ ${open.pair[1]} · ${open.ratio}` : 'quiet — no conjunction'}
              </text>
            </g>
          </svg>
        </div>

        {open && (
          <div className="wheel-shuttle">
            <div className="sc wheel-shuttle-header">Shuttle · drag the coin</div>
            <div className="wheel-shuttle-grid">
              <div className="wheel-shuttle-cell">
                <div
                  className="display wheel-shuttle-note"
                  style={{ '--note-color': PAD[open.pair[0]] } as CSSProperties}
                >
                  {open.pair[0]}
                </div>
                <div className="mono wheel-shuttle-amount">−3 coins</div>
              </div>
              <span className="display wheel-shuttle-arrow">↦</span>
              <div className="wheel-shuttle-cell">
                <div
                  className="display wheel-shuttle-note"
                  style={{ '--note-color': PAD[open.pair[1]] } as CSSProperties}
                >
                  {open.pair[1]}
                </div>
                <div className="mono wheel-shuttle-amount">+2 coins</div>
              </div>
            </div>
            <div className="mono wheel-shuttle-footer">
              <span>fee · 1 coin (just intonation pays better)</span>
              <span className="display wheel-shuttle-execute">execute</span>
            </div>
          </div>
        )}

        <div className="wheel-windows-section">
          <div className="sc wheel-windows-label">Coming windows</div>
          <div className="wheel-windows-row">
            {state.conjunctions.map((c) => (
              <div
                key={`${c.pair[0]}-${c.pair[1]}`}
                className="wheel-window-card"
                data-open={c.open || undefined}
              >
                <div className="mono wheel-window-pair">
                  {c.pair[0]}·{c.pair[1]}
                </div>
                <div className="mono wheel-window-meta">
                  {c.ratio} · {c.open ? `open ${c.durationBars}s` : formatBarTime(c.inBars)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
