import { type Card, SUIT_SYMBOL, rankLabel } from './types'

interface Props {
  card: Card
  selected?: boolean
  onClick?: () => void
}

export function CardView({ card, selected, onClick }: Props) {
  const red = card.suit === 'Diamonds' || card.suit === 'Hearts'
  return (
    <button
      className={`card ${red ? 'red' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span>{rankLabel(card.rank)}</span>
      <span>{SUIT_SYMBOL[card.suit]}</span>
    </button>
  )
}