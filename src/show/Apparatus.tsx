// Apparatus illustrations — ten engraver-style SVGs, one per station.
// Hatching softens with condition; cold stations gain visible cracks.
// Ported verbatim from production-stations.jsx · Apparatus.

import { obs, PAD } from './data'
import type { Condition } from './state'

export function Apparatus({
  kind,
  condition = 'warm',
}: {
  kind: string
  condition?: Condition
}) {
  const inkOp = condition === 'warm' ? 1 : condition === 'tepid' ? 0.7 : 0.45
  const stroke = obs.ink
  const hatchId = `hatch-${kind}-${condition}`
  return (
    <svg viewBox="0 0 120 64" className="station-apparatus-svg">
      <defs>
        <pattern
          id={hatchId}
          width="2.4"
          height="2.4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="2.4" stroke={stroke} strokeWidth="0.18" opacity={inkOp * 0.7} />
        </pattern>
      </defs>
      <g stroke={stroke} strokeWidth="0.7" fill="none" opacity={inkOp}>
        {kind === 'bellows' && (
          <>
            <path d="M 6 50 L 6 22 L 40 36 L 6 50 Z" fill={`url(#${hatchId})`} />
            <line x1="6" y1="22" x2="40" y2="36" />
            <line x1="6" y1="50" x2="40" y2="36" />
            <rect x="40" y="32" width="62" height="8" fill={`url(#${hatchId})`} />
            <circle cx="58" cy="36" r="4" fill={obs.paper} />
            <circle cx="78" cy="36" r="4" fill={obs.paper} />
            <circle cx="58" cy="36" r="1.5" fill={stroke} />
            <circle cx="78" cy="36" r="1.5" fill={stroke} />
            <path d="M 102 36 L 110 36 L 110 44" />
            <circle cx="110" cy="50" r="2.4" fill={obs.rust} stroke="none" opacity={inkOp} />
            <line x1="6" y1="22" x2="2" y2="14" strokeWidth="1.2" />
            <circle cx="2" cy="12" r="2.4" fill={stroke} />
          </>
        )}
        {kind === 'retort' && (
          <>
            <circle cx="34" cy="38" r="18" fill={`url(#${hatchId})`} />
            <path d="M 30 22 L 30 12 L 38 12 L 38 22" />
            <path d="M 52 38 Q 76 38 86 28 L 110 28" />
            <line x1="110" y1="28" x2="110" y2="38" />
            <circle cx="110" cy="44" r="2.4" fill={obs.gold} stroke="none" opacity={inkOp} />
            <path d="M 22 60 Q 30 50 38 60 Q 44 52 50 60" strokeWidth="0.7" />
            <path d="M 26 60 Q 30 56 34 60 Q 38 56 44 60" strokeOpacity="0.5" />
            <circle cx="28" cy="36" r="3" fill={PAD.C} stroke="none" opacity={inkOp * 0.9} />
            <circle cx="40" cy="42" r="3" fill={PAD.E} stroke="none" opacity={inkOp * 0.9} />
          </>
        )}
        {kind === 'vise' && (
          <>
            <path d="M 10 56 L 100 56 L 92 46 L 18 46 Z" fill={`url(#${hatchId})`} />
            <line x1="10" y1="56" x2="100" y2="56" strokeWidth="1.2" />
            <rect x="44" y="30" width="32" height="16" fill={obs.paper} />
            <rect x="44" y="30" width="32" height="16" />
            <line x1="40" y1="32" x2="40" y2="44" strokeWidth="1.4" />
            <line x1="80" y1="32" x2="80" y2="44" strokeWidth="1.4" />
            <circle cx="60" cy="38" r="4" fill={PAD.G} stroke="none" opacity={inkOp} />
            <path d="M 100 16 L 86 26 L 88 30 L 102 20 Z" fill={`url(#${hatchId})`} />
            <line x1="86" y1="26" x2="60" y2="38" strokeOpacity="0.35" strokeDasharray="2 2" />
            <line x1="62" y1="34" x2="68" y2="28" strokeOpacity={inkOp * 0.6} />
            <line x1="58" y1="32" x2="54" y2="26" strokeOpacity={inkOp * 0.6} />
          </>
        )}
        {kind === 'diapason' && (
          <>
            <rect x="20" y="50" width="80" height="8" fill={`url(#${hatchId})`} />
            <line x1="60" y1="50" x2="60" y2="36" />
            <path d="M 50 36 L 50 14 M 70 36 L 70 14" strokeWidth="1.4" />
            <path d="M 50 36 L 70 36" />
            <path d="M 46 14 Q 50 8 54 14 M 66 14 Q 70 8 74 14" strokeWidth="0.5" />
            <path d="M 36 14 Q 30 24 36 34" strokeOpacity={inkOp * 0.5} />
            <path d="M 30 10 Q 22 24 30 38" strokeOpacity={inkOp * 0.3} />
            <path d="M 84 14 Q 90 24 84 34" strokeOpacity={inkOp * 0.5} />
            <path d="M 90 10 Q 98 24 90 38" strokeOpacity={inkOp * 0.3} />
            <circle cx="60" cy="44" r="3" fill={PAD.E} stroke="none" opacity={inkOp} />
          </>
        )}
        {kind === 'aeolianharp' && (
          <>
            <line x1="14" y1="10" x2="14" y2="56" strokeWidth="1.2" />
            <line x1="106" y1="10" x2="106" y2="56" strokeWidth="1.2" />
            <line x1="14" y1="10" x2="106" y2="10" />
            <line x1="14" y1="56" x2="106" y2="56" strokeWidth="1.2" />
            {[22, 34, 46, 58, 70, 82, 94].map((x) => (
              <line key={x} x1={x} y1="12" x2={x} y2="54" strokeWidth="0.5" strokeOpacity={inkOp * 0.85} />
            ))}
            {[22, 46, 70, 94].map((x) => (
              <circle key={x} cx={x} cy="10" r="1.6" fill={stroke} />
            ))}
            <path d="M 0 22 Q 8 26 0 30" strokeOpacity={inkOp * 0.5} />
            <path d="M 108 38 Q 116 42 108 46" strokeOpacity={inkOp * 0.5} />
            <circle cx="58" cy="34" r="3" fill={PAD.A} stroke="none" opacity={inkOp} />
          </>
        )}
        {kind === 'cistern' && (
          <>
            <path d="M 14 22 L 106 22 L 100 58 L 20 58 Z" fill={`url(#${hatchId})`} />
            <line x1="14" y1="22" x2="106" y2="22" strokeWidth="1.2" />
            <path d="M 17 30 Q 30 26 60 30 Q 90 34 103 30" strokeOpacity={inkOp * 0.6} />
            <path d="M 19 36 Q 40 32 60 36 Q 80 40 101 36" strokeOpacity={inkOp * 0.4} />
            <path d="M 30 58 L 34 50 L 38 58 Z" fill={PAD.C} stroke="none" opacity={inkOp} />
            <path d="M 58 58 L 64 46 L 70 58 Z" fill={PAD.C} stroke="none" opacity={inkOp} />
            <path d="M 80 58 L 84 52 L 88 58 Z" fill={PAD.C} stroke="none" opacity={inkOp * 0.7} />
            <path d="M 100 50 L 110 50 L 110 56" />
            <circle cx="110" cy="60" r="1.6" fill={PAD.C} stroke="none" opacity={inkOp} />
          </>
        )}
        {kind === 'scriptorium' && (
          <>
            <path d="M 12 56 L 60 22 L 108 56 Z" fill={`url(#${hatchId})`} />
            <line x1="12" y1="56" x2="108" y2="56" strokeWidth="1.2" />
            <path d="M 36 50 L 56 30 L 90 30 L 84 50 Z" fill={obs.paper} />
            <path d="M 36 50 L 56 30 L 90 30 L 84 50 Z" />
            <line x1="44" y1="40" x2="82" y2="40" strokeWidth="0.4" strokeOpacity={inkOp * 0.7} />
            <line x1="42" y1="45" x2="82" y2="45" strokeWidth="0.4" strokeOpacity={inkOp * 0.5} />
            <path d="M 96 14 L 78 36" strokeWidth="1.2" />
            <path d="M 96 14 Q 100 8 102 12 Q 100 14 96 14" strokeWidth="0.5" />
            <circle cx="78" cy="37" r="1.8" fill={obs.ink2} stroke="none" opacity={inkOp} />
          </>
        )}
        {kind === 'camera' && (
          <>
            <rect x="24" y="22" width="60" height="36" fill={`url(#${hatchId})`} />
            <rect x="24" y="22" width="60" height="36" />
            <rect x="84" y="32" width="22" height="16" fill={obs.paper} />
            <rect x="84" y="32" width="22" height="16" />
            <line x1="94" y1="32" x2="94" y2="48" strokeOpacity={inkOp * 0.5} />
            <circle cx="106" cy="40" r="3" fill={obs.ink} />
            <circle cx="50" cy="40" r="10" fill={obs.paper} opacity={0.7} />
            <circle cx="50" cy="40" r="10" strokeWidth="0.4" strokeOpacity={inkOp * 0.6} />
            <circle cx="50" cy="40" r="3" fill={obs.rust} stroke="none" opacity={inkOp * 0.9} />
            <circle cx="56" cy="38" r="1.2" fill={obs.ink2} stroke="none" opacity={inkOp} />
            <circle cx="44" cy="42" r="1.2" fill={obs.ink2} stroke="none" opacity={inkOp} />
            <line x1="30" y1="58" x2="20" y2="64" />
            <line x1="54" y1="58" x2="54" y2="64" />
            <line x1="78" y1="58" x2="88" y2="64" />
          </>
        )}
        {kind === 'lectern' && (
          <>
            <path d="M 22 56 L 60 26 L 98 56 Z" fill={`url(#${hatchId})`} opacity="0.5" />
            <path d="M 22 44 L 60 26 L 60 50 L 22 56 Z" fill={obs.paper} />
            <path d="M 98 44 L 60 26 L 60 50 L 98 56 Z" fill={obs.paper} />
            <path d="M 22 44 L 60 26 L 60 50 L 22 56 Z" />
            <path d="M 98 44 L 60 26 L 60 50 L 98 56 Z" />
            <line x1="60" y1="26" x2="60" y2="50" />
            <line x1="32" y1="40" x2="54" y2="34" strokeWidth="0.3" strokeOpacity={inkOp * 0.6} />
            <line x1="32" y1="46" x2="54" y2="40" strokeWidth="0.3" strokeOpacity={inkOp * 0.5} />
            <line x1="66" y1="34" x2="88" y2="40" strokeWidth="0.3" strokeOpacity={inkOp * 0.6} />
            <line x1="66" y1="40" x2="88" y2="46" strokeWidth="0.3" strokeOpacity={inkOp * 0.5} />
            <line x1="104" y1="40" x2="104" y2="58" strokeWidth="1.4" />
            <path d="M 104 40 Q 102 36 104 32 Q 106 36 104 40" fill={obs.rust} stroke="none" opacity={inkOp * 0.8} />
          </>
        )}
        {kind === 'bell' && (
          <>
            <path d="M 40 14 Q 40 44 30 50 L 90 50 Q 80 44 80 14 Z" fill={`url(#${hatchId})`} />
            <line x1="60" y1="10" x2="60" y2="14" strokeWidth="1.2" />
            <circle cx="60" cy="8" r="2" fill={stroke} />
            <line x1="60" y1="20" x2="60" y2="42" strokeWidth="0.5" />
            <circle cx="60" cy="44" r="3" fill={PAD.B} stroke="none" opacity={inkOp} />
            <path d="M 28 30 Q 22 36 26 44" strokeOpacity={inkOp * 0.5} />
            <path d="M 92 30 Q 98 36 94 44" strokeOpacity={inkOp * 0.5} />
            <rect x="100" y="46" width="14" height="10" fill={obs.paper} />
            <text x="107" y="54" textAnchor="middle" fontSize="7" fontFamily="IM Fell English SC" fill={obs.ink3}>
              ✕
            </text>
          </>
        )}
      </g>
      {condition === 'cold' && (
        <g stroke={obs.ink3} strokeWidth="0.4" fill="none">
          <path d="M 14 28 L 22 38 L 18 46" />
          <path d="M 90 18 L 96 26" />
          <path d="M 72 50 L 78 56" />
        </g>
      )}
    </svg>
  )
}
