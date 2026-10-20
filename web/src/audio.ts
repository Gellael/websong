/**
 * Audio game "Song" — dua sumber suara yang bisa dipilih:
 *
 *  - mode 'mp3'   : memakai file di web/public/audio/
 *                   card-hover-sound-effect.mp3, card-picked-sound-effect.mp3, card-background-music.mp3
 *  - mode 'synth' : disintesis lewat Web Audio API (tanpa file)
 *
 * API:
 *   sfx.hover(), sfx.select(on), sfx.place(count)
 *   music.isOn/subscribe/set/toggle      -> musik hidup/mati
 *   soundMode.get/subscribe/set/toggle   -> pilih 'mp3' atau 'synth'
 */

const BASE = import.meta.env.BASE_URL
const SRC = {
  hover: `${BASE}audio/card-hover-sound-effect.mp3`,
  picked: `${BASE}audio/card-picked-sound-effect.mp3`,
  music: `${BASE}audio/card-background-music.mp3`,
}

/** Volume mode mp3: 0 (hening) sampai 1 (maksimal). */
const VOLUME = { hover: 0.35, picked: 0.7, music: 0.25 }

const MUSIC_KEY = 'song-music'
const MODE_KEY = 'song-sound-mode'



export type SoundMode = 'mp3' | 'synth'

/* ================================================================== */
/* MODE SINTESIS (Web Audio API)                                       */
/* ================================================================== */

let ctx: AudioContext | null = null
let sfxBus: GainNode
let musicBus: GainNode
let reverbSend: GainNode
let noiseBuf: AudioBuffer

function ensure(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()

  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 4
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(comp).connect(ctx.destination)

  sfxBus = ctx.createGain()
  sfxBus.gain.value = 0.8
  sfxBus.connect(master)

  musicBus = ctx.createGain()
  musicBus.gain.value = 0
  musicBus.connect(master)

  const irLen = Math.floor(ctx.sampleRate * 2.2)
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3)
  }
  const convolver = ctx.createConvolver()
  convolver.buffer = ir
  reverbSend = ctx.createGain()
  reverbSend.gain.value = 1
  const wet = ctx.createGain()
  wet.gain.value = 0.35
  reverbSend.connect(convolver).connect(wet).connect(musicBus)

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const nd = noiseBuf.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  return ctx
}

function running(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function tone(opts: {
  type: OscillatorType
  freq: number
  freqEnd?: number
  start: number
  attack?: number
  hold?: number
  release: number
  gain: number
  dest: AudioNode
  send?: number
  detune?: number
  filter?: number
}) {
  const c = ctx!
  const { type, freq, freqEnd, start, attack = 0.005, hold = 0, release, gain, dest, send = 0, detune = 0, filter } = opts
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + attack + hold + release)
  osc.detune.value = detune

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.linearRampToValueAtTime(gain, start + attack)
  g.gain.setValueAtTime(gain, start + attack + hold)
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release)

  let node: AudioNode = osc
  if (filter) {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = filter
    node.connect(f)
    node = f
  }
  node.connect(g)
  g.connect(dest)
  if (send > 0) {
    const s = c.createGain()
    s.gain.value = send
    g.connect(s).connect(reverbSend)
  }
  osc.start(start)
  osc.stop(start + attack + hold + release + 0.05)
}

function noise(opts: {
  start: number
  dur: number
  gain: number
  dest: AudioNode
  filterType: BiquadFilterType
  freq: number
  q?: number
}) {
  const c = ctx!
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const f = c.createBiquadFilter()
  f.type = opts.filterType
  f.frequency.value = opts.freq
  f.Q.value = opts.q ?? 0.8
  const g = c.createGain()
  g.gain.setValueAtTime(opts.gain, opts.start)
  g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur)
  src.connect(f).connect(g).connect(opts.dest)
  src.start(opts.start, Math.random() * 0.5)
  src.stop(opts.start + opts.dur + 0.02)
}

/* ---- efek sintesis ---- */

function synthHover() {
  const c = running()
  if (!c) return
  const t = c.currentTime
  const jitter = (Math.random() - 0.5) * 80
  tone({ type: 'triangle', freq: 1250, freqEnd: 900, start: t, attack: 0.002, release: 0.05, gain: 0.07, dest: sfxBus, detune: jitter })
  noise({ start: t, dur: 0.02, gain: 0.025, dest: sfxBus, filterType: 'highpass', freq: 4000 })
}

function synthSelect(on: boolean) {
  const c = running()
  if (!c) return
  const t = c.currentTime
  const [a, b] = on ? [480, 760] : [700, 440]
  tone({ type: 'sine', freq: a, freqEnd: b, start: t, attack: 0.003, release: 0.09, gain: 0.16, dest: sfxBus })
}

function synthPlace(count: number) {
  const c = running()
  if (!c) return
  const hits = Math.max(1, Math.min(4, count))
  for (let i = 0; i < hits; i++) {
    const t = c.currentTime + i * 0.065
    const v = 1 - i * 0.12
    noise({ start: t, dur: 0.11, gain: 0.5 * v, dest: sfxBus, filterType: 'bandpass', freq: 1800 + Math.random() * 500, q: 0.9 })
    tone({ type: 'sine', freq: 190, freqEnd: 65, start: t, attack: 0.002, release: 0.13, gain: 0.45 * v, dest: sfxBus })
    noise({ start: t, dur: 0.05, gain: 0.12 * v, dest: sfxBus, filterType: 'highpass', freq: 5500 })
  }
}

/* ---- musik sintesis ---- */

const BPM = 76
const EIGHTH = 60 / BPM / 2
const SWING = 0.14
const STEPS_PER_BAR = 8
const MUSIC_LEVEL = 0.26

const PROGRESSION: { bass: number; chord: number[] }[] = [
  { bass: 38, chord: [53, 57, 60, 64] },
  { bass: 43, chord: [53, 59, 62, 64] },
  { bass: 36, chord: [52, 55, 59, 62] },
  { bass: 45, chord: [52, 55, 60, 64] },
  { bass: 41, chord: [52, 57, 60, 64] },
  { bass: 40, chord: [55, 59, 62, 64] },
  { bass: 38, chord: [50, 57, 60, 65] },
  { bass: 43, chord: [53, 55, 60, 62] },
]
const BARS = PROGRESSION.length
const BELL_NOTES = [74, 77, 79, 81, 84]
const ARP_PATTERNS = [
  [0, 2, 1, 3, 2, 3, 1, 2],
  [0, 1, 2, 3, 2, 1, 2, 3],
  [0, 2, 3, 2, 1, 3, 2, 1],
]

let timer: number | undefined
let nextTime = 0
let step = 0

function playStep(s: number, time: number) {
  const bar = Math.floor(s / STEPS_PER_BAR) % BARS
  const i = s % STEPS_PER_BAR
  const { bass, chord } = PROGRESSION[bar]
  const t = i % 2 === 1 ? time + EIGHTH * SWING : time
  const barLen = EIGHTH * STEPS_PER_BAR

  if (i === 0) {
    for (const m of chord) {
      tone({ type: 'triangle', freq: midiHz(m), start: t, attack: 0.5, hold: barLen * 0.6, release: barLen * 0.55, gain: 0.05, dest: musicBus, send: 0.5, filter: 1400, detune: (Math.random() - 0.5) * 8 })
    }
    tone({ type: 'sine', freq: midiHz(bass), start: t, attack: 0.02, hold: barLen * 0.35, release: barLen * 0.3, gain: 0.3, dest: musicBus })
  }
  if (i === 4) {
    tone({ type: 'sine', freq: midiHz(bass), start: t, attack: 0.02, hold: barLen * 0.12, release: barLen * 0.2, gain: 0.22, dest: musicBus })
  }

  const pattern = ARP_PATTERNS[bar % ARP_PATTERNS.length]
  if (Math.random() > 0.22) {
    const m = chord[pattern[i] % chord.length] + 12
    tone({ type: 'triangle', freq: midiHz(m), start: t, attack: 0.004, release: 0.45, gain: 0.07, dest: musicBus, send: 0.45, filter: 2600 })
  }

  if ((i === 0 || i === 4) && Math.random() < 0.45) {
    const m = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)]
    tone({ type: 'sine', freq: midiHz(m), start: t + 0.01, attack: 0.004, release: 1.1, gain: 0.05, dest: musicBus, send: 0.9 })
  }

  if (i === 0 || i === 4) {
    tone({ type: 'sine', freq: 130, freqEnd: 42, start: t, attack: 0.002, release: 0.16, gain: 0.32, dest: musicBus })
  }
  if (i === 2 || i === 6) {
    noise({ start: t, dur: 0.14, gain: 0.07, dest: musicBus, filterType: 'bandpass', freq: 1900, q: 0.7 })
  }
  if (i % 2 === 1) {
    noise({ start: t, dur: 0.04, gain: 0.03, dest: musicBus, filterType: 'highpass', freq: 7000 })
  }
}

function schedule() {
  const c = ctx
  if (!c) return
  while (nextTime < c.currentTime + 0.35) {
    playStep(step, nextTime)
    nextTime += EIGHTH
    step = (step + 1) % (BARS * STEPS_PER_BAR)
  }
}

let synthPlaying = false

function startSynthMusic() {
  const c = running()
  if (!c || synthPlaying) return
  synthPlaying = true
  musicBus.gain.cancelScheduledValues(c.currentTime)
  musicBus.gain.setValueAtTime(musicBus.gain.value, c.currentTime)
  musicBus.gain.linearRampToValueAtTime(MUSIC_LEVEL, c.currentTime + 1.2)
  nextTime = c.currentTime + 0.08
  schedule()
  timer = window.setInterval(schedule, 100)
}

function stopSynthMusic() {
  if (!ctx || !synthPlaying) return
  synthPlaying = false
  window.clearInterval(timer)
  const t = ctx.currentTime
  musicBus.gain.cancelScheduledValues(t)
  musicBus.gain.setValueAtTime(musicBus.gain.value, t)
  musicBus.gain.linearRampToValueAtTime(0, t + 0.4)
}

/** Buat/resume AudioContext lalu mulai musik sintesis. Harus dari gesture pengguna. */
function playSynthMusic() {
  const c = ensure()
  if (!c) return
  if (c.state === 'running') startSynthMusic()
  else c.resume().then(startSynthMusic, () => {})
}

/* ================================================================== */
/* MODE MP3                                                            */
/* ================================================================== */

type SfxKind = 'hover' | 'picked'
const sfxBase: Partial<Record<SfxKind, HTMLAudioElement>> = {}

function playMp3Sfx(kind: SfxKind) {
  if (typeof Audio === 'undefined') return
  let base = sfxBase[kind]
  if (!base) {
    base = new Audio(SRC[kind])
    base.preload = 'auto'
    sfxBase[kind] = base
  }
  const a = base.cloneNode(true) as HTMLAudioElement
  a.volume = VOLUME[kind]
  a.play().catch(() => {})
}

let bgm: HTMLAudioElement | null = null

function getBgm() {
  if (typeof Audio === 'undefined') return null
  if (!bgm) {
    bgm = new Audio(SRC.music)
    bgm.loop = true
    bgm.volume = VOLUME.music
    bgm.preload = 'auto'
  }
  return bgm
}

function playMp3Music() {
  getBgm()?.play().catch(() => {})
}

function pauseMp3Music() {
  bgm?.pause()
}

/* ================================================================== */
/* State: mode + musik on/off                                          */
/* ================================================================== */

function readBool(key: string, fallback: boolean, offValue: string): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v !== offValue
  } catch {
    return fallback
  }
}

function readMode(): SoundMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'synth' ? 'synth' : 'mp3'
  } catch {
    return 'mp3'
  }
}

let musicOn = readBool(MUSIC_KEY, true, 'off')
let mode: SoundMode = readMode()

const musicListeners = new Set<() => void>()
const modeListeners = new Set<() => void>()

const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* abaikan */
  }
}

/** Samakan musik yang berbunyi dengan mode + status on/off saat ini. */
function applyMusic() {
  if (mode === 'mp3') {
    stopSynthMusic()
    if (musicOn) playMp3Music()
    else pauseMp3Music()
  } else {
    pauseMp3Music()
    if (musicOn) playSynthMusic()
    else stopSynthMusic()
  }
}

/* ---- API publik ---- */

export const sfx = {
  hover() {
    const now = performance.now()
    if (now - lastHover < (mode === 'mp3' ? 70 : 45)) return
    if (mode === 'mp3') {
      if (!canHover()) return
      lastHover = now
      playMp3Sfx('hover')
    } else {
      lastHover = now
      synthHover()
    }
  },
 select(on: boolean) {
  const c = ensure()
  if (!c) return

  const play = () => {
    const t = c.currentTime
    const [a, b] = on ? [480, 760] : [700, 440]

    tone({
      type: 'sine',
      freq: a,
      freqEnd: b,
      start: t,
      attack: 0.003,
      release: 0.09,
      gain: 0.8,
      dest: sfxBus,
    })
  }

  if (c.state === 'running') {
    play()
  } else {
    c.resume().then(play).catch(() => {})
  }
},

  place(count = 1) {
    if (mode === 'mp3') playMp3Sfx('picked')
    else synthPlace(count)
  },
}

let lastHover = 0
const canHover = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches

export const music = {
  isOn: () => musicOn,
  subscribe(fn: () => void) {
    musicListeners.add(fn)
    return () => {
      musicListeners.delete(fn)
    }
  },
  set(on: boolean) {
    musicOn = on
    save(MUSIC_KEY, on ? 'on' : 'off')
    musicListeners.forEach((fn) => fn())
    applyMusic()
  },
  toggle() {
    music.set(!musicOn)
  },
}

export const soundMode = {
  get: (): SoundMode => mode,
  subscribe(fn: () => void) {
    modeListeners.add(fn)
    return () => {
      modeListeners.delete(fn)
    }
  },
  set(next: SoundMode) {
    if (next === mode) return
    mode = next
    save(MODE_KEY, next)
    modeListeners.forEach((fn) => fn())
    applyMusic()
  },
  toggle() {
    soundMode.set(mode === 'mp3' ? 'synth' : 'mp3')
  },
}

/* ================================================================== */
/* Buka kunci audio pada gesture pertama + jeda saat tab disembunyikan */
/* ================================================================== */

const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const

function unlock() {
  if (!musicOn) {
    // tetap siapkan context agar efek sintesis bisa bunyi
    if (mode === 'synth') ensure()?.resume().catch(() => {})
    return
  }
  if (mode === 'mp3') {
    if (bgm && !bgm.paused) return
    playMp3Music()
  } else {
    playSynthMusic()
  }
}

if (typeof window !== 'undefined') {
  for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, unlock, { capture: true, passive: true })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseMp3Music()
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {})
    } else {
      if (mode === 'mp3' && musicOn) playMp3Music()
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    }
  })

  if (mode === 'mp3' && musicOn) playMp3Music()
}