# Orbital — Design

An idle game where music theory is played, not taught. You pluck notes,
watch their harmonic series unfold on a pitch helix, and harvest the
moments where partials from different notes land on the same frequency.
Those coincidences — the physical basis of consonance — are your currency.

## Core premise

Consonance isn't flavor. It's the mechanic. Two notes whose harmonic
series share a partial at the same frequency are "in resonance." That
shared partial is a coin you can pick up. A perfect fifth (3:2) shares
partials early and often — cheap, abundant currency. A major seventh
(15:8) shares them only at high harmonics — rare, gated currency. The
entire unlock tree, economy, and progression fall out of this one idea:
**intervals that sound good together literally produce more.**

## The two stages

### Orbits (Cap. I)

Seven bodies orbit a stylized sun at just-intonation period ratios
(C = 1:1, D = 9:8, E = 5:4, F = 4:3, G = 3:2, A = 5:3, B = 15:8).
The canvas animates their motion in real time; each body strikes a note
when it completes an orbit, with velocity proportional to its proximity
to Earth (alignment = louder). Three timbres (pluck, piano, synth) color
the drone. The orbital view is ambient and navigational — tap a planet to
enter its resonator.

### Resonator (Cap. II)

The core idle loop. Each planet has its own isolated resonator with:

- **Slots** (1–3). Assign a note to a slot. Tap the slot (or press
  A / S / D) to pluck it — its first 6 partials appear on the pitch
  helix and decay over 1.5 s.
- **Coincidence harvesting.** When a new pluck's partials overlap an
  existing partial from a different note (within 0.5% tolerance), the
  coincidence mints one unit of the FreqCurrency for that frequency.
  Visual burst + particle shower to the matching currency chip.
- **Note currency.** Each pluck also mints its own note's currency
  (C, D, E, F, G, A, B), scaled by a per-note yield multiplier.
- **Chord stacking.** Slot 1's capacity upgrades from 1 → 2 → 3.
  A stacked slot fires all its notes in sequence on a single tap — the
  later notes scan against the earlier ones' still-ringing cloud, so a
  chord pays its coincidence bonus every tap at full amplitude.
- **Auto-pluck.** Once 3 notes are unlocked, buy auto-pluck per slot.
  Fires at half yield on the ring-duration cadence, staggered so clouds
  overlap at peak coincidence.

## Currencies

Two layers, both derived from the harmonic series:

| Type | Example | Minted by |
|------|---------|-----------|
| Note | C, D, E, … | Tapping a slot with that note loaded |
| Freq | F3, F4, F5, F15/4, … | Two notes' partials coinciding at that frequency ratio × tonic |

Nine freq currencies exist in the diatonic at H≤6, each a specific
rational multiple of the tonic (3×, 4×, 5×, 15/4×, 9/2×, 45/8×, 6×,
20/3×, 15/2×). Their sources are the note pairs whose series reach that
frequency — e.g. F5 (5×tonic) is minted by C×E, C×A, and E×A.

## Progression

All costs are expressed in **scale-degree patterns** relative to the
planet's tonic, then resolved into its local note and freq currencies.
This means every planet runs the same progression shape in a different
mode (C Ionian, D Dorian, E Phrygian, …), and some modes have fewer
freq gates because their interval pairs lack coincidences at H≤6.

### Unlock ladder

Notes unlock in a fixed scale-degree order:
I → III → V → IV → VI → II → VII

Tonic triad first (cheap, teaches the core loop), then subdominant/
submediant (introduces new freq currencies), then the dissonant pair.
Each step costs a mix of previously-minted note and freq currencies.

### Slot & capacity unlocks

- Slot 2 unlocks after the mediant (III) is in hand.
- Slot 3 demands freq currency from cross-slot play.
- Slot 1 capacity upgrades (chord stacking) cost chord-shaped freq mixes.

### Auto-pluck

Gated behind 3 unlocked notes. Cost scales ×1.6 per slot. Fires at half
yield — manual play is always strictly better.

### Per-note yield

Once the full diatonic is unlocked, each note's yield can be leveled up.
Cost is paid in the **circle-of-fifths neighbor's** currency (upgrading C
costs G, upgrading G costs D, etc.), linking notes in a closed cycle that
forces the player to keep all notes flowing.

## Seven independent resonators

Each planet's resonator is fully isolated — its own purse, unlock ladder,
slots, auto-pluck state, and yield levels. Switching planets swaps the
entire slice. No currency crosses boundaries. The player must develop
each resonator from scratch, but the mode-shifted costs mean the puzzle
differs per planet.

## Audio

Two independent audio layers on a shared AudioContext:

1. **Orbital drone** (Tone.js): Per-body struck notes at just-intonation
   pitches relative to C3 (130.81 Hz), velocity modulated by Earth
   proximity, panned across the stereo field.
2. **Resonator plucks** (raw WebAudio): Additive synthesis — 6 sine
   oscillators at the harmonic series of the plucked note, amplitude
   weighted 1/n, envelope matched to the visual ring duration.
   Coincident partials get a 2.2× loudness boost so the consonance is
   audible.

iOS workaround: routes master through a MediaStreamDestination + hidden
`<audio playsinline>` to bypass the silent-switch "ambient" category.

## Visual language

Observatory manuscript aesthetic:

- Paper texture, foxing spots, radial vignette, double-rule frame,
  baroque corner ornaments.
- Engraved plate behind the orbit canvas (hatching, compass roses,
  sun-ray center, chromatic tick ring, cartouche label).
- Pitch helix: log-spiral in an SVG disc. Radius = octave (pitch height),
  angle = chroma (pitch class). Coincident partials literally overlap
  as the same dot — consonance is visible collision.
- Color: Newton/Boomwhacker diatonic palette (C red, D amber, E olive,
  F green, G teal, A blue, B violet). Freq currencies use a cool→warm
  gradient by ascending frequency.

## What's not built yet (future directions)

These are ideas from the original design or natural extensions — none
are committed, and none should be built unless they connect to the
harmonic-coincidence core:

- **Cross-resonator interaction.** Some resource or bonus from having
  multiple planets developed simultaneously.
- **Chromatic bodies.** Sharps/flats as side-content — asteroids or
  captured objects on the orbital wheel, unlocked once the diatonic is
  complete.
- **Tuning research.** Just intonation is the default; equal temperament
  as a late-game alternative that's slightly worse everywhere but
  flexible across keys.
- **Launch missions.** The orbital stage's alignment events could gate a
  mission mechanic — launch when consonant, expensive when dissonant.
  Deferred until the resonator loop is fully proven.
- **Gravity assists / pivot chords.** Multi-hop trajectories routed
  through a shared-resonance body (the "pivot chord" of modulation
  theory).
- **Prestige / tempo.** Reset at a higher BPM — bodies orbit faster,
  windows come quicker, currencies flow faster.
- **Persistent save.** LocalStorage or IndexedDB serialization of all
  resonator state.

## Stack

Vite + React 19 + TypeScript. Tone.js for the orbital drone, raw
WebAudio for the resonator plucks. Canvas for the orbit animation, SVG
for the pitch helix. No router or state library — state lives in App.tsx
as hooks, sliced per-planet via a Record<BodyId, ResonatorState>. Deployed
to both GitHub Pages and Cloudflare Workers.
