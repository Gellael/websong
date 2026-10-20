import { useEffect, useRef, useState, useCallback } from 'react'
import type { Card, Placed, PlayerView, ServerMsg } from './types'

export interface JoinParams {
  room: string
  name: string
  /** Batas skor pilihan pembuat room (0 = tanpa batas). Server hanya memakainya saat room dibuat. */
  scoreLimit?: number
}

export interface WaitingInfo {
  seat: number
  joined: number
  names: string[]
  isHost: boolean
}

const EMPTY5 = ['', '', '', '', '']

function makeToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function useGameSocket({ room, name, scoreLimit: createLimit = 0 }: JoinParams) {
  const [connected, setConnected] = useState(false)
  const [waiting, setWaiting] = useState<WaitingInfo | null>(null)
  const [view, setView] = useState<PlayerView | null>(null)
  const [totals, setTotals] = useState<number[]>([0, 0, 0, 0, 0])
  const [names, setNames] = useState<string[]>(EMPTY5)
  const [online, setOnline] = useState<boolean[]>([true, true, true, true, true])
  const [bots, setBots] = useState<boolean[]>([false, false, false, false, false])
  const [error, setError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [scoreLimit, setScoreLimit] = useState(createLimit)
  const [gameOver, setGameOver] = useState(false)
  const [gameWinner, setGameWinner] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let errTimer: number | undefined
    const tokenKey = `song-token-${room}`

    const connect = () => {
      let token = sessionStorage.getItem(tokenKey)
      if (!token) {
        token = makeToken()
        sessionStorage.setItem(tokenKey, token)
      }
      const qs = new URLSearchParams({ room, name, token })
      if (createLimit > 0) qs.set('limit', String(createLimit))

      // Production: VITE_WS_URL (mis. wss://song-server.xxx.workers.dev/ws).
      // Development: kosong, pakai host yang sama.
      const base: string =
        import.meta.env.VITE_WS_URL ??
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
      const ws = new WebSocket(`${base}?${qs}`)
      wsRef.current = ws
      let heartbeat: number | undefined

      ws.onopen = () => {
        setConnected(true)
        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"Ping"}')
        }, 30000)
      }
      ws.onclose = () => {
        window.clearInterval(heartbeat)
        setConnected(false)
        if (!closed) retry = window.setTimeout(connect, 1500)
      }
      ws.onmessage = (e) => {
        const msg: ServerMsg = JSON.parse(e.data)
        switch (msg.type) {
          case 'Joined':
            sessionStorage.setItem(tokenKey, msg.token)
            break
          case 'JoinFailed':
            closed = true // gagal gabung: jangan coba lagi
            setJoinError(msg.message)
            ws.close()
            break
          case 'Waiting':
            setWaiting({ seat: msg.seat, joined: msg.joined, names: msg.names, isHost: msg.isHost })
            setScoreLimit(msg.scoreLimit ?? 0)
            break
          case 'State':
            setView(msg.view)
            setTotals(msg.totals)
            setNames(msg.names)
            setOnline(msg.online)
            setBots(msg.bots ?? [false, false, false, false, false])
            setScoreLimit(msg.scoreLimit ?? 0)
            setGameOver(msg.gameOver ?? false)
            setGameWinner(msg.gameWinner ?? null)
            setError(null)
            break
          case 'Error':
            setError(msg.message)
            window.clearTimeout(errTimer)
            errTimer = window.setTimeout(() => setError(null), 4500)
            break
        }
      }
    }

    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      window.clearTimeout(errTimer)
      wsRef.current?.close()
    }
  }, [room, name, createLimit])

  const send = (data: object) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  const newSeries = useCallback((cards: Placed[]) => send({ type: 'NewSeries', cards }), [])
  const extend = useCallback(
    (series: number, cards: Placed[]) => send({ type: 'Extend', series, cards }),
    [],
  )
  const kill = useCallback((cards: Card[]) => send({ type: 'Kill', cards }), [])
  const addDead = useCallback(
    (set: number, cards: Card[]) => send({ type: 'AddDead', set, cards }),
    [],
  )
  const nextRound = useCallback(() => send({ type: 'NextRound' }), [])
  const startGame = useCallback(
    (limit: number) => send({ type: 'StartGame', scoreLimit: limit }),
    [],
  )

  return {
    connected, waiting, view, totals, names, online, bots, error, joinError,
    scoreLimit, gameOver, gameWinner,
    newSeries, extend, kill, addDead, nextRound, startGame,
  }
}