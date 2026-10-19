import { useEffect, useRef, useState } from 'react'

export function useGameSocket() {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => setMessages((prev) => [...prev, e.data])

    return () => ws.close()
  }, [])

  const send = (text: string) => wsRef.current?.send(text)

  return { connected, messages, send }
}