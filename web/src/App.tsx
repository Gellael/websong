import { useState } from 'react'
import Game from './Game'
import './App.css'

interface Session {
  room: string
  name: string
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const randomCode = () =>
  Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('')

const loadSession = (): Session | null => {
  try {
    const raw = sessionStorage.getItem('song-session')
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

const loadName = () => {
  try {
    return localStorage.getItem('song-name') ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [name, setName] = useState(loadName)
  const [room, setRoom] = useState('')
  const [tab, setTab] = useState<'create' | 'join'>('create')

  const join = (code: string) => {
    const s = { room: code.trim().toUpperCase(), name: name.trim() }
    if (!s.room || !s.name) return
    try {
      localStorage.setItem('song-name', s.name)
    } catch {
      /* abaikan */
    }
    sessionStorage.setItem('song-session', JSON.stringify(s))
    setSession(s)
  }

  const leave = () => {
    if (session) sessionStorage.removeItem(`song-token-${session.room}`)
    sessionStorage.removeItem('song-session')
    setSession(null)
  }

  if (session) {
    return <Game key={session.room} room={session.room} name={session.name} onLeave={leave} />
  }

  const ready = name.trim().length > 0

  return (
    <div className="screen center landing">
      <div className="fan" aria-hidden>
        <div className="fcard c1"><b>A</b><span>♠</span></div>
        <div className="fcard c2 red"><b>K</b><span>♥</span></div>
        <div className="fcard c3"><b>Q</b><span>♣</span></div>
        <div className="fcard c4 red"><b>J</b><span>♦</span></div>
        <div className="fcard c5 gold"><b>★</b><span>JKR</span></div>
      </div>

      <h1 className="hero-logo">Song</h1>
      <p className="tagline">Permainan kartu tradisional · 5 pemain · main bareng online</p>

      <div className="box">
        <label className="field">
          <span>Nama kamu</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Contoh: Budi"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="tabs">
          <button className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>
            Buat room
          </button>
          <button className={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>
            Gabung room
          </button>
        </div>

        {tab === 'create' ? (
          <div className="pane">
            <p className="hint">Kamu akan mendapat kode 4 huruf untuk dibagikan ke 4 teman.</p>
            <button className="btn big" disabled={!ready} onClick={() => join(randomCode())}>
              Buat room baru
            </button>
          </div>
        ) : (
          <div className="pane">
            <input
              className="codeinput"
              value={room}
              maxLength={12}
              placeholder="KODE"
              onChange={(e) => setRoom(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && ready && join(room)}
            />
            <button className="btn big" disabled={!ready || !room.trim()} onClick={() => join(room)}>
              Gabung
            </button>
          </div>
        )}
      </div>

      <p className="foot">Butuh 5 pemain agar permainan dimulai</p>
    </div>
  )
}