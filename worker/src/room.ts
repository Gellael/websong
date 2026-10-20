import { DurableObject } from 'cloudflare:workers'
import wasmModule from '../pkg/song_wasm_bg.wasm'
import { initSync, new_game, apply as wasmApply, view_for } from '../pkg/song_wasm.js'
import type { Env } from './env'

initSync({ module: wasmModule })

const PLAYERS = 5
const IDLE_MS = 10 * 60 * 1000 // room yang ditinggal semua pemain dihapus setelah 10 menit

interface Seat {
  token: string
  name: string
}

interface RoomData {
  seats: (Seat | null)[]
  totals: number[]
  scored: boolean
  game: string | null // GameState dalam JSON (dikelola oleh WASM)
}

interface Attachment {
  seat: number
  cid: string // id koneksi, untuk membedakan koneksi lama dan baru di kursi yang sama
}

const emptyRoom = (): RoomData => ({
  seats: Array(PLAYERS).fill(null),
  totals: Array(PLAYERS).fill(0),
  scored: false,
  game: null,
})

function randomToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function cleanName(raw: string | null): string {
  const n = Array.from((raw ?? '').trim()).slice(0, 16).join('')
  return n || 'Pemain'
}

export class SongRoom extends DurableObject<Env> {
  private data: RoomData = emptyRoom()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // muat state dari storage (penting setelah objek bangun dari hibernasi)
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<RoomData>('data')
      if (saved) this.data = saved
    })
    // ping dari client dijawab tanpa membangunkan objek
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"Ping"}', '{"type":"Pong"}'),
    )
  }

  // ---------- koneksi baru ----------
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const url = new URL(request.url)
    const name = cleanName(url.searchParams.get('name'))
    const token = url.searchParams.get('token')

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)

    const joined = this.join(token, name)
    if ('error' in joined) {
      this.send(server, { type: 'JoinFailed', message: joined.error })
      server.close(1000, 'join failed')
      return new Response(null, { status: 101, webSocket: client })
    }

    const cid = crypto.randomUUID()
    const att: Attachment = { seat: joined.seat, cid }
    server.serializeAttachment(att)

    // koneksi lama di kursi yang sama (mis. refresh) ditutup
    for (const { ws, att: other } of this.liveSockets()) {
      if (other.seat === joined.seat && other.cid !== cid) {
        try {
          ws.close(1000, 'replaced')
        } catch {
          /* abaikan */
        }
      }
    }

    await this.ctx.storage.deleteAlarm()
    this.send(server, { type: 'Joined', token: joined.token, seat: joined.seat })
    await this.broadcast()
    return new Response(null, { status: 101, webSocket: client })
  }

  private join(
    token: string | null,
    name: string,
  ): { seat: number; token: string } | { error: string } {
    const d = this.data
    if (token) {
      const i = d.seats.findIndex((s) => s !== null && s.token === token)
      if (i >= 0) return { seat: i, token }
    }
    if (d.game !== null) return { error: 'Permainan di room ini sudah berjalan' }
    const free = d.seats.findIndex((s) => s === null)
    if (free < 0) return { error: 'Room penuh' }
    const t = token && token.length >= 16 && token.length <= 64 ? token : randomToken()
    d.seats[free] = { token: t, name }
    return { seat: free, token: t }
  }

  // ---------- pesan dari pemain ----------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att) return
    const d = this.data

    let msg: { type?: string }
    try {
      msg = JSON.parse(message)
    } catch {
      this.send(ws, { type: 'Error', message: 'Pesan tidak dikenali' })
      return
    }
    if (msg.type === 'Ping') return

    if (msg.type === 'NextRound') {
      const over = d.game !== null && JSON.parse(d.game).phase === 'Over'
      if (!over) {
        this.send(ws, { type: 'Error', message: 'Ronde belum selesai' })
        return
      }
      this.startRound()
      await this.broadcast()
      return
    }

    if (d.game === null) {
      this.send(ws, { type: 'Error', message: 'Game belum dimulai' })
      return
    }
    const out = JSON.parse(wasmApply(d.game, att.seat, message)) as {
      error: string | null
      state: unknown
    }
    if (out.error) {
      this.send(ws, { type: 'Error', message: out.error })
      return
    }
    d.game = JSON.stringify(out.state)
    await this.broadcast()
  }

  // ---------- koneksi putus ----------
  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onGone(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws)
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att) return
    const d = this.data

    const stillThere = this.liveSockets(att.cid).some((l) => l.att.seat === att.seat)
    if (!stillThere && d.game === null) d.seats[att.seat] = null // belum mulai: bebaskan kursi

    await this.broadcast(att.cid)

    if (this.liveSockets(att.cid).length === 0) {
      if (d.game !== null) {
        await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
      } else if (d.seats.every((s) => s === null)) {
        await this.ctx.storage.deleteAll()
        this.data = emptyRoom()
      }
    }
  }

  // room yang ditinggal semua pemain selama 10 menit dihapus
  async alarm(): Promise<void> {
    if (this.liveSockets().length === 0) {
      await this.ctx.storage.deleteAll()
      this.data = emptyRoom()
    }
  }

  // ---------- logika room ----------
  private startRound(): void {
    const d = this.data
    let starter = -1
    if (d.game !== null) {
      // pemain tepat di bawah pemain dengan skor total terkecil
      let lowest = 0
      for (let i = 1; i < PLAYERS; i++) if (d.totals[i] < d.totals[lowest]) lowest = i
      starter = (lowest + 1) % PLAYERS
    }
    const seed = new Uint32Array(2)
    crypto.getRandomValues(seed)
    d.game = new_game(seed[0], seed[1], starter)
    d.scored = false
  }

  /** Jumlahkan skor ronde ke total, tepat satu kali per ronde. */
  private settle(): void {
    const d = this.data
    if (d.scored || d.game === null) return
    const g = JSON.parse(d.game)
    if (g.phase === 'Over' && g.result) {
      for (let i = 0; i < PLAYERS; i++) d.totals[i] += g.result.scores[i]
      d.scored = true
    }
  }

  private liveSockets(excludeCid?: string): { ws: WebSocket; att: Attachment }[] {
    const out: { ws: WebSocket; att: Attachment }[] = []
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (!att || att.cid === excludeCid) continue
      out.push({ ws, att })
    }
    return out
  }

  private send(ws: WebSocket, msg: object): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* koneksi sudah putus */
    }
  }

  private async broadcast(excludeCid?: string): Promise<void> {
    const d = this.data
    const joined = d.seats.filter((s) => s !== null).length
    if (d.game === null && joined === PLAYERS) this.startRound()
    this.settle()

    const names = d.seats.map((s) => s?.name ?? '')
    const live = this.liveSockets(excludeCid)
    const online = d.seats.map((_, i) => live.some((l) => l.att.seat === i))

    for (const { ws, att } of live) {
      if (d.game !== null) {
        const view = JSON.parse(view_for(d.game, att.seat))
        this.send(ws, { type: 'State', view, totals: d.totals, names, online })
      } else {
        this.send(ws, { type: 'Waiting', seat: att.seat, joined, names })
      }
    }
    await this.ctx.storage.put('data', d)
  }
}