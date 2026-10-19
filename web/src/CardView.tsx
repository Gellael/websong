import { type Card, SUIT_SYMBOL, isJoker, posLabel } from './types'

interface Props {
  card: Card
  pos?: number // diisi untuk kartu di meja (menampilkan posisi joker)
  selected?: boolean
  small?: boolean
  onClick?: () => void
}

export function CardView({ card, pos, selected, small, onClick }: Props) {
  const joker = isJoker(card)
  const red = card.suit === 'Diamonds' || card.suit === 'Hearts'
  const label = pos !== undefined ? posLabel(pos) : card.suit === 'Joker' ? '★' : posLabel(card.rank)
  const sym = card.suit === 'Joker' ? 'JOKER' : SUIT_SYMBOL[card.suit]

  return (
    <button
      className={`card ${red ? 'red' : ''} ${joker ? 'joker' : ''} ${selected ? 'selected' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span>{label}</span>
      <span>{pos !== undefined && joker ? '★' : sym}</span>
    </button>
  )
}