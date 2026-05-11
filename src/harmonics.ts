// Harmonic-series math shared by the harvest stage and (eventually) the
// orbital stage's launch-cost / chord-harvest formulas. Music theory IS
// orbital mechanics — same coincidence formula prices both.

export type HarmonicAmpModel = (n: number) => number

// Default partial-amplitude model: a_n = 1/n. Stylized — louder than a real
// plucked string at high partials, but with no zeros (every partial is
// reachable) and a gentler dropoff that gives gameplay a usable gradient
// across intervals: with H1..H4 visible, octave / fifth / fourth coincide;
// thirds need H≥5; M2 / M7 need H≥8 / H≥15.
export const defaultAmp: HarmonicAmpModel = (n) => (n < 1 ? 0 : 1 / n)

// Real plucked-string envelope:
//   a_n = |sin(n·π·x/L)| / n²
// The comb filter from pluck position is acoustically faithful but creates
// hard zeros (e.g. x=L/4 silences H4) — held in reserve as an upgrade later.
export function pluckedAmp(n: number, pluckRatio = 0.3): number {
  if (n < 1) return 0
  const env = Math.abs(Math.sin(n * Math.PI * pluckRatio))
  return env / (n * n)
}

export type Harmonic = {
  // Pad/note id of the tap that emitted this partial. Same-note re-plucks
  // replace rather than stack (physically: a second pluck damps the first),
  // so the cloud is partitioned by noteId.
  noteId: string
  // 1-indexed partial number in the source's own series.
  partial: number
  // Absolute frequency in Hz.
  freq: number
  // Current amplitude (decays each frame).
  amp: number
  // Birth amp — kept so we can render normalized opacity as it fades.
  bornAmp: number
  // performance.now() at emission, ms.
  bornAt: number
}

// Build the harmonic series for a tap of `fundamentalHz`, using `model` to
// weight partials. `count` partials starting from H1 (the fundamental).
export function harmonicSeries(
  fundamentalHz: number,
  count: number,
  model: HarmonicAmpModel = defaultAmp,
): Array<{ partial: number; freq: number; amp: number }> {
  const out: Array<{ partial: number; freq: number; amp: number }> = []
  for (let n = 1; n <= count; n++) {
    out.push({ partial: n, freq: fundamentalHz * n, amp: model(n) })
  }
  return out
}

// Two frequencies are "coincident" if they're within `tolFrac` of each other
// in log space (cents-ish). 0.005 = 0.5% ≈ 8.6 cents.
export function isCoincident(f1: number, f2: number, tolFrac = 0.005): boolean {
  if (f1 <= 0 || f2 <= 0) return false
  return Math.abs(f1 - f2) / Math.min(f1, f2) <= tolFrac
}

// Scan the live cloud for partials that coincide with any partial of the
// incoming tap, sum the bilinear bonus weighted by the cloud entry's
// remaining amplitude. Returns the total Resonance to award and the list of
// coincident pairs (for visual/audio feedback).
export type Coincidence = {
  cloudNoteId: string
  cloudPartial: number
  incomingPartial: number
  freq: number
  bonus: number
}

export function scanCoincidences(
  cloud: Harmonic[],
  incoming: Array<{ partial: number; freq: number; amp: number }>,
  opts?: { tolFrac?: number; gain?: number },
): { total: number; hits: Coincidence[] } {
  const tol = opts?.tolFrac ?? 0.005
  const gain = opts?.gain ?? 1
  const hits: Coincidence[] = []
  let total = 0
  for (const ch of cloud) {
    for (const ih of incoming) {
      if (!isCoincident(ch.freq, ih.freq, tol)) continue
      // bilinear: each side contributes its current amplitude (decayed for
      // the cloud entry, born-amp for the incoming tap).
      const bonus = ch.amp * ih.amp * gain
      if (bonus <= 0) continue
      total += bonus
      hits.push({
        cloudNoteId: ch.noteId,
        cloudPartial: ch.partial,
        incomingPartial: ih.partial,
        freq: (ch.freq + ih.freq) / 2,
        bonus,
      })
    }
  }
  return { total, hits }
}

// Per-pair idle Resonance rate. The auto-pluck loop staggers slots by half a
// cadence so when slot B fires, slot A's cloud is half-decayed and vice-versa
// — we model that by scanning B's incoming series against A's series at half
// amplitude (`cloudAmpFrac = 0.5`). Each slot fires once per cadence, so the
// scan total counts twice per cadence period (once per direction). Pure
// function so on-tab auto-pluck income and off-tab analytic accrual stay in
// sync.
export function idlePairResonancePerSec(
  seriesA: Array<{ partial: number; freq: number; amp: number }>,
  seriesB: Array<{ partial: number; freq: number; amp: number }>,
  opts: { cadenceS: number; gain: number; tolFrac?: number; cloudAmpFrac?: number },
): number {
  const cloudAmpFrac = opts.cloudAmpFrac ?? 0.5
  const tol = opts.tolFrac ?? 0.005
  const aAsCloud: Harmonic[] = seriesA.map((h) => ({
    noteId: '_a',
    partial: h.partial,
    freq: h.freq,
    amp: h.amp * cloudAmpFrac,
    bornAmp: h.amp,
    bornAt: 0,
  }))
  const { total } = scanCoincidences(aAsCloud, seriesB, { tolFrac: tol, gain: opts.gain })
  // total = bonus from one cross-pluck. Both directions fire each cadence.
  return (2 * total) / opts.cadenceS
}
