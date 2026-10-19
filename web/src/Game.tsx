import { useState } from 'react'
import { useGameSocket } from './useGameSocket'
import { CardView } from './CardView'
import {
  addDeadOptions,
  extendOptions,
  killOptions,
  newSeriesOptions,
  reviveOptions,
  type Option,
} from './series'
import { posLabel, type Phase } from './types'

const OUTCOME = { Song: 'SONG!', Leng: 'LENG!', AllDead: 'Semua pemain mati' } as const
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2']

interface Props {
  room: string
  name: string
  onLeave: () => void
}

export default function Game({ room, name: myName, onLeave }: Props) {
  const {
    connected, waiting, view, totals, names, online, error, joinError,
    newSeries, extend, kill, revive, addDead, nextRound,
  } = useGameSocket({ room, name: myName })
  const [selected, setSelected] = useState<number[]>([])
  const [dismissed, setDismissed] = useState(false)

  if (joinError) {
    return (
      <div className="app">
        <h1 className="logo">Song</h1>
        <p className="error">{joinError}</p>
        <button className="btn" onClick={onLeave}>Kembali</button>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="app">
        <h1 className="logo">Song</h1>
        <div className="panel waiting">
          <p>Kode room</p>
          <div className="bigcode">{room}</div>
          <p className="muted">Bagikan kode ini ke 4 pemain lain</p>
          {!connected ? (
            <p>Menghubungkan ke server…</p>
          ) : (
            <>
              <p><b>{waiting?.joined ?? 1}</b> / 5 pemain</p>
              <ul className="seatlist">
                {(waiting?.names ?? []).map((n, i) => (
                  <li key={i} className={n ? 'filled' : ''}>
                    <span className="dot" style={{ background: COLORS[i] }} />
                    {n || 'menunggu…'}{i === waiting?.seat ? ' (kamu)' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <button className="btn ghost" onClick={onLeave}>Keluar</button>
      </div>
    )
  }

  const me = view.seat
  const nm = (i: number) => (i === me ? 'Kamu' : names[i] || `Pemain ${i + 1}`)
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
    if (myTurn) {
      options = [
        ...options,
        ...extendOptions(chosen, view.table),
        ...killOptions(chosen),
        ...addDeadOptions(chosen, view.sets),
        ...reviveOptions(chosen, view.table, view.sets),
      ]
    }
  }

  const choose = (o: Option) => {
    if (o.kind === 'new') newSeries(o.cards)
    else if (o.kind === 'extend') extend(o.series!, o.cards)
    else if (o.kind === 'kill') kill(o.plain!)
    else if (o.kind === 'adddead') addDead(o.set!, o.plain!)
    else revive(o.set!, o.dead!, o.helper!, o.series!)
    setSelected([])
  }

  let status = ''
  if (phase === 'Opening') {
    if (!view.alive[me]) status = 'Kamu tidak punya seri untuk dibuka. Mati di awal (+100)'
    else if (view.my_pending) status = 'Seri pembuka sudah turun. Menunggu pemain lain…'
    else status = 'Turunkan seri pembuka (3–5 kartu), semua dibuka serentak'
  } else if (phase === 'Playing') {
    if (!view.alive[me]) status = 'Kamu sudah mati di ronde ini'
    else status = myTurn ? 'Giliran kamu!' : `Giliran ${nm(view.turn)}…`
  }

  const showResult = phase === 'Over' && view.result && !dismissed

  return (
    <div className="app">
      <div className="topbar">
        <h1 className="logo">Song</h1>
        <span className="roomtag">Room <b>{room}</b></span>
        <button className="btn ghost" onClick={onLeave}>Keluar</button>
      </div>

      {!connected && <p className="banner">Koneksi terputus, mencoba menyambung kembali…</p>}

      <div className="players">
        {view.hand_sizes.map((n, i) => {
          const active = i === view.turn && phase === 'Playing'
          const tag = !online[i] && i !== me
            ? '⚠ putus'
            : !view.alive[i]
              ? 'mati'
              : phase === 'Opening' && view.opened[i]
                ? 'siap ✓'
                : `${n} kartu`
          return (
            <div
              key={i}
              className={`player ${active ? 'active' : ''} ${i === me ? 'me' : ''} ${!view.alive[i] ? 'dead' : ''}`}
              style={{ ['--c' as string]: COLORS[i] }}
            >
              <div className="avatar">{(names[i] || '?').charAt(0).toUpperCase()}</div>
              <div className="pname">{nm(i)}</div>
              <div className="ptag">{tag}</div>
              <div className="total">{totals[i]} poin</div>
            </div>
          )
        })}
      </div>

      <div className="table">
        {view.table.length === 0 ? (
          <p className="empty">{phase === 'Opening' ? 'Seri pembuka belum dibuka' : 'Meja kosong'}</p>
        ) : (
          view.table.map((s, idx) => (
            <div key={idx} className="lane" style={{ ['--c' as string]: COLORS[s.owner] }}>
              <div className="lane-label">
                <b>#{idx + 1}</b>
                <span>{nm(s.owner)}</span>
              </div>
              <div className="lane-cards">
                {s.cards.map((p) => (
                  <CardView key={p.card.id} card={p.card} pos={p.pos} small />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {view.sets.length > 0 && (
        <div className="graveyard">
          <div className="gtitle">☠ Kartu mati</div>
          {view.sets.map((d, i) => (
            <div key={i} className="lane dark">
              <div className="lane-label">
                <b>{posLabel(d.rank)}</b>
                <span>set #{i + 1}</span>
              </div>
              <div className="lane-cards">
                {d.cards.map((c) => (
                  <CardView key={c.id} card={c} small />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view.sets.length > 0 && (
        <div className="graveyard">
          <div className="gtitle">☠ Kartu mati</div>
          {view.sets.map((d, i) => (
            <div key={i} className="series">
              <div className="badge dark">#{i + 1} · {nm(d.owner)}</div>
              <div className="row">
                {d.cards.map((c) => (
                  <CardView key={c.id} card={c} small />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view.my_pending && phase === 'Opening' && (
        <div className="pending">
          <div className="gtitle">Seri pembukamu (tersembunyi)</div>
          <div className="row">
            {view.my_pending.map((p) => (
              <CardView key={p.card.id} card={p.card} pos={p.pos} small />
            ))}
          </div>
        </div>
      )}

      {error && <p className="error">⚠ {error}</p>}

      {canAct && chosen.length > 0 && (
        <div className="options">
          {options.length === 0 ? (
            <p className="muted">Kartu terpilih tidak bisa dipasang. Ubah pilihan kartu.</p>
          ) : (
            options.map((o, i) => (
              <button key={i} className={`chip ${o.kind}`} onClick={() => choose(o)}>
                {o.label}
              </button>
            ))
          )}
        </div>
      )}

      <div className="hand">
        {view.hand.map((c) => (
          <CardView
            key={c.id}
            card={c}
            selected={selected.includes(c.id)}
            onClick={canAct ? () => toggle(c.id) : undefined}
          />
        ))}
      </div>

      {phase === 'Over' && dismissed && view.result && (
        <button className="btn" onClick={() => setDismissed(false)}>Lihat hasil ronde</button>
      )}

      {showResult && view.result && (
        <div className="overlay">
          <div className="modal">
            <div className={`outcome ${view.result.outcome}`}>{OUTCOME[view.result.outcome]}</div>
            {view.result.winner !== null && (
              <p className="winner">🏆 {nm(view.result.winner)} menang ronde ini</p>
            )}
            <table>
              <thead>
                <tr><th>Pemain</th><th>Ronde</th><th>Total</th></tr>
              </thead>
              <tbody>
                {view.result.scores.map((sc, i) => (
                  <tr key={i} className={i === me ? 'me' : ''}>
                    <td><span className="dot" style={{ background: COLORS[i] }} />{nm(i)}</td>
                    <td className={sc > 0 ? 'bad' : 'good'}>{sc > 0 ? `+${sc}` : sc}</td>
                    <td>{totals[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row center">
              <button className="btn ghost" onClick={() => setDismissed(true)}>Tutup</button>
              <button className="btn" onClick={() => { setDismissed(false); nextRound() }}>
                Ronde berikutnya
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}