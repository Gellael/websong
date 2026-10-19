import { useEffect, useRef, useState, useCallback } from 'react'
import type { Placed, PlayerView, ServerMsg } from './types'

export function useGameSocket() {
  const [connected, setConnected] = useState(false)
  const [waiting, setWaiting] = useState<{ seat: number; joined: number } | null>(null)
  const [view, setView] = useState<PlayerView | null>(null)
  const [totals, setTotals] = useState<number[]>([0, 0, 0, 0, 0])
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
        setTotals(msg.totals)
        setError(null)
      } else {
        setError(msg.message)
      }
    }

    return () => ws.close()
  }, [])

  const send = (data: object) => wsRef.current?.send(JSON.stringify(data))
  const newSeries = useCallback((cards: Placed[]) => send({ type: 'NewSeries', cards }), [])
  const extend = useCallback(
    (series: number, cards: Placed[]) => send({ type: 'Extend', series, cards }),
    [],
  )
  const nextRound = useCallback(() => send({ type: 'NextRound' }), [])

  return { connected, waiting, view, totals, error, newSeries, extend, nextRound }
}