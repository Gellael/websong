import { useState } from 'react'
import Game from './Game'
import { MusicToggle } from './MusicToggle'
import { TableList } from './TableList'
import { useTables } from './useTables'
import './App.css'

interface Session {
  room: string
  name: string
  scoreLimit: number
  isPublic?: boolean
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const randomCode = () =>
  Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('')

const PRESETS = [
  { label: '100', value: 100 },
  { label: '200', value: 200 },
  { label: '300', value: 300 },
  { label: '500', value: 500 },
  { label: 'Tanpa batas', value: 0 },
]

const FLOATERS = ['♠', '♥', '♣', '♦', '★', '♠', '♥', '♣', '♦', '★', '♠', '♥', '♣', '♦']

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

/** Kode room dari tautan undangan: /?room=ABCD */
const urlRoom = () =>
  (new URLSearchParams(location.search).get('room') ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12)

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [name, setName] = useState(loadName)
  const [room, setRoom] = useState(urlRoom)
  const [tab, setTab] = useState<'create' | 'join'>(() => (urlRoom() ? 'join' : 'create'))
  const [scoreLimit, setScoreLimit] = useState(200)
  const [customScore, setCustomScore] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [isPublic, setIsPublic] = useState(true)

  // daftar meja hanya dimuat saat tab "Gabung" dibuka dan belum ada sesi
  const { tables, loading, failed } = useTables(5000, !session && tab === 'join')

  const ready = name.trim().length > 0
  const effectiveScore = showCustom ? parseInt(customScore, 10) || 0 : scoreLimit
  const customInvalid = showCustom && effectiveScore < 50

  const join = (code: string, limit = 0, pub = false) => {
    const s: Session = {
      room: code.trim().toUpperCase(),
      name: name.trim(),
      scoreLimit: limit,
      isPublic: pub,
    }
    if (!s.room || !s.name) return
    try {
      localStorage.setItem('song-name', s.name)
    } catch {
      /* abaikan */
    }
    sessionStorage.setItem('song-session', JSON.stringify(s))
    if (location.search) history.replaceState(null, '', location.pathname)
    setSession(s)
  }

  const leave = () => {
    if (session) sessionStorage.removeItem(`song-token-${session.room}`)
    sessionStorage.removeItem('song-session')
    setSession(null)
  }

  if (session) {
    return (
      <Game
        key={session.room}
        room={session.room}
        name={session.name}
        scoreLimit={session.scoreLimit}
        isPublic={session.isPublic ?? false}
        onLeave={leave}
      />
    )
  }

  return (
    <div className="landing">
      <MusicToggle floating />
      <div className="floaters" aria-hidden>
        {FLOATERS.map((s, i) => (
          <span
            key={i}
            className={`floater ${'♥♦'.includes(s) ? 'red' : ''}`}
            style={{
              left: `${(i * 47 + 8) % 96}%`,
              fontSize: `${24 + ((i * 7) % 28)}px`,
              animationDelay: `${(i * 1.7) % 9}s`,
              animationDuration: `${15 + ((i * 3) % 10)}s`,
            }}
          >
            {s}
          </span>
        ))}
      </div>

      <main className="screen center">
        <div className="fan" aria-hidden>
          <div className="fcard c1"><b>A</b><span>♠</span></div>
          <div className="fcard c2 red"><b>K</b><span>♥</span></div>
          <div className="fcard c3"><b>Q</b><span>♣</span></div>
          <div className="fcard c4 red"><b>J</b><span>♦</span></div>
            <div className="fcard-cons golds c5s">
            <img src="/logo.png" alt="Logo JKR" className="fcard-logo" />
            <span className="fcard-text">JKR</span>
            </div>
        </div>

        <h1 className="hero-logo" style={{ padding: '12px' }}>SongIn <a className='hero-links' target='_blank' href="https://instagram.com/kalibata.project"> <span className='hero-span'>By Kalibata Project</span> </a></h1>
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

          <div className="tabs" role="tablist">
            <button type="button" className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>
              Buat room
            </button>
            <button type="button" className={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>
              Gabung room
            </button>
          </div>

          {tab === 'create' ? (
            <div className="pane">
              <div className="field">
                <span>Batas skor</span>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button
                      type="button"
                      key={p.value}
                      className={`preset ${!showCustom && scoreLimit === p.value ? 'on' : ''}`}
                      onClick={() => {
                        setScoreLimit(p.value)
                        setShowCustom(false)
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`preset ${showCustom ? 'on' : ''}`}
                    onClick={() => setShowCustom(true)}
                  >
                    Kustom
                  </button>
                </div>
                {showCustom && (
                  <input
                    type="number"
                    inputMode="numeric"
                    className="customscore"
                    value={customScore}
                    min={50}
                    step={50}
                    placeholder="Minimal 50, mis. 150"
                    onChange={(e) => setCustomScore(e.target.value)}
                  />
                )}
                <p className="hint">
                  {customInvalid
                    ? 'Isi batas skor minimal 50.'
                    : effectiveScore > 0
                      ? `Permainan berakhir saat ada pemain mencapai ${effectiveScore} poin. Skor terkecil menang.`
                      : 'Tanpa batas skor, main sampai kalian berhenti.'}
                </p>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                <span>Tampilkan di daftar meja (pemain lain bisa gabung tanpa kode)</span>
              </label>

              <button
                type="button"
                className="btn big"
                disabled={!ready || customInvalid}
                onClick={() => join(randomCode(), effectiveScore, isPublic)}
              >
                Buat room baru
              </button>
              <p className="hint">
                Kamu mendapat kode 4 huruf untuk dibagikan. Hanya pembuat room yang bisa menekan Mulai.
              </p>
            </div>
          ) : (
            <div className="pane">
              <TableList
                tables={tables}
                loading={loading}
                failed={failed}
                canJoin={ready}
                onJoin={(code) => join(code)}
              />
              <div className="divider"><span>atau pakai kode</span></div>
              <input
                className="codeinput"
                value={room}
                maxLength={12}
                placeholder="KODE"
                autoCapitalize="characters"
                onChange={(e) => setRoom(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && ready && room.trim() && join(room)}
              />
              <button
                type="button"
                className="btn big"
                disabled={!ready || !room.trim()}
                onClick={() => join(room)}
              >
                Gabung
              </button>
            </div>
          )}
        </div>

        <details className="rules">
          <summary>Cara bermain</summary>
          <ul>
            <li>Tiap pemain dapat 20 kartu. Di awal ronde semua menurunkan satu seri pembuka (3–5 kartu berurutan, satu jenis) secara tersembunyi, lalu dibuka serentak.</li>
            <li>Pemain yang tidak bisa membuka seri langsung mati (+100).</li>
            <li>Setiap giliran, lakukan satu aksi: seri baru, sambung seri di meja (1–2 kartu), matikan 3–5 kartu seangka, atau tambah kartu ke set mati.</li>
            <li>Habiskan kartu dengan seri baru untuk <b>Song</b> (−100), atau dengan cara lain untuk <b>Leng</b> (−50).</li>
            <li>Pemain yang tidak punya langkah otomatis mati, sisa kartunya jadi poin (maks 75). Skor terkecil menang.</li>
            <li>Joker ★ dan As Sekop (A♠) bisa menggantikan kartu apa pun.</li>
          </ul>
        </details>

        <p className="foot">Butuh minimal 2 pemain · Kursi kosong diisi bot · Pemain yang keluar digantikan bot</p>
      </main>
    </div>
  )
}