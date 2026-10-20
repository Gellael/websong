import { useEffect, useState, type CSSProperties } from 'react'
import { useGameSocket } from './useGameSocket'
import { CardView, CardBack } from './CardView'
import {
  addDeadOptions,
  extendOptions,
  killOptions,
  newSeriesOptions,
  type Option,
} from './series'
import { isJoker, posLabel, type Card, type Phase } from './types'

const OUTCOME = { Song: 'SONG!', Leng: 'LENG!', AllDead: 'Semua pemain mati' } as const
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2']
const SUIT_ORDER: Record<string, number> = { Diamonds: 0, Clubs: 1, Hearts: 2, Spades: 3, Joker: 4 }
const SEATS = [0, 1, 2, 3, 4]

type SortMode = 'suit' | 'rank'

const cv = (c: string) => ({ '--c': c }) as CSSProperties

function sortHand(hand: Card[], mode: SortMode): Card[] {
  const key = (c: Card) => {
    if (isJoker(c)) return 100000 + c.id
    return mode === 'suit' ? SUIT_ORDER[c.suit] * 100 + c.rank : c.rank * 10 + SUIT_ORDER[c.suit]
  }
  return [...hand].sort((a, b) => key(a) - key(b) || a.id - b.id)
}

function Avatar({ name, color, bot }: { name: string; color: string; bot?: boolean }) {
  return (
    <div className="avatar" style={cv(color)}>
      {bot ? '🤖' : (name || '?').charAt(0).toUpperCase()}
    </div>
  )
}

function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 30 }).map((_, i) => (
        <span
          key={i}
          className="cf"
          style={{
            left: `${(i * 37 + 5) % 100}%`,
            background: COLORS[i % 5],
            animationDuration: `${3 + (i % 5) * 0.6}s`,
            animationDelay: `${(i % 7) * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}

interface Props {
  room: string
  name: string
  scoreLimit: number
  onLeave: () => void
}

export default function Game({ room, name: myName, scoreLimit: createLimit, onLeave }: Props) {
  const {
    connected, waiting, view, totals, names, online, bots, error, joinError,
    scoreLimit, gameOver, gameWinner,
    newSeries, extend, kill, addDead, nextRound, startGame,
  } = useGameSocket({ room, name: myName, scoreLimit: createLimit })

  const [selected, setSelected] = useState<number[]>([])
  const [dismissed, setDismissed] = useState(false)
  const [showFinal, setShowFinal] = useState(false)
  const [sort, setSort] = useState<SortMode>('suit')
  const [copied, setCopied] = useState<string | null>(null)

  const phase = view?.phase
  const turn = view?.turn

  // pilihan kartu dibersihkan saat giliran/fase berganti
  useEffect(() => {
    setSelected([])
  }, [phase, turn])

  // modal hasil muncul lagi di setiap ronde baru
  useEffect(() => {
    if (phase !== 'Over') setDismissed(false)
  }, [phase])

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(key)
    window.setTimeout(() => setCopied(null), 1600)
  }
  const inviteLink = `${location.origin}/?room=${room}`
  const limitText = scoreLimit > 0 ? `Batas skor ${scoreLimit}` : 'Tanpa batas skor'

  /* ---------------- gagal masuk ---------------- */
  if (joinError) {
    return (
      <div className="landing">
        <main className="screen center">
          <h1 className="hero-logo small">Song</h1>
          <div className="box">
            <p className="error">{joinError}</p>
            <button type="button" className="btn big" onClick={onLeave}>Kembali</button>
          </div>
        </main>
      </div>
    )
  }

  /* ---------------- ruang tunggu ---------------- */
  if (!view) {
    const list = waiting?.names ?? ['', '', '', '', '']
    const joined = waiting?.joined ?? 0
    const isHost = waiting?.isHost ?? false
    return (
      <div className="landing">
        <main className="screen center">
          <h1 className="hero-logo small">Song</h1>
          <p className="tagline">Ruang tunggu</p>

          <button type="button" className="codebox" onClick={() => copy(room, 'code')}>
            <span>KODE ROOM</span>
            <b>{room}</b>
            <em>{copied === 'code' ? '✓ Tersalin' : 'Ketuk untuk menyalin'}</em>
          </button>

          <div className="chips-row">
            <span className="pill">🎯 {limitText}</span>
            <button type="button" className="pill btnlike" onClick={() => copy(inviteLink, 'link')}>
              {copied === 'link' ? '✓ Tautan tersalin' : '🔗 Salin tautan undangan'}
            </button>
          </div>

          <div className="waittable">
            <div className="waitfelt">
              <div className="waitcount">
                <b>{joined}</b>
                <span>/ 5 pemain</span>
              </div>
            </div>
            {list.map((n, i) => (
              <div key={i} className={`wseat w${i} ${n ? 'filled' : ''}`} style={cv(COLORS[i])}>
                <Avatar name={n} color={COLORS[i]} />
                <div className="pname">
                  {n || 'menunggu…'}
                  {i === waiting?.seat ? ' (kamu)' : ''}
                </div>
                {i === waiting?.seat && isHost && <div className="ptag">👑 pembuat room</div>}
              </div>
            ))}
          </div>

          {isHost ? (
            <div className="host-controls">
              <button
                type="button"
                className="btn big"
                disabled={joined < 2}
                onClick={() => startGame(scoreLimit)}
              >
                ▶ Mulai permainan
              </button>
              <p className="hint">
                {joined < 2
                  ? 'Tunggu minimal 1 teman lagi untuk memulai.'
                  : joined >= 5
                    ? 'Semua kursi terisi, siap main!'
                    : `${5 - joined} kursi kosong akan diisi bot.`}
              </p>
            </div>
          ) : (
            <p className="muted wait-note">
              {connected ? 'Menunggu pembuat room memulai permainan…' : 'Menghubungkan ke server…'}
            </p>
          )}

          <button type="button" className="btn ghost" onClick={onLeave}>Keluar</button>
        </main>
      </div>
    )
  }

  /* ---------------- data permainan ---------------- */
  const me = view.seat
  const nm = (i: number) => (i === me ? 'Kamu' : names[i] || `Pemain ${i + 1}`)

  /* ---------------- hasil akhir ---------------- */
  if (gameOver && gameWinner !== null && showFinal) {
    const ranking = [...SEATS].sort(
      (a, b) =>
        totals[a] - totals[b] || (a === gameWinner ? -1 : b === gameWinner ? 1 : a - b),
    )
    const podium = [
      { i: ranking[1], rank: 2 },
      { i: ranking[0], rank: 1 },
      { i: ranking[2], rank: 3 },
    ]
    return (
      <div className="landing">
        {gameWinner === me && <Confetti />}
        <main className="screen center">
          <div className="final-card">
            <div className="trophy">🏆</div>
            <h2 className="final-title">Permainan selesai!</h2>
            <p className="muted">Batas skor {scoreLimit} tercapai. Skor terkecil menang.</p>

            <div className="podium">
              {podium.map(({ i, rank }) => (
                <div key={rank} className={`pod p${rank}`} style={cv(COLORS[i])}>
                  {rank === 1 && <div className="crown">👑</div>}
                  <Avatar name={names[i]} color={COLORS[i]} bot={bots[i]} />
                  <div className="pname">{nm(i)}</div>
                  <div className="ptag">{totals[i]} poin</div>
                  <div className="block">{rank}</div>
                </div>
              ))}
            </div>

            <table className="score-table">
              <thead>
                <tr><th>#</th><th>Pemain</th><th>Total</th></tr>
              </thead>
              <tbody>
                {ranking.map((i, r) => (
                  <tr key={i} className={i === me ? 'me' : ''}>
                    <td>{r + 1}</td>
                    <td><span className="dot" style={{ background: COLORS[i] }} />{nm(i)}</td>
                    <td className={totals[i] >= scoreLimit ? 'bad' : 'good'}>{totals[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="row center">
              <button type="button" className="btn ghost" onClick={() => setShowFinal(false)}>
                Lihat meja
              </button>
              <button type="button" className="btn" onClick={onLeave}>Kembali ke lobby</button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  /* ---------------- meja permainan ---------------- */
  const ph: Phase = view.phase
  const myTurn = ph === 'Playing' && view.turn === me && view.alive[me]
  const canOpen = ph === 'Opening' && view.alive[me] && !view.my_pending
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
      ]
    }
  }

  const choose = (o: Option) => {
    if (o.kind === 'new') newSeries(o.cards)
    else if (o.kind === 'extend') extend(o.series!, o.cards)
    else if (o.kind === 'kill') kill(o.plain!)
    else addDead(o.set!, o.plain!)
    setSelected([])
  }

  let status = ''
  if (ph === 'Opening') {
    if (!view.alive[me]) status = 'Tidak ada seri untuk dibuka. Kamu mati di awal (+100)'
    else if (view.my_pending) status = 'Seri pembuka sudah turun. Menunggu pemain lain…'
    else status = 'Turunkan seri pembuka (3–5 kartu). Semua dibuka serentak'
  } else if (ph === 'Playing') {
    if (!view.alive[me]) status = 'Kamu sudah mati di ronde ini'
    else status = myTurn ? 'Giliran kamu!' : `Giliran ${nm(view.turn)}…`
  } else {
    status = 'Ronde selesai'
  }

  const opponents = [1, 2, 3, 4].map((k) => (me + k) % 5)
  const showResult = ph === 'Over' && view.result && !dismissed

  return (
    <div className="screen game-screen">
      <header className="topbar">
        <h1 className="hero-logo tiny">Song</h1>
        <button type="button" className="roomtag" onClick={() => copy(room, 'code')} title="Salin kode room">
          Room <b>{room}</b> {copied === 'code' ? '✓' : ''}
        </button>
        <span className="roomtag"> {scoreLimit > 0 ? scoreLimit : '∞'}</span>
        <button type="button" className="btn ghost sm" onClick={onLeave}>Keluar</button>
      </header>

      {!connected && <p className="banner">Koneksi terputus, mencoba menyambung kembali…</p>}

      {/* lawan */}
      <section className="opponents">
        {opponents.map((i) => {
          const isBot = bots[i]
          const alive = view.alive[i]
          const active = ph === 'Playing' && view.turn === i
          let tag: string
          if (!alive) tag = 'mati'
          else if (ph === 'Opening') tag = view.opened[i] ? 'siap ✓' : 'menyusun seri…'
          else tag = `${view.hand_sizes[i]} kartu`
          if (!isBot && !online[i]) tag = '⚠ terputus'
          const pct = scoreLimit > 0 ? Math.min(100, Math.max(0, (totals[i] / scoreLimit) * 100)) : 0

          return (
            <div
              key={i}
              className={`opp ${active ? 'active' : ''} ${!alive ? 'dead' : ''}`}
              style={cv(COLORS[i])}
            >
              <div className="opp-head">
                <Avatar name={names[i]} color={COLORS[i]} bot={isBot} />
                <div className="opp-name">
                  <div className="pname">
                    {nm(i)} {isBot && <span className="botbadge">BOT</span>}
                  </div>
                  <div className="ptag">{tag}</div>
                </div>
              </div>
              <div className="backs">
                {Array.from({ length: Math.min(view.hand_sizes[i], 12) }).map((_, k) => (
                  <CardBack key={k} small />
                ))}
              </div>
              <div className="total">{totals[i]} poin</div>
              {scoreLimit > 0 && (
                <div className="bar">
                  <div className={`fill ${pct > 80 ? 'danger' : pct > 50 ? 'warn' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* meja */}
      <section className="rim">
        <div className="felt">
          {view.table.length === 0 ? (
            <p className="empty">{ph === 'Opening' ? 'Seri pembuka belum dibuka' : 'Meja kosong'}</p>
          ) : (
            view.table.map((s, idx) => (
              <div key={idx} className="lane" style={cv(COLORS[s.owner])}>
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
      </section>

      {view.sets.length > 0 && (
        <section className="graveyard">
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
        </section>
      )}

      {view.my_pending && ph === 'Opening' && (
        <section className="graveyard">
          <div className="gtitle">Seri pembukamu (tersembunyi dari pemain lain)</div>
          <div className="lane">
            <div className="lane-cards">
              {view.my_pending.map((p) => (
                <CardView key={p.card.id} card={p.card} pos={p.pos} small />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* kamu */}
      <section className={`mebar ${canAct ? 'mine' : ''}`} style={cv(COLORS[me])}>
        <Avatar name={myName} color={COLORS[me]} />
        <div className="mebar-text">
          <div className="pname">
            {myName} <span className="muted">· {totals[me]} poin{scoreLimit > 0 ? ` / ${scoreLimit}` : ''}</span>
          </div>
          <div className={`status ${canAct ? 'go' : ''}`}>{status}</div>
        </div>
        <div className="sortbtns">
          <button type="button" className={sort === 'suit' ? 'on' : ''} onClick={() => setSort('suit')}>Jenis</button>
          <button type="button" className={sort === 'rank' ? 'on' : ''} onClick={() => setSort('rank')}>Angka</button>
        </div>
      </section>

      {canAct && chosen.length > 0 && (
        <section className="actions">
          <div className="selbar">
            <span>{chosen.length} kartu dipilih</span>
            <button type="button" className="linkbtn" onClick={() => setSelected([])}>Bersihkan</button>
          </div>
          <div className="options">
            {options.length === 0 ? (
              <p className="muted">Kartu terpilih belum bisa dipasang. Ubah pilihanmu.</p>
            ) : (
              options.map((o, i) => (
                <button type="button" key={i} className={`chip ${o.kind}`} onClick={() => choose(o)}>
                  {o.label}
                </button>
              ))
            )}
          </div>
        </section>
      )}

      {error && <div className="toast">⚠ {error}</div>}

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

      {ph === 'Over' && dismissed && view.result && (
        <div className="row center">
          <button
            type="button"
            className="btn"
            onClick={() => (gameOver ? setShowFinal(true) : setDismissed(false))}
          >
            {gameOver ? 'Lihat hasil akhir' : 'Lihat hasil ronde'}
          </button>
        </div>
      )}

      {/* hasil ronde */}
      {showResult && view.result && (
        <div className="overlay">
          {view.result.winner === me && <Confetti />}
          <div className="modal">
            <div className={`outcome ${view.result.outcome}`}>{OUTCOME[view.result.outcome]}</div>
            {view.result.winner !== null && (
              <p className="winner">🏆 {nm(view.result.winner)} menang ronde ini</p>
            )}
            <table className="score-table">
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
            {scoreLimit > 0 && (
              <p className="limit-info">
                Batas skor {scoreLimit}
                {gameOver && <b className="bad"> · tercapai!</b>}
              </p>
            )}
            <div className="row center">
              <button type="button" className="btn ghost" onClick={() => setDismissed(true)}>Tutup</button>
              {gameOver ? (
                <button type="button" className="btn" onClick={() => setShowFinal(true)}>
                  Lihat hasil akhir
                </button>
              ) : (
                <button type="button" className="btn" onClick={nextRound}>Ronde berikutnya</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}