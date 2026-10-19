import { useState } from 'react'
import { useGameSocket } from './useGameSocket'
import { CardView, CardBack } from './CardView'
import {
  addDeadOptions,
  extendOptions,
  killOptions,
  newSeriesOptions,
  reviveOptions,
  type Option,
} from './series'
import { isJoker, posLabel, type Card, type Phase } from './types'

const OUTCOME = { Song: 'SONG!', Leng: 'LENG!', AllDead: 'Semua pemain mati' } as const
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2']
const SUIT_ORDER: Record<string, number> = { Diamonds: 0, Clubs: 1, Hearts: 2, Spades: 3, Joker: 4 }

type SortMode = 'suit' | 'rank'

function sortHand(hand: Card[], mode: SortMode): Card[] {
  const key = (c: Card) => {
    if (isJoker(c)) return 100000 + c.id
    return mode === 'suit'
      ? SUIT_ORDER[c.suit] * 100 + c.rank
      : c.rank * 10 + SUIT_ORDER[c.suit]
  }
  return [...hand].sort((a, b) => key(a) - key(b) || a.id - b.id)
}

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
  const [sort, setSort] = useState<SortMode>('suit')
  const [copied, setCopied] = useState(false)

  const copyCode = () => {
    navigator.clipboard?.writeText(room)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (joinError) {
    return (
      <div className="screen center">
        <h1 className="hero-logo small">Song</h1>
        <div className="box">
          <p className="error">{joinError}</p>
          <button className="btn big" onClick={onLeave}>Kembali</button>
        </div>
      </div>
    )
  }

  /* ---------------- ruang tunggu ---------------- */
  if (!view) {
    const list = waiting?.names ?? ['', '', '', '', '']
    return (
      <div className="screen center">
        <h1 className="hero-logo small">Song</h1>

        <div className="codebox" onClick={copyCode}>
          <span>KODE ROOM</span>
          <b>{room}</b>
          <em>{copied ? '✓ Tersalin' : 'Ketuk untuk menyalin'}</em>
        </div>

        <div className="waittable">
          <div className="waitfelt">
            <div className="waitcount">
              <b>{waiting?.joined ?? 1}</b>
              <span>/ 5 pemain</span>
            </div>
          </div>
          {list.map((n, i) => (
            <div key={i} className={`wseat w${i} ${n ? 'filled' : ''}`} style={{ ['--c' as string]: COLORS[i] }}>
              <div className="avatar">{n ? n.charAt(0).toUpperCase() : '?'}</div>
              <div className="pname">
                {n ? n : 'menunggu…'}
                {i === waiting?.seat ? ' (kamu)' : ''}
              </div>
            </div>
          ))}
        </div>

        <p className="muted">
          {connected ? 'Permainan mulai otomatis saat 5 pemain sudah masuk' : 'Menghubungkan ke server…'}
        </p>
        <button className="btn ghost" onClick={onLeave}>Keluar</button>
      </div>
    )
  }

  /* ---------------- permainan ---------------- */
  const me = view.seat
  const nm = (i: number) => (i === me ? 'Kamu' : names[i] || `Pemain ${i + 1}`)
  const phase: Phase = view.phase
  const myTurn = phase === 'Playing' && view.turn === me && view.alive[me]
  const canOpen = phase === 'Opening' && view.alive[me] && !view.my_pending
  const canAct = myTurn || canOpen

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const hand = sortHand(view.hand, sort)
  const chosen = hand.filter((c) => selected.includes(c.id))
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

  const opponents = [1, 2, 3, 4].map((k) => (me + k) % 5)
  const showResult = phase === 'Over' && view.result && !dismissed

  return (
    <div className="screen">
      <div className="topbar">
        <h1 className="hero-logo tiny">Song</h1>
        <span className="roomtag">Room <b>{room}</b></span>
        <button className="btn ghost sm" onClick={onLeave}>Keluar</button>
      </div>

      {!connected && <p className="banner">Koneksi terputus, mencoba menyambung kembali…</p>}

      {/* lawan */}
      <div className="opponents">
        {opponents.map((i) => {
          const active = i === view.turn && phase === 'Playing'
          const tag = !online[i]
            ? '⚠ putus'
            : !view.alive[i]
              ? 'mati'
              : phase === 'Opening' && view.opened[i]
                ? 'siap ✓'
                : `${view.hand_sizes[i]} kartu`
          return (
            <div
              key={i}
              className={`opp ${active ? 'active' : ''} ${!view.alive[i] ? 'dead' : ''}`}
              style={{ ['--c' as string]: COLORS[i] }}
            >
              <div className="opp-head">
                <div className="avatar">{(names[i] || '?').charAt(0).toUpperCase()}</div>
                <div>
                  <div className="pname">{nm(i)}</div>
                  <div className="ptag">{tag}</div>
                </div>
              </div>
              <div className="backs">
                {Array.from({ length: Math.min(view.hand_sizes[i], 12) }).map((_, k) => (
                  <CardBack key={k} small />
                ))}
              </div>
              <div className="total">{totals[i]} poin</div>
            </div>
          )
        })}
      </div>

      {/* meja */}
      <div className="rim">
        <div className="felt">
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

      {view.my_pending && phase === 'Opening' && (
        <div className="graveyard">
          <div className="gtitle">Seri pembukamu (tersembunyi dari pemain lain)</div>
          <div className="lane">
            <div className="lane-cards">
              {view.my_pending.map((p) => (
                <CardView key={p.card.id} card={p.card} pos={p.pos} small />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* kamu */}
      <div className={`mebar ${active(view.turn, me, phase) ? 'mine' : ''}`}>
        <div className="avatar" style={{ background: COLORS[me] }}>
          {(myName || '?').charAt(0).toUpperCase()}
        </div>
        <div className="mebar-text">
          <div className="pname">{myName} <span className="muted">· {totals[me]} poin</span></div>
          <div className={`status ${myTurn || canOpen ? 'go' : ''}`}>{status}</div>
        </div>
        <div className="sortbtns">
          <button className={sort === 'suit' ? 'on' : ''} onClick={() => setSort('suit')}>Jenis</button>
          <button className={sort === 'rank' ? 'on' : ''} onClick={() => setSort('rank')}>Angka</button>
        </div>
      </div>

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

      {/* tangan: satu baris, bisa digeser */}
      <div className="handwrap">
        <div className="hand">
          {hand.map((c) => (
            <CardView
              key={c.id}
              card={c}
              selected={selected.includes(c.id)}
              onClick={canAct ? () => toggle(c.id) : undefined}
            />
          ))}
        </div>
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

function active(turn: number, me: number, phase: Phase) {
  return phase === 'Playing' && turn === me
}