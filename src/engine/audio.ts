/**
 * Web Audio mixer with three buses — ambience, effects and bird calls — all synthesized, so the
 * game ships no audio files. Browsers only allow audio after a user gesture: call `unlock()`
 * from the first click/key press (the title screen does this).
 *
 * Magpie songs are generated from a per-bird seed: each voice owns a small bank of motifs built
 * from flute-like notes, steep glides, fast "quardle" warbles and gurgles, so every magpie has a
 * recognisable carol that still varies each time it sings. Calls get a little outdoor reverb.
 */
export type Sfx = 'ui' | 'flap' | 'clack' | 'hit' | 'bell' | 'yelp' | 'egg' | 'switch' | 'win' | 'lose' | 'rustle' | 'tired' | 'alert' | 'whoosh'
export type SongKind = 'carol' | 'alarm' | 'chortle' | 'chatter' | 'chirp'
export type SongVoice = { pitch: number; seed: number; rasp: number }
/** pan −1..1, gain multiplier, distance 0 (close) .. 1 (far, muffled). */
export type Spatial = { pan?: number; gain?: number; distance?: number; pitch?: number }

type Syllable = { f0: number; f1: number; dur: number; gap: number; fmRate: number; fmDepth: number; amRate: number; rasp: boolean; level: number }

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build one syllable of magpie song. Pure; frequencies are before the voice's pitch. */
export function makeSyllable(r: () => number, kind = Math.floor(r() * 5), rasp = 0): Syllable {
  const base = { gap: 0.015 + r() * 0.06, fmRate: 0, fmDepth: 0, amRate: 0, rasp: r() < rasp, level: 0.75 + r() * 0.25 }
  switch (kind) {
    case 0: { // flute: a clear held note with a gentle bend
      const f0 = 900 + r() * 1300
      return { ...base, f0, f1: f0 * (0.9 + r() * 0.25), dur: 0.12 + r() * 0.16, fmRate: 6 + r() * 3, fmDepth: 0.015 }
    }
    case 1: { // glide: a steep slide up or down
      const f0 = 700 + r() * 1600
      return { ...base, f0, f1: f0 * (r() < 0.5 ? 0.5 + r() * 0.3 : 1.4 + r() * 0.6), dur: 0.08 + r() * 0.1 }
    }
    case 2: { // warble: fast vibrato "quardle"
      const f0 = 1000 + r() * 1200
      return { ...base, f0, f1: f0 * (0.85 + r() * 0.35), dur: 0.1 + r() * 0.12, fmRate: 24 + r() * 22, fmDepth: 0.06 + r() * 0.08 }
    }
    case 3: { // chip: very short descending pip
      const f0 = 1800 + r() * 1200
      return { ...base, f0, f1: f0 * 0.7, dur: 0.03 + r() * 0.03, gap: 0.02 + r() * 0.03 }
    }
    default: { // gurgle: low throaty note with amplitude flutter
      const f0 = 450 + r() * 400
      return { ...base, f0, f1: f0 * (0.9 + r() * 0.4), dur: 0.12 + r() * 0.1, amRate: 28 + r() * 24, level: 0.6 }
    }
  }
}

/** A voice's motif bank: a few short phrases it reuses (and varies) every time it carols. */
export function motifBank(voice: SongVoice): Syllable[][] {
  const r = rng(voice.seed * 7919 + 13)
  const bank: Syllable[][] = []
  for (let m = 0; m < 4; m += 1) {
    const n = 3 + Math.floor(r() * 3)
    // Motifs lean towards gurgles first, flutes and warbles later: "quardle oodle ardle wardle doodle".
    bank.push(Array.from({ length: n }, (_, i) => makeSyllable(r, i === 0 && m === 0 ? 4 : Math.floor(r() * 5), voice.rasp)))
  }
  return bank
}

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private calls: GainNode
  private reverb: ConvolverNode
  private noise: AudioBuffer
  private flute: PeriodicWave
  private raspy: PeriodicWave
  private banks = new Map<number, Syllable[][]>()
  private wind?: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }
  private ambienceOn = false
  private ambienceTimers: number[] = []
  private ambienceNodes: AudioScheduledSourceNode[] = []
  private buffers = new Map<string, AudioBuffer>()
  private variety = rng(Date.now() & 0xffff)

  constructor() {
    this.ctx = new AudioContext()
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.music = ctx.createGain()
    this.sfx = ctx.createGain()
    this.calls = ctx.createGain()
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.impulse(1.7)
    const wet = ctx.createGain()
    wet.gain.value = 0.28
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.calls.connect(this.master)
    this.calls.connect(wet).connect(this.reverb).connect(this.master)
    this.master.connect(ctx.destination)
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    this.flute = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.3, 0.12, 0.05, 0.02]))
    this.raspy = ctx.createPeriodicWave(new Float32Array(9), new Float32Array([0, 1, 0.7, 0.5, 0.42, 0.3, 0.24, 0.18, 0.12]))
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volumes in 0..1 for ambience, effects and bird calls. */
  setVolumes(music: number, sfx: number, calls: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : music * 0.6, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.85, t, 0.05)
    this.calls.gain.setTargetAtTime(muted ? 0 : calls * 0.8, t, 0.05)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    return buffer
  }

  private get live(): boolean {
    return this.ctx.state === 'running'
  }

  private impulse(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds)
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate)
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 400 ? i / 400 : 1)
    }
    return buf
  }

  /** gain → pan → distance lowpass → bus. Returns the chain input. */
  private chain(bus: AudioNode, spatial: Spatial = {}, until: number): AudioNode {
    const g = this.ctx.createGain()
    const distance = Math.min(1, Math.max(0, spatial.distance ?? 0))
    g.gain.value = (spatial.gain ?? 1) * (1 - distance * 0.75)
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = Math.max(-1, Math.min(1, spatial.pan ?? 0))
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 9000 - distance * 6500
    g.connect(pan).connect(lp).connect(bus)
    window.setTimeout(() => g.disconnect(), (until - this.ctx.currentTime + 0.5) * 1000)
    return g
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number, freqEnd?: number): void {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t)
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur)
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(dest)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
  }

  private tone(dest: AudioNode, t: number, freq: number, end: number, dur: number, type: OscillatorType, vol: number): void {
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  /** One sung syllable. */
  private sing(dest: AudioNode, t: number, s: Syllable, pitch: number, vol: number): void {
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.setPeriodicWave(s.rasp ? this.raspy : this.flute)
    const f0 = s.f0 * pitch
    const f1 = s.f1 * pitch
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + s.dur)
    const stopAt = t + s.dur + 0.04
    if (s.fmDepth > 0) {
      const lfo = ctx.createOscillator()
      const depth = ctx.createGain()
      lfo.frequency.value = s.fmRate
      depth.gain.value = f0 * s.fmDepth
      lfo.connect(depth).connect(o.frequency)
      lfo.start(t)
      lfo.stop(stopAt)
    }
    const env = ctx.createGain()
    const peak = vol * s.level * (s.rasp ? 0.55 : 1)
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, s.dur * 0.3))
    env.gain.setValueAtTime(peak, t + s.dur * 0.65)
    env.gain.exponentialRampToValueAtTime(0.0001, t + s.dur)
    let out: AudioNode = env
    if (s.amRate > 0) {
      const am = ctx.createGain()
      am.gain.value = 0.55
      const lfo = ctx.createOscillator()
      const amt = ctx.createGain()
      lfo.frequency.value = s.amRate
      amt.gain.value = 0.45
      lfo.connect(amt).connect(am.gain)
      lfo.start(t)
      lfo.stop(stopAt)
      env.connect(am)
      out = am
    }
    o.connect(env)
    out.connect(dest)
    o.start(t)
    o.stop(stopAt)
  }

  private bank(voice: SongVoice): Syllable[][] {
    let b = this.banks.get(voice.seed)
    if (!b) {
      b = motifBank(voice)
      this.banks.set(voice.seed, b)
    }
    return b
  }

  /** Lay a sequence of syllables from time t; returns the end time. */
  private phrase(dest: AudioNode, t: number, syllables: Syllable[], pitch: number, vol: number, jitter: number): number {
    let at = t
    for (const s of syllables) {
      const p = pitch * (1 + (this.variety() - 0.5) * jitter)
      this.sing(dest, at, s, p, vol)
      at += s.dur + s.gap
    }
    return at
  }

  /**
   * A magpie vocalisation. `carol` is the full territorial song (a duet with an echoing partner),
   * `alarm` the harsh swoop warning with bill clacks, `chortle` a cheeky victory warble, `chatter`
   * quiet perch subsong, `chirp` a short contact call. Returns the duration in seconds.
   */
  song(voice: SongVoice, kind: SongKind, spatial: Spatial = {}): number {
    if (!this.live) return 0
    const t = this.ctx.currentTime + 0.02
    const bank = this.bank(voice)
    const pitch = voice.pitch * (spatial.pitch ?? 1)
    const r = this.variety
    const dest = this.chain(this.calls, spatial, t + 4)
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 280
    hp.connect(dest)
    let end = t
    switch (kind) {
      case 'carol': {
        const order = [0, 1 + Math.floor(r() * 3), Math.floor(r() * 4), 1 + Math.floor(r() * 3)]
        let at = t
        for (const m of order.slice(0, 3 + Math.floor(r() * 2))) at = this.phrase(hp, at, bank[m], pitch, 0.32, 0.04) + 0.04
        // The partner answers a little lower and overlaps: magpies carol in family choruses.
        const partner = this.chain(this.calls, { ...spatial, pan: (spatial.pan ?? 0) * 0.5 + (r() - 0.5) * 0.6, gain: (spatial.gain ?? 1) * 0.6 }, t + 4)
        let pt = t + 0.28 + r() * 0.2
        for (const m of [2, 3, 1].slice(0, 2 + Math.floor(r() * 2))) pt = this.phrase(partner, pt, bank[m], pitch * 0.84, 0.28, 0.05) + 0.05
        end = Math.max(at, pt)
        break
      }
      case 'alarm': {
        let at = t
        for (let i = 0; i < 3; i += 1) {
          this.sing(hp, at, { f0: 1250, f1: 820, dur: 0.07, gap: 0, fmRate: 0, fmDepth: 0, amRate: 60, rasp: true, level: 1 }, pitch, 0.4)
          at += 0.1
        }
        this.clacks(this.chain(this.sfx, spatial, at + 1), at, 3)
        end = at + 0.2
        break
      }
      case 'chortle': {
        const syl = bank[1 + Math.floor(r() * 3)].slice(0, 3)
        let at = this.phrase(hp, t, syl, pitch * 1.05, 0.3, 0.06)
        this.sing(hp, at, { f0: 1100, f1: 2100, dur: 0.16, gap: 0, fmRate: 30, fmDepth: 0.07, amRate: 0, rasp: false, level: 1 }, pitch, 0.3)
        at += 0.18
        end = at
        break
      }
      case 'chatter': {
        let at = t
        for (let i = 0; i < 5 + Math.floor(r() * 4); i += 1) {
          const s = makeSyllable(r, Math.floor(r() * 5), voice.rasp)
          this.sing(hp, at, { ...s, dur: s.dur * 0.7 }, pitch, 0.12)
          at += s.dur * 0.7 + s.gap
        }
        end = at
        break
      }
      case 'chirp': {
        this.sing(hp, t, { f0: 1300, f1: 1900, dur: 0.07, gap: 0, fmRate: 0, fmDepth: 0, amRate: 0, rasp: false, level: 1 }, pitch, 0.3)
        this.sing(hp, t + 0.1, { f0: 1700, f1: 1500, dur: 0.12, gap: 0, fmRate: 8, fmDepth: 0.02, amRate: 0, rasp: false, level: 1 }, pitch, 0.3)
        end = t + 0.24
        break
      }
    }
    return end - t
  }

  /** Bill snaps: the dry "clack-clack" a swooping magpie makes. */
  private clacks(dest: AudioNode, t: number, n: number): void {
    for (let i = 0; i < n; i += 1) {
      const at = t + i * 0.055
      this.noiseBurst(dest, at, 0.018, 'bandpass', 2900, 4, 0.9)
      this.tone(dest, at, 1700, 1200, 0.012, 'square', 0.12)
    }
  }

  play(name: Sfx, spatial: Spatial = {}): void {
    if (!this.live) return
    const t = this.ctx.currentTime + 0.005
    const out = this.chain(this.sfx, spatial, t + 2)
    const pitch = spatial.pitch ?? 1
    switch (name) {
      case 'ui': this.tone(out, t, 660, 700, 0.06, 'triangle', 0.18); break
      case 'flap':
        this.noiseBurst(out, t, 0.09, 'lowpass', 900, 0.7, 0.35)
        this.noiseBurst(out, t + 0.11, 0.08, 'lowpass', 800, 0.7, 0.25)
        break
      case 'whoosh': {
        // Rising rush of air for the dive; peaks as the bird passes the target.
        this.noiseBurst(out, t, 0.9, 'bandpass', 380, 1.1, 0.7, 2200)
        this.noiseBurst(out, t + 0.35, 0.55, 'highpass', 1800, 0.7, 0.18, 4200)
        break
      }
      case 'clack': this.clacks(out, t, 2); break
      case 'hit':
        this.tone(out, t, 190, 65, 0.2, 'sine', 0.6)
        this.noiseBurst(out, t, 0.12, 'lowpass', 700, 0.8, 0.5)
        this.clacks(out, t + 0.02, 2)
        break
      case 'bell':
        for (const d of [0, 0.2]) {
          this.tone(out, t + d, 2093, 2090, 0.9, 'sine', 0.22)
          this.tone(out, t + d, 5775, 5770, 0.45, 'sine', 0.07)
          this.tone(out, t + d, 11300, 11290, 0.2, 'sine', 0.025)
        }
        break
      case 'yelp': {
        // Formant "ah!"/"oi!": a sawtooth through two vowel resonances.
        const o = this.ctx.createOscillator()
        o.type = 'sawtooth'
        const f = 210 * pitch
        o.frequency.setValueAtTime(f * 1.25, t)
        o.frequency.exponentialRampToValueAtTime(f, t + 0.3)
        const env = this.ctx.createGain()
        env.gain.setValueAtTime(0.0001, t)
        env.gain.exponentialRampToValueAtTime(0.45, t + 0.03)
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.36)
        const oi = Math.random() < 0.4
        for (const [freq, q, v] of [[750, 7, 1], [oi ? 1900 : 1180, 9, 0.7], [2600, 10, 0.25]] as const) {
          const bp = this.ctx.createBiquadFilter()
          bp.type = 'bandpass'
          bp.frequency.setValueAtTime(freq, t)
          if (oi) bp.frequency.linearRampToValueAtTime(freq * 1.2, t + 0.3)
          bp.Q.value = q
          const g = this.ctx.createGain()
          g.gain.value = v
          o.connect(bp).connect(g).connect(env)
        }
        env.connect(out)
        o.start(t)
        o.stop(t + 0.4)
        break
      }
      case 'egg':
        this.noiseBurst(out, t, 0.06, 'highpass', 2500, 1, 0.5)
        ;[392, 311, 262].forEach((f, i) => this.tone(out, t + 0.08 + i * 0.16, f, f * 0.97, 0.4, 'triangle', 0.25))
        break
      case 'switch':
        this.noiseBurst(out, t, 0.35, 'bandpass', 600, 1, 0.3, 1800)
        this.tone(out, t + 0.05, 520, 880, 0.12, 'triangle', 0.12)
        break
      case 'rustle': this.noiseBurst(out, t, 0.35, 'highpass', 1600, 0.6, 0.25); break
      case 'tired': this.noiseBurst(out, t, 0.35, 'lowpass', 500, 0.7, 0.4, 200); break
      case 'alert':
        this.tone(out, t, 880, 880, 0.12, 'triangle', 0.2)
        this.tone(out, t + 0.14, 660, 660, 0.16, 'triangle', 0.2)
        break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(out, t + i * 0.11, f, f * 1.01, 0.3, 'triangle', 0.25)); break
      case 'lose': [392, 330, 262].forEach((f, i) => this.tone(out, t + i * 0.16, f, f * 0.98, 0.38, 'sine', 0.25)); break
    }
  }

  /**
   * Continuous rush of air while flying. `speed01` 0..1 scales loudness and brightness; `swoop`
   * adds the dive roar. Call every frame during play; `speed01 = 0` fades it out.
   */
  setFlight(speed01: number, swoop: boolean): void {
    if (!this.live) return
    if (!this.wind) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 0.6
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      src.connect(filter).connect(gain).connect(this.sfx)
      src.start()
      this.wind = { src, filter, gain }
    }
    const t = this.ctx.currentTime
    const s = Math.max(0, Math.min(1, speed01))
    this.wind.gain.gain.setTargetAtTime(s <= 0 ? 0 : 0.04 + s * 0.22 + (swoop ? 0.22 : 0), t, 0.12)
    this.wind.filter.frequency.setTargetAtTime(300 + s * 1500 + (swoop ? 900 : 0), t, 0.15)
  }

  /**
   * Outdoor ambience: a soft breeze bed, a gentle pad, and distant magpies carolling from
   * neighbouring territories every few seconds.
   */
  startAmbience(): void {
    if (this.ambienceOn) return
    this.ambienceOn = true
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const g = ctx.createGain()
    g.gain.value = 0.11
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    lfo.frequency.value = 0.09
    depth.gain.value = 0.06
    lfo.connect(depth).connect(g.gain)
    src.connect(lp).connect(g).connect(this.music)
    src.start()
    lfo.start()
    this.ambienceNodes.push(src, lfo)

    const chords = [[261.6, 329.6, 392], [220, 277.2, 329.6], [196, 246.9, 329.6], [220, 293.7, 349.2]]
    let bar = 0
    const pad = () => {
      if (!this.ambienceOn) return
      const t = ctx.currentTime + 0.05
      for (const f of chords[bar % chords.length]) {
        for (const detune of [-5, 5]) {
          const o = ctx.createOscillator()
          const eg = ctx.createGain()
          o.type = 'sine'
          o.frequency.value = f / 2
          o.detune.value = detune
          eg.gain.setValueAtTime(0.0001, t)
          eg.gain.linearRampToValueAtTime(0.028, t + 1.6)
          eg.gain.linearRampToValueAtTime(0.0001, t + 5.4)
          o.connect(eg).connect(this.music)
          o.start(t)
          o.stop(t + 5.6)
        }
      }
      bar += 1
      this.ambienceTimers.push(window.setTimeout(pad, 4800))
    }
    pad()
    const neighbours = () => {
      if (!this.ambienceOn) return
      if (this.live) {
        const seed = 100 + Math.floor(this.variety() * 6)
        this.song({ pitch: 0.9 + this.variety() * 0.25, seed, rasp: 0.1 }, this.variety() < 0.75 ? 'carol' : 'chatter', { pan: this.variety() * 2 - 1, distance: 0.7 + this.variety() * 0.25, gain: 0.8 })
      }
      this.ambienceTimers.push(window.setTimeout(neighbours, 5000 + this.variety() * 8000))
    }
    this.ambienceTimers.push(window.setTimeout(neighbours, 2500))
  }

  stopAmbience(): void {
    this.ambienceOn = false
    for (const id of this.ambienceTimers) clearTimeout(id)
    this.ambienceTimers = []
    for (const n of this.ambienceNodes) n.stop()
    this.ambienceNodes = []
  }
}
