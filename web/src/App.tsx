import { useState } from 'react'
import { useGameSocket } from './useGameSocket'
import { CardView } from './CardView'
import { cardKey, type Card } from './types'
import './App.css'

export default function App() {
  const { connected, waiting, view, error, play, pass } = useGameSocket()
  const [selected, setSelected] = useState<Card[]>([])

  const toggle = (c: Card) =>
    setSelected((s) =>
      s.some((x) => cardKey(x) === cardKey(c))
        ? s.filter((x) => cardKey(x) !== cardKey(c))
        : [...s, c],
    )

  if (!connected) return <div className="app"><h1>Song</h1><p>Menghubungkan ke server…</p></div>

  if (!view) {
    return (
      <div className="app">
        <h1>Song</h1>
        <p>Kamu duduk di kursi {(waiting?.seat ?? 0) + 1}.</p>
        <p>Menunggu pemain: {waiting?.joined ?? 1} / 5</p>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  const myTurn = view.turn === view.seat && !view.over

  return (
    <div className="app">
      <h1>Song</h1>

      <div className="players">
        {view.hand_sizes.map((n, i) => (
          <div
            key={i}
            className={`player ${i === view.turn && !view.over ? 'active' : ''} ${i === view.seat ? 'me' : ''}`}
          >
            {i === view.seat ? 'Kamu' : `Pemain ${i + 1}`}
            <br />
            {n} kartu
          </div>
        ))}
      </div>

      <div className="table">
        {view.table ? (
          <>
            <p>Pemain {view.table[0] + 1} membuang:</p>
            <div className="row">
              {view.table[1].cards.map((c) => <CardView key={cardKey(c)} card={c} />)}
            </div>
          </>
        ) : (
          <p>Meja kosong, pemain giliran bebas memimpin.</p>
        )}
      </div>

      {view.over ? (
        <h2>
          Selesai! Peringkat: {view.finished.map((p, i) => `${i + 1}. ${p === view.seat ? 'Kamu' : `Pemain ${p + 1}`}`).join(' | ')}
        </h2>
      ) : (
        <p>{myTurn ? 'Giliran kamu!' : `Giliran pemain ${view.turn + 1}`}</p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row hand">
        {view.hand.map((c) => (
          <CardView
            key={cardKey(c)}
            card={c}
            selected={selected.some((x) => cardKey(x) === cardKey(c))}
            onClick={() => toggle(c)}
          />
        ))}
      </div>

      <div className="row">
        <button
          disabled={!myTurn || selected.length === 0}
          onClick={() => { play(selected); setSelected([]) }}
        >
          Buang
        </button>
        <button disabled={!myTurn} onClick={pass}>Pass</button>
      </div>
    </div>
  )
}