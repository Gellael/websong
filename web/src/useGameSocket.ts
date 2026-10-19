import { useEffect, useRef, useState, useCallback } from 'react'
import type { Card, Placed, PlayerView, ServerMsg } from './types'

export interface JoinParams {
  room: string
  name: string
}

const EMPTY5 = ['', '', '', '', '']

function makeToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function useGameSocket({ room, name }: JoinParams) {
  const [connected, setConnected] = useState(false)
  const [waiting, setWaiting] = useState<{ seat: number; joined: number; names: string[] } | null>(null)
  const [view, setView] = useState<PlayerView | null>(null)
  const [totals, setTotals] = useState<number[]>([0, 0, 0, 0, 0])
  const [names, setNames] = useState<string[]>(EMPTY5)
  const [online, setOnline] = useState<boolean[]>([true, true, true, true, true])
  const [error, setError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    const tokenKey = `song-token-${room}`

    const connect = () => {
      let token = sessionStorage.getItem(tokenKey)
      if (!token) {
        token = makeToken()
        sessionStorage.setItem(tokenKey, token)
      }
      const qs = new URLSearchParams({ room, name, token })

      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws?${qs}`)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
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
            setWaiting({ seat: msg.seat, joined: msg.joined, names: msg.names })
            break
          case 'State':
            setView(msg.view)
            setTotals(msg.totals)
            setNames(msg.names)
            setOnline(msg.online)
            setError(null)
            break
          case 'Error':
            setError(msg.message)
            break
        }
      }
    }

    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [room, name])

  const send = (data: object) => wsRef.current?.send(JSON.stringify(data))
  const newSeries = useCallback((cards: Placed[]) => send({ type: 'NewSeries', cards }), [])
  const extend = useCallback(
    (series: number, cards: Placed[]) => send({ type: 'Extend', series, cards }),
    [],
  )
  const nextRound = useCallback(() => send({ type: 'NextRound' }), [])
  const kill = useCallback((cards: Card[]) => send({ type: 'Kill', cards }), [])
  const revive = useCallback(
    (set: number, dead: Placed, helper: Placed, series: number) =>
      send({ type: 'Revive', set, dead, helper, series }),
    [],
  )
    const addDead = useCallback(
    (set: number, cards: Card[]) => send({ type: 'AddDead', set, cards }),
    [],
  )
  return { 
    
    connected, waiting, view, totals, names, online, error, joinError,
    newSeries, extend, nextRound,kill, revive, addDead
  }
}