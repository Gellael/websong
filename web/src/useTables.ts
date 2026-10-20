import { useEffect, useState } from 'react'
import type { TableInfo } from './types'

export const MAX_VISIBLE_TABLES = 8

const wsUrl: string | undefined = import.meta.env.VITE_WS_URL
const apiBase = wsUrl ? wsUrl.replace(/^ws/, 'http').replace(/\/ws\/?$/, '') : ''

export function useTables(intervalMs = 5000, enabled = true) {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let timer: number | undefined
    const ctrl = new AbortController()

    const load = async () => {
      if (document.hidden) {
        timer = window.setTimeout(load, intervalMs)
        return
      }
      try {
        const res = await fetch(`${apiBase}/rooms`, { signal: ctrl.signal })
        if (!res.ok) throw new Error(String(res.status))
        const data: TableInfo[] = await res.json()
        if (!stopped) {
          setTables(data.slice(0, MAX_VISIBLE_TABLES))
          setFailed(false)
        }
      } catch {
        if (!stopped) setFailed(true)
      } finally {
        if (!stopped) {
          setLoading(false)
          timer = window.setTimeout(load, intervalMs)
        }
      }
    }

    load()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [intervalMs, enabled])

  return { tables, loading, failed }
}