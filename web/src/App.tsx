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

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')

  const join = (code: string) => {
    const s = { room: code.trim().toUpperCase(), name: name.trim() }
    if (!s.room || !s.name) return
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

  return (
    <div className="app lobby">
      <h1>Song</h1>
      <label>
        Nama kamu
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Kode room
        <input
          value={room}
          maxLength={12}
          onChange={(e) => setRoom(e.target.value.toUpperCase())}
        />
      </label>
      <div className="row">
        <button disabled={!name.trim() || !room.trim()} onClick={() => join(room)}>
          Gabung room
        </button>
        <button disabled={!name.trim()} onClick={() => join(randomCode())}>
          Buat room baru
        </button>
      </div>
    </div>
  )
}