// Shared AudioContext bootstrap for the orbital and harvest stages.
// iOS Safari only honors AudioContext.resume() called *synchronously* inside
// the user gesture, and routes raw WebAudio through the "ambient" session
// category which the silent switch mutes. Both stages need the same dance:
// build the graph inside the click handler, route master through a
// MediaStreamDestination + <audio playsinline> for the "playback" category.

export type AudioGraph = {
  ctx: AudioContext
  // Connect new voices here (pre-master, post-filter).
  filter: BiquadFilterNode
  master: GainNode
  audioEl: HTMLAudioElement | null
}

export function createAudioGraph(opts?: {
  lowpassHz?: number
  lowpassQ?: number
  fadeInS?: number
}): AudioGraph | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  const ctx = new Ctor()
  void ctx.resume()

  // 1-sample silent buffer: legacy iOS unlock so subsequent oscillator output is audible.
  const unlock = ctx.createBufferSource()
  unlock.buffer = ctx.createBuffer(1, 1, 22050)
  unlock.connect(ctx.destination)
  unlock.start(0)

  const master = ctx.createGain()
  master.gain.value = 0
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + (opts?.fadeInS ?? 0.6))

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = opts?.lowpassHz ?? 1500
  filter.Q.value = opts?.lowpassQ ?? 0.5
  filter.connect(master)

  let audioEl: HTMLAudioElement | null
  try {
    const streamDest = ctx.createMediaStreamDestination()
    master.connect(streamDest)
    audioEl = document.createElement('audio')
    audioEl.setAttribute('playsinline', '')
    audioEl.autoplay = true
    audioEl.srcObject = streamDest.stream
    void audioEl.play()
  } catch {
    audioEl = null
    master.connect(ctx.destination)
  }

  return { ctx, filter, master, audioEl }
}

export function teardownAudioGraph(
  graph: AudioGraph,
  stops: OscillatorNode[],
  fadeOutS = 0.3,
): void {
  const { ctx, master, audioEl } = graph
  const tnow = ctx.currentTime
  master.gain.cancelScheduledValues(tnow)
  master.gain.setValueAtTime(master.gain.value, tnow)
  master.gain.linearRampToValueAtTime(0, tnow + fadeOutS)
  for (const o of stops) o.stop(tnow + fadeOutS + 0.05)
  window.setTimeout(() => {
    if (audioEl) {
      audioEl.pause()
      audioEl.srcObject = null
    }
    void ctx.close()
  }, (fadeOutS + 0.15) * 1000)
}
