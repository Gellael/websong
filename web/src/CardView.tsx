import { type Card, SUIT_SYMBOL, isJoker, posLabel } from './types'
import { sfx } from './audio'

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
  const pip = realJoker || (joker && pos !== undefined) ? '★' : SUIT_SYMBOL[card.suit]

  return (
    <button
      type="button"
      aria-pressed={onClick ? !!selected : undefined}
      className={`card ${red ? 'red' : ''} ${joker ? 'joker' : ''} ${selected ? 'selected' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      // suara hover hanya untuk kartu yang bisa diklik; touch dilewati karena tap sudah punya suara sendiri
      onPointerEnter={(e) => {
        if (onClick && e.pointerType === 'mouse') sfx.hover()
      }}
      disabled={!onClick}
    >
      <span className="corner">
        <b>{label}</b>
        <i>{pip}</i>
      </span>
      <span className="pip">{pip}</span>
      <span className="corner br">
        <b>{label}</b>
        <i>{pip}</i>
      </span>
    </button>
  )
}

export function CardBack({ small }: { small?: boolean }) {
  return <span className={`card back ${small ? 'small' : ''}`} />
}