# Orbital Idle — Design Plan

An idle game where orbital mechanics and music theory are the same simulation.
Launch windows are beat frequencies. Consonant intervals are cheap transfers.
The solar system is a slowly evolving drone, and you play by listening.

## Core premise

Mean-motion resonance and musical consonance are the same math: small
integer ratios of frequencies. A synodic period — the time between successive
launch windows from body A to body B — is literally a beat frequency. We lean
all the way into this. The music theory isn't flavor on top of orbital
mechanics; it *is* the orbital mechanics, exposed in a form humans have
intuitions about.

## The isomorphism

| Music                    | Orbital mechanics                            |
| ------------------------ | -------------------------------------------- |
| Pitch (frequency)        | Orbital angular frequency (1 / period)       |
| Octave (2:1)             | Period doubling — outer body at half the rate|
| Perfect fifth (3:2)      | 3:2 mean-motion resonance (real: Neptune:Pluto) |
| Beat frequency           | Synodic period — the launch-window cadence   |
| Consonant interval       | Cheap, frequent transfer windows             |
| Dissonant interval       | Expensive, rare windows                      |
| Modulation               | Plane change / inclination burn              |
| Cadence (V→I)            | Return-to-Earth trajectory                   |
| Pivot chord              | Gravity assist via a shared resonance        |

## System map: circolo delle quinte

Bodies are arranged on a wheel where each step is a perfect fifth. Adjacent
bodies are in 3:2 resonance — cheap, frequent windows. Opposite bodies (the
tritone, *diabolus in musica*) are maximally hard: rare windows, big delta-v,
long transit. The wheel doubles as the tech-tree map. You start at the tonic
(Earth) and unlock outward.

For v1 we drop to a **diatonic 7-body wheel** instead of the full 12-body
chromatic. Chromatic bodies (asteroids, comets, captured objects) become
side-content unlocked later.

## Mechanics that fall out of the model

- **Chord harvesting.** Park probes at three bodies whose periods form a major
  triad (4:5:6). While the alignment holds, you get a multiplier. Minor triad
  (10:12:15) gives a smaller, moodier bonus. Diminished is unstable and decays.
- **Just vs equal temperament.** Just intonation = pure ratios = maximum
  efficiency, but only in one reference key. Equal temperament = slightly
  detuned everywhere but flexible. Late-game upgrade: switch tunings per
  mission profile.
- **Modulation = plane change.** Reaching a body in a different key signature
  costs delta-v. Pivot chords (shared notes between keys) discount the
  transition — these map onto gravity assists.
- **Tempo as time-scale.** A BPM knob controls how fast the clock runs.
  Prestige unlocks higher tempos.
- **Cadence bonuses.** Missions that resolve V→I (return via a dominant body's
  gravity assist) pay more than ones that limp home directly.
- **Dissonance debt.** Too many dissonant trajectories in a row and the system
  "wants resolution." The next consonant return pays a catharsis bonus.

## The audio layer

Each active orbit contributes a sustained tone at its frequency, transposed
into audible range on a log scale. The solar system becomes a drone that
slowly evolves as bodies move in and out of phase. Launch windows are
*audibly* the moments of consonance. A player not even looking at the screen
hears a fifth resolve and knows it's time to launch. This is the feature that
makes the game feel like nothing else.

## Tension to resolve in v1

Real planetary periods don't land on clean ratios. Two options:

1. **Stylized:** snap each body to the nearest just interval. Accept the lie.
2. **Real:** keep true periods and let the game *teach* that the solar system
   is "out of tune." Tuning research becomes a mechanic — players invest in
   precision instruments to characterize the detuning and exploit it.

Lean toward (1) for v1 to keep the core loop legible, leave (2) as a prestige
direction.

## v1 scope

Smallest thing that proves the loop:

- 7 bodies on a diatonic wheel (Earth as tonic).
- Real-time audio synth playing each body as a sine wave at its (transposed)
  orbital frequency.
- One launch pad. Launch button is cheap when the current Earth-target
  interval is consonant, expensive when dissonant.
- Idle income from a comsat constellation in LEO (steady, capped).
- One interplanetary mission type (probe → body → return) that pays a lump
  sum on cadence return.
- A visible porkchop-style readout showing upcoming windows as a piano roll.

Out of scope for v1: gravity assists, multi-hop trajectories, tuning research,
prestige, chromatic bodies, chord harvesting (tease in UI, defer mechanic).

## Open questions

- Time compression ratio. 1 in-game day = how many real seconds? Needs to
  make Earth-Mars windows feel ~weekly in real time without trivializing them.
- How loud is the drone by default? Does it need a mute / visualizer-only
  mode for accessibility?
- Do we want a tutorial that teaches the music-theory mapping, or do we trust
  players to discover it via the audio?
- Stack: plain HTML/Canvas + WebAudio is probably enough. Revisit if the
  simulation outgrows it.

## Next steps

1. Pick the time-compression ratio and lock the 7 body periods (snapped to
   just intervals).
2. Prototype the WebAudio drone with 7 oscillators driven by a shared clock.
3. Add the launch button with a cost function tied to current interval
   dissonance.
4. Wire idle income and a single interplanetary mission to close the loop.
