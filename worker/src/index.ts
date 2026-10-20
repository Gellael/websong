import { SongRoom } from './room'
import type { Env } from './env'

export { SongRoom }

function originOk(req: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowed.length === 0) return true // development
  return allowed.includes(req.headers.get('Origin') ?? '')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    if (!originOk(request, env)) return new Response('Forbidden', { status: 403 })

    const room = (url.searchParams.get('room') ?? '').trim().toUpperCase().slice(0, 12)
    if (!room) return new Response('Kode room kosong', { status: 400 })

    // satu kode room = satu Durable Object
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room))
    return stub.fetch(request)
  },
}