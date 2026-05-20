import { useMemo } from 'react'

// Observatory page chrome — paper texture overlay, foxing spots, vignette,
// 1px+0.5px double-rule frame, and four baroque corner ornaments.
// Ported from direction-a.jsx (Fleuron / CornerOrnament / FrameBorder /
// Foxing / PageChrome). All layers are absolutely positioned + pointer-
// events: none, so the entire chrome sits on top of <main> without
// affecting layout or interaction.

const INK = '#1a120a'

type Corner = 'tl' | 'tr' | 'bl' | 'br'

function CornerOrnament({ corner, size = 60, color = INK }: { corner: Corner; size?: number; color?: string }) {
  const transforms: Record<Corner, string> = {
    tl: 'scale(1,1)',
    tr: 'scale(-1,1)',
    bl: 'scale(1,-1)',
    br: 'scale(-1,-1)',
  }
  const positions: Record<Corner, { left?: number; right?: number; top?: number; bottom?: number }> = {
    tl: { left: 6, top: 6 },
    tr: { right: 6, top: 6 },
    bl: { left: 6, bottom: 6 },
    br: { right: 6, bottom: 6 },
  }
  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        transform: transforms[corner],
        ...positions[corner],
      }}
    >
      <svg viewBox="0 0 60 60" width="100%" height="100%">
        <g fill="none" stroke={color} strokeWidth="0.7" strokeLinecap="round">
          <path d="M 4 28 L 4 4 L 28 4" />
          <path d="M 4 16 L 16 4" strokeWidth="0.4" />
          <path d="M 4 4 Q 14 14 4 28 M 4 4 Q 14 14 28 4" strokeWidth="0.4" opacity="0.7" />
          <path d="M 8 8 Q 22 6 26 18 Q 26 26 18 26 Q 12 26 12 20 Q 12 16 16 16 Q 19 16 19 19" />
          <circle cx="19" cy="19" r="1.6" fill={color} />
          <path d="M 30 6 Q 38 8 36 16 Q 32 18 30 14 Q 28 10 30 6 Z" fill={color} fillOpacity="0.9" stroke="none" />
          <path d="M 6 30 Q 8 38 16 36 Q 18 32 14 30 Q 10 28 6 30 Z" fill={color} fillOpacity="0.9" stroke="none" />
          <circle cx="34" cy="22" r="0.9" fill={color} />
          <circle cx="22" cy="34" r="0.9" fill={color} />
        </g>
      </svg>
    </div>
  )
}

function FrameBorder({ inset = 10, color = INK }: { inset?: number; color?: string }) {
  return (
    <div style={{ position: 'absolute', inset, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, border: `1px solid ${color}` }} />
      <div style={{ position: 'absolute', inset: 4, border: `0.5px solid ${color}`, opacity: 0.6 }} />
    </div>
  )
}

function Foxing() {
  const spots = useMemo(() => {
    const seed = { v: 9 }
    const r = () => {
      seed.v = (seed.v * 9301 + 49297) % 233280
      return seed.v / 233280
    }
    return Array.from({ length: 22 }, () => {
      const base = r() * 8 + 3
      const skew = (r() - 0.5) * 0.5
      return {
        x: r() * 100,
        y: r() * 100,
        w: base * (1 + skew),
        h: base * (1 - skew),
        rot: r() * 360,
        op: r() * 0.45 + 0.12,
      }
    })
  }, [])
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity: 0.4,
        mixBlendMode: 'multiply',
      }}
    >
      {spots.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.w}px`,
            height: `${s.h}px`,
            borderRadius: '50%',
            background: '#5a3818',
            opacity: s.op,
            transform: `translate(-50%, -50%) rotate(${s.rot}deg)`,
          }}
        />
      ))}
    </div>
  )
}

export function PageChrome() {
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.5,
          mixBlendMode: 'multiply',
          backgroundImage: 'var(--paper-tex)',
        }}
      />
      <Foxing />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.16) 78%, rgba(0,0,0,0.38) 100%)',
        }}
      />
      <FrameBorder />
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <CornerOrnament corner="tl" />
        <CornerOrnament corner="tr" />
        <CornerOrnament corner="bl" />
        <CornerOrnament corner="br" />
      </div>
    </>
  )
}

// Static engraving behind the orbit canvas: 12-tick chromatic ring,
// diatonic letter labels (C..B), engraved sun rays at the center, plus
// a "fig. I" cartouche in the top-left of the plate. Sized to match the
// .orbit canvas; the canvas overdraws the animated layer on top.
const DIATONIC = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

export function OrbitEngraving() {
  const cx = 250
  const cy = 250
  const rMax = 220
  return (
    <svg
      viewBox="0 0 500 500"
      className="orbit-engraving"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <pattern id="orb-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke={INK} strokeWidth="0.2" opacity="0.4" />
        </pattern>
        <radialGradient id="orb-sun">
          <stop offset="0%" stopColor="#b54a25" />
          <stop offset="80%" stopColor="#8c2a12" />
          <stop offset="100%" stopColor={INK} />
        </radialGradient>
      </defs>
      <rect width="500" height="500" fill="url(#orb-hatch)" opacity="0.35" />

      {[
        [18, 18, 'NW'],
        [482, 18, 'NE'],
        [18, 482, 'SW'],
        [482, 482, 'SE'],
      ].map(([x, y, l]) => (
        <g key={String(l)} stroke={INK} strokeWidth="0.5" fill="none">
          <circle cx={x as number} cy={y as number} r="9" />
          <line x1={(x as number) - 12} y1={y as number} x2={(x as number) + 12} y2={y as number} />
          <line x1={x as number} y1={(y as number) - 12} x2={x as number} y2={(y as number) + 12} />
          <text x={x as number} y={(y as number) + 3} textAnchor="middle" fontFamily="IM Fell English SC" fontSize="6.5" fill={INK}>
            {l}
          </text>
        </g>
      ))}

      {Array.from({ length: 12 }).map((_, n) => {
        const a = (n / 12) * Math.PI * 2 - Math.PI / 2
        const r1 = rMax + 16
        const r2 = rMax + 24
        return (
          <line
            key={n}
            x1={cx + Math.cos(a) * r1}
            y1={cy + Math.sin(a) * r1}
            x2={cx + Math.cos(a) * r2}
            y2={cy + Math.sin(a) * r2}
            stroke={INK}
            strokeWidth={n % 3 === 0 ? 0.8 : 0.4}
          />
        )
      })}

      {DIATONIC.map((note, i) => {
        const a = (i / DIATONIC.length) * Math.PI * 2 - Math.PI / 2
        const rr = rMax + 32
        return (
          <text
            key={note}
            x={cx + Math.cos(a) * rr}
            y={cy + Math.sin(a) * rr + 3}
            textAnchor="middle"
            fontFamily="IM Fell English SC"
            fontSize="11"
            fill="#6b5536"
          >
            {note}
          </text>
        )
      })}

      <circle cx={cx} cy={cy} r="14" fill="url(#orb-sun)" />
      {Array.from({ length: 16 }).map((_, k) => {
        const a = (k / 16) * Math.PI * 2
        return (
          <line
            key={k}
            x1={cx + Math.cos(a) * 16}
            y1={cy + Math.sin(a) * 16}
            x2={cx + Math.cos(a) * (k % 2 ? 24 : 30)}
            y2={cy + Math.sin(a) * (k % 2 ? 24 : 30)}
            stroke="#8c2a12"
            strokeWidth="0.5"
          />
        )
      })}

      <g transform="translate(22 22)">
        <rect width="116" height="20" fill="#d6c293" stroke={INK} strokeWidth="0.4" />
        <text x="58" y="14" textAnchor="middle" fontFamily="IM Fell English SC" fontSize="10" fill={INK}>
          fig. I · diatonic wheel
        </text>
      </g>
    </svg>
  )
}
