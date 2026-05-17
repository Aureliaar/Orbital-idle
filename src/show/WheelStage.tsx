// Stage II — The Conductor's Wheel. Armillary with seven planets, a
// rust dashed beam between the open conjunction pair, and a list of
// upcoming windows. The shuttle panel is a static mockup for now;
// dragging a coin is not wired (the read-only sim doesn't move
// currencies between planets).

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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '10px 14px 4px', position: 'relative', zIndex: 2 }}>
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
          <span>Tab. I — the wheel</span>
          {open && (
            <span className="mono" style={{ color: obs.rust }}>
              ● conjunction open · {open.durationBars}s
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: '0 14px',
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          gap: 8,
        }}
      >
        <div
          style={{
            position: 'relative',
            background: obs.paper,
            border: `0.5px solid ${obs.ink}`,
            aspectRatio: '1 / 1',
            maxWidth: 360,
            alignSelf: 'center',
            width: '100%',
          }}
        >
          <svg viewBox="0 0 350 370" style={{ width: '100%', height: '100%' }}>
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
          <div
            style={{
              padding: '10px 12px',
              border: `0.5px solid ${obs.rust}`,
              background: obs.rust + '0e',
            }}
          >
            <div className="sc" style={{ fontSize: 9, color: obs.rust, letterSpacing: '0.22em' }}>
              Shuttle · drag the coin
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                gap: 8,
                marginTop: 6,
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  textAlign: 'center',
                  padding: '6px 4px',
                  border: `0.5px solid ${obs.ink}`,
                  background: obs.bg,
                }}
              >
                <div
                  className="display"
                  style={{ fontSize: 22, fontStyle: 'italic', color: PAD[open.pair[0]] }}
                >
                  {open.pair[0]}
                </div>
                <div className="mono" style={{ fontSize: 9, color: obs.ink2 }}>
                  −3 coins
                </div>
              </div>
              <span
                className="display"
                style={{ fontSize: 24, fontStyle: 'italic', color: obs.rust, textAlign: 'center' }}
              >
                ↦
              </span>
              <div
                style={{
                  textAlign: 'center',
                  padding: '6px 4px',
                  border: `0.5px solid ${obs.ink}`,
                  background: obs.bg,
                }}
              >
                <div
                  className="display"
                  style={{ fontSize: 22, fontStyle: 'italic', color: PAD[open.pair[1]] }}
                >
                  {open.pair[1]}
                </div>
                <div className="mono" style={{ fontSize: 9, color: obs.ink2 }}>
                  +2 coins
                </div>
              </div>
            </div>
            <div
              className="mono"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 6,
                fontSize: 9,
                color: obs.ink3,
              }}
            >
              <span>fee · 1 coin (just intonation pays better)</span>
              <span
                className="display"
                style={{
                  fontStyle: 'italic',
                  color: obs.bg,
                  background: obs.ink,
                  padding: '3px 10px',
                }}
              >
                execute
              </span>
            </div>
          </div>
        )}

        <div style={{ paddingBottom: 14 }}>
          <div className="sc" style={{ fontSize: 9, color: obs.ink2, letterSpacing: '0.22em' }}>
            Coming windows
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, overflow: 'hidden' }}>
            {state.conjunctions.map((c) => (
              <div
                key={`${c.pair[0]}-${c.pair[1]}`}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  border: `0.5px solid ${c.open ? obs.rust : obs.ink + '77'}`,
                  background: c.open ? obs.rust + '14' : obs.bg,
                }}
              >
                <div
                  className="mono"
                  style={{ fontSize: 10, color: obs.ink, fontWeight: 600 }}
                >
                  {c.pair[0]}·{c.pair[1]}
                </div>
                <div className="mono" style={{ fontSize: 9, color: obs.ink3 }}>
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
