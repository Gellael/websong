export type Suit = 'Diamonds' | 'Clubs' | 'Hearts' | 'Spades' | 'Joker'

// rank: 1=A, 2..10, 11=J, 12=Q, 13=K, 14=Joker
export interface Card {
  rank: number
  suit: Suit
  id: number
}

export interface Placed {
  card: Card
  pos: number // 1..14 (A bisa 1 atau 14)
}

export interface Series {
  owner: number
  suit: Suit
  cards: Placed[]
}

export interface DeadSet {
  owner: number
  rank: number
  cards: Card[]
}

export type Phase = 'Opening' | 'Playing' | 'Over'

export interface RoundResult {
  outcome: 'Song' | 'Leng' | 'AllDead'
  winner: number | null
  scores: number[]
}

export interface PlayerView {
  seat: number
  hand: Card[]
  hand_sizes: number[]
  table: Series[]
  sets: DeadSet[]
  alive: boolean[]
  opened: boolean[]
  my_pending: Placed[] | null
  turn: number
  phase: Phase
  result: RoundResult | null
}

export type ServerMsg =
  | { type: 'Joined'; token: string; seat: number }
  | { type: 'JoinFailed'; message: string }
  | { type: 'Waiting'; seat: number; joined: number; names: string[]; isHost: boolean; scoreLimit: number }
  | {
      type: 'State'
      view: PlayerView
      totals: number[]
      names: string[]
      online: boolean[]
      bots: boolean[]
      scoreLimit: number
      gameOver: boolean
      gameWinner: number | null
    }
  | { type: 'Error'; message: string }

export const SUIT_SYMBOL: Record<Suit, string> = {
  Diamonds: '♦',
  Clubs: '♣',
  Hearts: '♥',
  Spades: '♠',
  Joker: '★',
}

/** Joker asli, atau As Sekop (berfungsi sebagai joker). */
export const isJoker = (c: Card) =>
  c.suit === 'Joker' || (c.rank === 1 && c.suit === 'Spades')

const LABEL: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
export const posLabel = (pos: number) => LABEL[pos] ?? String(pos)