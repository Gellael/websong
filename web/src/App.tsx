import { useState } from 'react'
import { useGameSocket } from './useGameSocket'
import { CardView } from './CardView'
import { extendOptions, newSeriesOptions, type Option } from './series'
import type { Phase } from './types'
import './App.css'

const name = (i: number, me: number) => (i === me ? 'Kamu' : `Pemain ${i + 1}`)

const OUTCOME = { Song: 'SONG!', Leng: 'LENG!', AllDead: 'Semua pemain mati' } as const

export default function App() {
  const { connected, waiting, view, totals, error, newSeries, extend, nextRound } =
    useGameSocket()
  const [selected, setSelected] = useState<number[]>([])

  if (!connected) {
    return <div className="app"><h1>Song</h1><p>Menghubungkan ke server…</p></div>
  }

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

  const me = view.seat
  const phase: Phase = view.phase
  const myTurn = phase === 'Playing' && view.turn === me && view.alive[me]
  const canOpen = phase === 'Opening' && view.alive[me] && !view.my_pending
  const canAct = myTurn || canOpen

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const chosen = view.hand.filter((c) => selected.includes(c.id))
  let options: Option[] = []
  if (canAct && chosen.length > 0) {
    options = newSeriesOptions(chosen)
    if (myTurn) options = [...options, ...extendOptions(chosen, view.table)]
  }

  const choose = (o: Option) => {
    if (o.kind === 'new') newSeries(o.cards)
    else extend(o.series!, o.cards)
    setSelected([])
  }

  let status = ''
  if (phase === 'Opening') {
    if (!view.alive[me]) status = 'Kamu tidak punya seri untuk dibuka. Mati di awal (+100).'
    else if (view.my_pending) status = 'Seri pembukamu sudah diturunkan. Menunggu pemain lain…'
    else status = 'Turunkan seri pembuka (3–5 kartu). Semua akan dibuka serentak.'
  } else if (phase === 'Playing') {
    if (!view.alive[me]) status = 'Kamu sudah mati di ronde ini.'
    else status = myTurn ? 'Giliran kamu!' : `Giliran ${name(view.turn, me).toLowerCase()}`
  }

  return (
    <div className="app">
      <h1>Song</h1>

      <div className="players">
        {view.hand_sizes.map((n, i) => (
          <div
            key={i}
            className={`player ${i === view.turn && phase === 'Playing' ? 'active' : ''} ${i === me ? 'me' : ''} ${!view.alive[i] ? 'dead' : ''}`}
          >
            {name(i, me)}
            <br />
            {n} kartu
            <br />
            {!view.alive[i]
              ? 'mati'
              : phase === 'Opening' && view.opened[i]
                ? 'siap ✓'
                : ''}
            <div className="total">Total: {totals[i]}</div>
          </div>
        ))}
      </div>

      <div className="table">
        {view.table.length === 0 ? (
          <p>{phase === 'Opening' ? 'Seri pembuka belum dibuka.' : 'Meja kosong.'}</p>
        ) : (
          view.table.map((s, idx) => (
            <div key={idx} className="series">
              <div className="series-title">
                Seri #{idx + 1} ({name(s.owner, me)})
              </div>
              <div className="row">
                {s.cards.map((p) => (
                  <CardView key={p.card.id} card={p.card} pos={p.pos} small />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {view.my_pending && phase === 'Opening' && (
        <div>
          <p>Seri pembukamu (tersembunyi dari pemain lain):</p>
          <div className="row">
            {view.my_pending.map((p) => (
              <CardView key={p.card.id} card={p.card} pos={p.pos} small />
            ))}
          </div>
        </div>
      )}

      {phase === 'Over' && view.result ? (
        <div className="result">
          <h2>
            {OUTCOME[view.result.outcome]}
            {view.result.winner !== null && ` ${name(view.result.winner, me)} menang ronde ini.`}
          </h2>
          <table>
            <thead>
              <tr><th>Pemain</th><th>Skor ronde</th><th>Total</th></tr>
            </thead>
            <tbody>
              {view.result.scores.map((sc, i) => (
                <tr key={i} className={i === me ? 'me' : ''}>
                  <td>{name(i, me)}</td>
                  <td>{sc > 0 ? `+${sc}` : sc}</td>
                  <td>{totals[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={nextRound}>Ronde berikutnya</button>
        </div>
      ) : (
        <p className="status">{status}</p>
      )}

      {error && <p className="error">Error: {error}</p>}

      <div className="row hand">
        {view.hand.map((c) => (
          <CardView
            key={c.id}
            card={c}
            selected={selected.includes(c.id)}
            onClick={canAct ? () => toggle(c.id) : undefined}
          />
        ))}
      </div>

      {canAct && chosen.length > 0 && (
        <div className="options">
          {options.length === 0 ? (
            <p>Kartu terpilih tidak bisa dipasang. Ubah pilihan kartu.</p>
          ) : (
            <>
              <p>Pilih cara memasang:</p>
              {options.map((o, i) => (
                <button key={i} className="option" onClick={() => choose(o)}>
                  {o.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}