import { useEffect, useRef, useState, useCallback } from 'react'
import type { Card, PlayerView, ServerMsg } from './types'

export function useGameSocket() {
  const [connected, setConnected] = useState(false)
  const [waiting, setWaiting] = useState<{ seat: number; joined: number } | null>(null)
  const [view, setView] = useState<PlayerView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      const msg: ServerMsg = JSON.parse(e.data)
      if (msg.type === 'Waiting') {
        setWaiting({ seat: msg.seat, joined: msg.joined })
      } else if (msg.type === 'State') {
        setView(msg.view)
        setError(null)
      } else {
        setError(msg.message)
      }
    }

    return () => ws.close()
  }, [])

  const send = (data: object) => wsRef.current?.send(JSON.stringify(data))
  const play = useCallback((cards: Card[]) => send({ type: 'Play', cards }), [])
  const pass = useCallback(() => send({ type: 'Pass' }), [])

  return { connected, waiting, view, error, play, pass }
}