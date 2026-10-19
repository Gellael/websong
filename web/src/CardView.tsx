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
  const realJoker = card.suit === 'Joker'
  const red = card.suit === 'Diamonds' || card.suit === 'Hearts'
  const label = pos !== undefined ? posLabel(pos) : realJoker ? 'JKR' : posLabel(card.rank)
  const suit = realJoker ? '★' : SUIT_SYMBOL[card.suit]
  const pip = realJoker || (joker && pos !== undefined) ? '★' : suit

  return (
    <button
      className={`card ${red ? 'red' : ''} ${joker ? 'joker' : ''} ${selected ? 'selected' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="corner">
        <b>{label}</b>
        <i>{pip}</i>
      </span>
      <span className="pip">{pip}</span>
    </button>
  )
}