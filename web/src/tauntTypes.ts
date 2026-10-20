export type TauntKind = 'banana' | 'tomato' | 'egg' | 'sandal' | 'poop'

/** Pesan dari server: seseorang melempar sesuatu. delay (ms) dipakai untuk balasan bot. */
export interface TauntMsg {
  type: 'Taunt'
  from: number
  to: number
  kind: TauntKind
  id: string
  delay?: number
}

export const TAUNTS: { kind: TauntKind; emoji: string; label: string }[] = [
  { kind: 'banana', emoji: '🍌', label: 'Kulit pisang' },
  { kind: 'tomato', emoji: '🍅', label: 'Tomat' },
  { kind: 'egg', emoji: '🥚', label: 'Telur' },
  { kind: 'sandal', emoji: '🩴', label: 'Sandal' },
  { kind: 'poop', emoji: '💩', label: 'Ranjau' },
]

export const TAUNT_EMOJI: Record<TauntKind, string> = {
  banana: '🍌',
  tomato: '🍅',
  egg: '🥚',
  sandal: '🩴',
  poop: '💩',
}

/** Efek yang muncul di tempat lemparan mendarat. */
export const SPLAT_EMOJI: Record<TauntKind, string> = {
  banana: '💫',
  tomato: '💥',
  egg: '🍳',
  sandal: '💢',
  poop: '🤢',
}

/** Jeda antar lemparan di sisi client (server menjaga batasnya sendiri). */
export const TAUNT_COOLDOWN_MS = 2000