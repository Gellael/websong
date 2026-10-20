import { SongRoom } from './room'
import { SongRegistry } from './registry'
import type { Env } from './env'

export { SongRoom, SongRegistry }

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function originOk(req: Request, env: Env): boolean {
  const allowed = allowedOrigins(env)
  if (allowed.length === 0) return true // development
  return allowed.includes(req.headers.get('Origin') ?? '')
}

function registryOf(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName('main'))
}

/** Tolak masuk lewat WebSocket supaya frontend menampilkan pesannya (bukan mengulang koneksi). */
function rejectJoin(message: string): Response {
  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()
  server.send(JSON.stringify({ type: 'JoinFailed', message }))
  server.close(1000, 'join failed')
  return new Response(null, { status: 101, webSocket: client })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return new Response('ok')

    // daftar meja publik (maksimal 8)
    if (url.pathname === '/rooms') {
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      })
      const allowed = allowedOrigins(env)
      const origin = request.headers.get('Origin') ?? ''
      if (allowed.length === 0) headers.set('Access-Control-Allow-Origin', '*')
      else if (allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin)

      try {
        const tables = await registryOf(env).list()
        return new Response(JSON.stringify(tables), { headers })
      } catch (e) {
        console.warn('registry gagal:', e)
        return new Response('[]', { status: 503, headers })
      }
    }

    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    if (!originOk(request, env)) return new Response('Forbidden', { status: 403 })

    const room = (url.searchParams.get('room') ?? '').trim().toUpperCase().slice(0, 12)
    if (!room) return new Response('Kode room kosong', { status: 400 })

    // batas total 50 room: room baru ditolak kalau registry sudah penuh
    try {
      const ok = await registryOf(env).reserve(room)
      if (!ok) return rejectJoin('Server penuh, coba lagi nanti')
    } catch (e) {
      // registry bermasalah: jangan matikan permainan, lanjutkan saja
      console.warn('registry gagal:', e)
    }

    // satu kode room = satu Durable Object
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room))
    return stub.fetch(request)
  },
}