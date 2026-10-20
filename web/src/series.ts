import type { Card, DeadSet, Placed, Series, Suit } from './types'
import { SUIT_SYMBOL, isJoker, posLabel } from './types'

export interface Option {
  label: string
  kind: 'new' | 'extend' | 'kill' | 'adddead'
  series?: number
  cards: Placed[]
  plain?: Card[]
  set?: number
}

const matches = (c: Card, pos: number) => pos === c.rank || (c.rank === 1 && pos === 14)

/** Tempatkan kartu pada daftar posisi; joker mengisi posisi yang tersisa. */
function assign(cards: Card[], positions: number[]): Placed[] | null {
  const free = [...positions]
  const placed: Placed[] = []
  const jokers: Card[] = []
  for (const card of cards) {
    if (isJoker(card)) {
      jokers.push(card)
      continue
    }
    const i = free.findIndex((p) => matches(card, p))
    if (i < 0) return null
    placed.push({ card, pos: free[i] })
    free.splice(i, 1)
  }
  jokers.forEach((card, k) => placed.push({ card, pos: free[k] }))
  return placed.sort((a, b) => a.pos - b.pos)
}

/** Jenis kartu asli. null = tidak ada kartu asli, false = jenis campur. */
function naturalSuit(cards: Card[]): Suit | null | false {
  let suit: Suit | null = null
  for (const c of cards) {
    if (isJoker(c)) continue
    if (suit === null) suit = c.suit
    else if (suit !== c.suit) return false
  }
  return suit
}

const show = (ps: Placed[]) =>
  ps.map((p) => posLabel(p.pos) + (isJoker(p.card) ? '★' : '')).join(' ')

export function newSeriesOptions(cards: Card[]): Option[] {
  const n = cards.length
  if (n < 3 || n > 5) return []
  const suit = naturalSuit(cards)
  if (suit === false || suit === null) return []
  const out: Option[] = []
  for (let s = 1; s + n - 1 <= 14; s++) {
    const positions = Array.from({ length: n }, (_, i) => s + i)
    const placed = assign(cards, positions)
    if (placed) {
      out.push({ kind: 'new', cards: placed, label: `Seri baru ${SUIT_SYMBOL[suit]}  ${show(placed)}` })
    }
  }
  return out
}

export function extendOptions(cards: Card[], table: Series[]): Option[] {
  const n = cards.length
  if (n < 1 || n > 2) return []
  const suit = naturalSuit(cards)
  if (suit === false) return []
  const out: Option[] = []
  table.forEach((s, idx) => {
    if (suit !== null && suit !== s.suit) return
    const lo = s.cards[0].pos
    const hi = s.cards[s.cards.length - 1].pos
    const sets =
      n === 1
        ? [[lo - 1], [hi + 1]]
        : [[lo - 2, lo - 1], [lo - 1, hi + 1], [hi + 1, hi + 2]]
    for (const positions of sets) {
      if (positions.some((p) => p < 1 || p > 14)) continue
      const placed = assign(cards, positions)
      if (placed) {
        out.push({
          kind: 'extend',
          series: idx,
          cards: placed,
          label: `Sambung seri #${idx + 1} ${SUIT_SYMBOL[s.suit]}  ${show(placed)}`,
        })
      }
    }
  })
  return out
}

export function killOptions(cards: Card[]): Option[] {
  if (cards.length < 3 || cards.length > 5) return []
  const naturals = cards.filter((c) => !isJoker(c))
  if (naturals.length === 0) return []
  if (naturals.some((c) => c.rank !== naturals[0].rank)) return []
  return [
    {
      kind: 'kill',
      cards: [],
      plain: cards,
      label: `Matikan ${cards.length} kartu ${posLabel(naturals[0].rank)}`,
    },
  ]
}

export function addDeadOptions(cards: Card[], sets: DeadSet[]): Option[] {
  if (cards.length < 1 || cards.length > 2) return []
  const naturals = cards.filter((c) => !isJoker(c))
  if (naturals.some((c) => c.rank !== naturals[0].rank)) return []
  const out: Option[] = []
  sets.forEach((d, i) => {
    if (naturals.length > 0 && naturals[0].rank !== d.rank) return
    out.push({
      kind: 'adddead',
      set: i,
      cards: [],
      plain: cards,
      label: `Tambah ${cards.length} kartu ke set mati ${posLabel(d.rank)} (#${i + 1})`,
    })
  })
  return out
}