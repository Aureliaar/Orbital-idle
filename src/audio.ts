// Shared AudioContext bootstrap for the orbital and harvest stages.
//
// iOS Safari only honors AudioContext.resume() called *synchronously* inside
// the user gesture, and routes raw WebAudio through the "ambient" session
// category which the silent switch mutes. The fix on iOS is to pipe master
// through a MediaStreamDestination + <audio playsinline> so playback uses
// the "playback" session category. On desktop browsers the MediaStream
// dance is unnecessary (and unreliable — the offscreen <audio> element's
// `.play()` can reject silently outside a fresh user gesture, killing all
// subsequent audio until something else re-primes it). So we detect iOS
// and only use the MediaStream path there.
//
// We also keep ONE AudioContext per page (`sharedBoot`) — both the orbital
// drone and the harvest plucks hang their own filter/master subgraph off
// the same context. Multiple AudioContexts on one page are limited and
// browsers can leave secondary contexts suspended, which was the root of
// the "harvest audio doesn't work until you toggle orbital first" bug.

export type AudioGraph = {
  ctx: AudioContext
  // Connect new voices here (pre-master, post-filter).
  filter: BiquadFilterNode
  master: GainNode
  audioEl: HTMLAudioElement | null
}

type Boot = {
  ctx: AudioContext
  // Stage masters connect here — either the MediaStream sink (iOS) or
  // ctx.destination (desktop).
  output: AudioNode
  audioEl: HTMLAudioElement | null
}

let sharedBoot: Boot | null = null

function isIOSLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports as MacIntel; the touch points heuristic distinguishes
  // it from a real Mac.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1
}

function getOrCreateBoot(): Boot | null {
  if (sharedBoot) {
    // Make sure the context and audio element are awake — re-toggling audio
    // or remounting a stage shouldn't leave the boot in a paused state.
    void sharedBoot.ctx.resume()
    if (sharedBoot.audioEl && sharedBoot.audioEl.paused) {
      void sharedBoot.audioEl.play().catch(() => {})
    }
    return sharedBoot
  }

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

  let output: AudioNode = ctx.destination
  let audioEl: HTMLAudioElement | null = null
  if (isIOSLike()) {
    try {
      const streamDest = ctx.createMediaStreamDestination()
      audioEl = document.createElement('audio')
      audioEl.setAttribute('playsinline', '')
      audioEl.autoplay = true
      audioEl.srcObject = streamDest.stream
      audioEl.style.display = 'none'
      // Keep it in the DOM so some browsers don't GC it / drop the stream.
      document.body.appendChild(audioEl)
      void audioEl.play().catch(() => {})
      output = streamDest
    } catch {
      // Fall through to ctx.destination.
      audioEl = null
      output = ctx.destination
    }
  }

  sharedBoot = { ctx, output, audioEl }
  return sharedBoot
}

export function createAudioGraph(opts?: {
  lowpassHz?: number
  lowpassQ?: number
  fadeInS?: number
}): AudioGraph | null {
  const boot = getOrCreateBoot()
  if (!boot) return null
  const { ctx, output } = boot
  const t0 = ctx.currentTime

  const master = ctx.createGain()
  // Anchor the start value with an explicit setValueAtTime so the ramp
  // computes from a defined point — `.value = 0` doesn't create an
  // automation event and the linearRamp can behave oddly on a freshly
  // resumed context.
  master.gain.setValueAtTime(0, t0)
  master.gain.linearRampToValueAtTime(1, t0 + (opts?.fadeInS ?? 0.6))

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = opts?.lowpassHz ?? 1500
  filter.Q.value = opts?.lowpassQ ?? 0.5
  filter.connect(master)
  master.connect(output)

  return { ctx, filter, master, audioEl: boot.audioEl }
}

export function teardownAudioGraph(
  graph: AudioGraph,
  stops: OscillatorNode[],
  fadeOutS = 0.3,
): void {
  const { ctx, master, filter } = graph
  const tnow = ctx.currentTime
  master.gain.cancelScheduledValues(tnow)
  master.gain.setValueAtTime(master.gain.value, tnow)
  master.gain.linearRampToValueAtTime(0, tnow + fadeOutS)
  for (const o of stops) o.stop(tnow + fadeOutS + 0.05)
  // Disconnect just this stage's subgraph — the shared boot (ctx + audio
  // element) lives for the page so the next stage to come online doesn't
  // need to re-bootstrap audio.
  window.setTimeout(() => {
    try {
      master.disconnect()
    } catch {
      // already disconnected
    }
    try {
      filter.disconnect()
    } catch {
      // already disconnected
    }
  }, (fadeOutS + 0.15) * 1000)
}
