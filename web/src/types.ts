export type Suit = 'Diamonds' | 'Clubs' | 'Hearts' | 'Spades'

export interface Card {
  rank: number // 3..10, 11=J, 12=Q, 13=K, 14=A, 15=2
  suit: Suit
}

export interface Combo {
  kind: 'Single' | 'Pair' | 'Triple'
  cards: Card[]
}

export interface PlayerView {
  seat: number
  hand: Card[]
  hand_sizes: number[]
  turn: number
  table: [number, Combo] | null
  finished: number[]
  over: boolean
}

export type ServerMsg =
  | { type: 'Waiting'; seat: number; joined: number }
  | { type: 'State'; view: PlayerView }
  | { type: 'Error'; message: string }

export const SUIT_SYMBOL: Record<Suit, string> = {
  Diamonds: '♦',
  Clubs: '♣',
  Hearts: '♥',
  Spades: '♠',
}

const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' }

export const rankLabel = (r: number) => RANK_LABEL[r] ?? String(r)
export const cardKey = (c: Card) => `${c.rank}-${c.suit}`