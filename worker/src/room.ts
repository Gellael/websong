import { DurableObject } from 'cloudflare:workers'
import wasmModule from '../pkg/song_wasm_bg.wasm'
import {
  initSync,
  new_game,
  apply as wasmApply,
  view_for,
  bot_action,
} from '../pkg/song_wasm.js'
import type { Env } from './env'

initSync({ module: wasmModule })

const PLAYERS = 5
const IDLE_MS = 10 * 60 * 1000 // room yang ditinggal semua pemain dihapus setelah 10 menit
const GRACE_MS = 30 * 1000 // pemain terputus diberi 30 detik sebelum bot mengambil kursinya
const BOT_DELAY_MS = 1200 // jeda tiap langkah bot supaya terlihat wajar
const MAX_BOT_FAILS = 5 // bot berhenti mencoba kalau gagal terus (mencegah loop tanpa akhir)
const MAX_SCORE_LIMIT = 10_000

interface Seat {
  token: string
  name: string
  bot: boolean // true = kursi dimainkan bot; pemain asli atau pemain baru bisa merebutnya
  leftAt: number | null // kapan pemain terputus (null = terhubung), untuk hitung mundur 30 detik
}

interface RoomData {
  seats: (Seat | null)[]
  totals: number[]
  scored: boolean
  game: string | null // GameState dalam JSON (dikelola oleh WASM)
  botAt: number | null // kapan bot boleh melangkah
  idleAt: number | null // kapan room yang ditinggal semua pemain dihapus
  botFails: number // jumlah kegagalan bot berturut-turut
  hostToken: string | null // pembuat room: satu-satunya yang boleh menekan Mulai
  scoreLimit: number // 0 = tanpa batas
  gameOver: boolean
  gameWinner: number | null
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
  botAt: null,
  idleAt: null,
  botFails: 0,
  hostToken: null,
  scoreLimit: 0,
  gameOver: false,
  gameWinner: null,
})

/** Data lama (sebelum ada bot/host) tidak punya field baru; lengkapi di sini. */
function normalize(saved: RoomData): RoomData {
  return {
    ...saved,
    seats: saved.seats.map((s) => s && { ...s, bot: s.bot ?? false, leftAt: s.leftAt ?? null }),
    botAt: saved.botAt ?? null,
    idleAt: saved.idleAt ?? null,
    botFails: saved.botFails ?? 0,
    hostToken: saved.hostToken ?? null,
    scoreLimit: saved.scoreLimit ?? 0,
    gameOver: saved.gameOver ?? false,
    gameWinner: saved.gameWinner ?? null,
  }
}

function randomToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function cleanName(raw: string | null): string {
  const n = Array.from((raw ?? '').trim()).slice(0, 16).join('')
  return n || 'Pemain'
}

function cleanLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_SCORE_LIMIT) : 0
}

export class SongRoom extends DurableObject<Env> {
  private data: RoomData = emptyRoom()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // muat state dari storage (penting setelah objek bangun dari hibernasi)
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<RoomData>('data')
      if (saved) this.data = normalize(saved)
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
    const limit = cleanLimit(url.searchParams.get('limit'))

    const wasEmpty = this.liveSockets().length === 0

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

    // orang pertama di room baru = pembuat room, dan dialah yang menentukan batas skor
    if (this.data.hostToken === null) {
      this.data.hostToken = joined.token
      this.data.scoreLimit = limit
    }

    // room baru "bangun" dari jeda: pemain lain yang belum kembali dapat 30 detik baru
    if (wasEmpty) {
      const now = Date.now()
      this.data.seats.forEach((s, i) => {
        if (s && !s.bot && s.leftAt !== null && i !== joined.seat) s.leftAt = now
      })
    }

    this.send(server, { type: 'Joined', token: joined.token, seat: joined.seat })
    await this.broadcast()
    return new Response(null, { status: 101, webSocket: client })
  }

  private join(
    token: string | null,
    name: string,
  ): { seat: number; token: string } | { error: string } {
    const d = this.data

    // 1) pemain lama kembali dengan tokennya: ambil kursinya lagi (dari bot kalau sudah diambil alih)
    if (token) {
      const i = d.seats.findIndex((s) => s !== null && s.token === token)
      if (i >= 0) {
        const s = d.seats[i]!
        s.bot = false
        s.leftAt = null
        d.botFails = 0
        return { seat: i, token }
      }
    }

    const t = token && token.length >= 16 && token.length <= 64 ? token : randomToken()

    // 2) permainan sedang berjalan: pemain baru hanya bisa mengisi kursi yang dipegang bot.
    //    Kalau ada kursi bot dengan nama yang sama, utamakan itu.
    if (d.game !== null) {
      const botSeats: number[] = []
      d.seats.forEach((s, i) => {
        if (s?.bot) botSeats.push(i)
      })
      if (botSeats.length === 0) {
        return { error: 'Permainan sudah berjalan dan tidak ada kursi kosong' }
      }
      const same = botSeats.find((i) => d.seats[i]!.name.toLowerCase() === name.toLowerCase())
      const i = same ?? botSeats[0]
      d.seats[i] = { token: t, name, bot: false, leftAt: null }
      d.botFails = 0
      return { seat: i, token: t }
    }

    // 3) belum mulai: ambil kursi kosong
    const free = d.seats.findIndex((s) => s === null)
    if (free < 0) return { error: 'Room penuh' }
    d.seats[free] = { token: t, name, bot: false, leftAt: null }
    return { seat: free, token: t }
  }

  // ---------- pesan dari pemain ----------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att) return
    const d = this.data

    let msg: { type?: string; scoreLimit?: unknown }
    try {
      msg = JSON.parse(message)
    } catch {
      this.send(ws, { type: 'Error', message: 'Pesan tidak dikenali' })
      return
    }
    if (msg.type === 'Ping') return

    // pembuat room memulai permainan; kursi kosong diisi bot
    if (msg.type === 'StartGame') {
      if (d.game !== null) {
        this.send(ws, { type: 'Error', message: 'Permainan sudah berjalan' })
        return
      }
      const seat = d.seats[att.seat]
      if (!seat || seat.token !== d.hostToken) {
        this.send(ws, { type: 'Error', message: 'Hanya pembuat room yang bisa memulai' })
        return
      }
      if (d.seats.filter((s) => s !== null).length < 2) {
        this.send(ws, { type: 'Error', message: 'Minimal 2 pemain untuk memulai' })
        return
      }
      if (msg.scoreLimit !== undefined) d.scoreLimit = cleanLimit(msg.scoreLimit)
      d.seats = d.seats.map(
        (s, i) => s ?? { token: randomToken(), name: `Bot ${i + 1}`, bot: true, leftAt: null },
      )
      this.startRound()
      d.botFails = 0
      await this.broadcast()
      return
    }

    if (msg.type === 'NextRound') {
      if (d.gameOver) {
        this.send(ws, { type: 'Error', message: 'Permainan sudah berakhir' })
        return
      }
      const over = d.game !== null && JSON.parse(d.game).phase === 'Over'
      if (!over) {
        this.send(ws, { type: 'Error', message: 'Ronde belum selesai' })
        return
      }
      this.startRound()
      d.botFails = 0
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
    d.botFails = 0
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
    if (!stillThere) {
      const seat = d.seats[att.seat]
      if (seat) {
        if (d.game === null) {
          d.seats[att.seat] = null // belum mulai: bebaskan kursi
        } else if (!seat.bot) {
          seat.leftAt = Date.now() // sedang main: mulai hitung mundur 30 detik
        }
      }
    }

    await this.broadcast(att.cid)
  }

  // ---------- alarm: 30 detik habis, giliran bot, atau room ditinggal ----------
  async alarm(): Promise<void> {
    const d = this.data
    const now = Date.now()

    // tidak ada manusia sama sekali: permainan dijeda, hanya cek penghapusan room
    if (this.liveSockets().length === 0) {
      if (d.idleAt !== null && now >= d.idleAt) {
        await this.ctx.storage.deleteAll()
        this.data = emptyRoom()
      }
      return
    }

    let changed = false

    // pemain yang 30 detik tidak kembali: kursinya diambil bot
    for (const s of d.seats) {
      if (s && !s.bot && s.leftAt !== null && now >= s.leftAt + GRACE_MS) {
        s.bot = true
        s.leftAt = null
        changed = true
      }
    }

    // giliran bot
    if (d.botAt !== null && now >= d.botAt && this.botTurn()) {
      d.botAt = null
      this.botStep()
      changed = true
    }

    if (changed) await this.broadcast()
    else await this.plan()
  }

  // ---------- logika bot ----------
  /**
   * Kursi bot yang harus bergerak sekarang, atau -1 kalau tidak ada.
   * Fase Playing: kursi yang gilirannya. Fase Opening: semua pemain hidup menurunkan
   * seri pembuka bersamaan (tanpa giliran), jadi cari bot yang belum menurunkannya.
   */
  private botSeatToMove(): number {
    const d = this.data
    if (d.game === null || d.gameOver) return -1
    const g = JSON.parse(d.game) as {
      phase: 'Opening' | 'Playing' | 'Over'
      turn: number
      alive: boolean[]
      pending: (unknown[] | null)[]
    }
    if (g.phase === 'Over') return -1
    if (g.phase === 'Playing') return d.seats[g.turn]?.bot === true ? g.turn : -1
    return d.seats.findIndex((s, i) => s?.bot === true && g.alive[i] && g.pending[i] === null)
  }

  private botTurn(): boolean {
    return this.botSeatToMove() >= 0
  }

  /** Satu langkah bot. Kalau gagal, hitung kegagalan supaya tidak berputar selamanya. */
  private botStep(): void {
    const d = this.data
    if (d.game === null) return
    try {
      const seat = this.botSeatToMove()
      if (seat < 0) return
      const action = bot_action(d.game, seat)
      if (!action) throw new Error('bot tidak punya langkah')
      const out = JSON.parse(wasmApply(d.game, seat, action)) as {
        error: string | null
        state: unknown
      }
      if (out.error) throw new Error(out.error)
      d.game = JSON.stringify(out.state)
      d.botFails = 0
    } catch (e) {
      d.botFails += 1
      console.warn('bot gagal:', e)
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

  /** Jumlahkan skor ronde ke total (sekali per ronde), lalu cek batas skor. */
  private settle(): void {
    const d = this.data
    if (d.scored || d.game === null) return
    const g = JSON.parse(d.game)
    if (g.phase === 'Over' && g.result) {
      for (let i = 0; i < PLAYERS; i++) d.totals[i] += g.result.scores[i]
      d.scored = true
      if (d.scoreLimit > 0 && d.totals.some((t) => t >= d.scoreLimit)) {
        let w = 0
        for (let i = 1; i < PLAYERS; i++) if (d.totals[i] < d.totals[w]) w = i
        d.gameOver = true
        d.gameWinner = w // skor terkecil menang
      }
    }
  }

  /** Sebelum mulai: kalau pembuat room keluar, pemain tersisa pertama jadi pembuat. */
  private ensureHost(): void {
    const d = this.data
    if (d.game !== null) return
    if (d.seats.some((s) => s !== null && s.token === d.hostToken)) return
    d.hostToken = d.seats.find((s) => s !== null)?.token ?? null
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

  /**
   * Atur alarm berikutnya dan simpan state.
   * Mengembalikan true kalau room dihapus (tidak ada yang perlu disimpan lagi).
   */
  private async plan(excludeCid?: string): Promise<boolean> {
    const d = this.data
    const now = Date.now()
    const live = this.liveSockets(excludeCid)
    const times: number[] = []

    if (live.length === 0) {
      // tidak ada manusia: permainan dijeda (bot tidak jalan sendiri), room dihapus setelah IDLE_MS
      d.botAt = null
      if (d.game === null) {
        if (d.seats.every((s) => s === null)) {
          await this.ctx.storage.deleteAll()
          this.data = emptyRoom()
          return true
        }
      } else {
        if (d.idleAt === null) d.idleAt = now + IDLE_MS
        times.push(d.idleAt)
      }
    } else {
      d.idleAt = null

      // hitung mundur 30 detik untuk kursi manusia yang terputus
      const online = new Set(live.map((l) => l.att.seat))
      d.seats.forEach((s, i) => {
        if (!s || s.bot || d.game === null) return
        if (online.has(i)) s.leftAt = null
        else if (s.leftAt === null) s.leftAt = now // koneksi hilang tanpa event close
        if (s.leftAt !== null) times.push(s.leftAt + GRACE_MS)
      })

      // jadwalkan langkah bot kalau sekarang giliran kursi bot
      if (this.botTurn() && d.botFails < MAX_BOT_FAILS) {
        if (d.botAt === null) d.botAt = now + BOT_DELAY_MS
        times.push(d.botAt)
      } else {
        d.botAt = null
      }
    }

    if (times.length > 0) await this.ctx.storage.setAlarm(Math.min(...times))
    else await this.ctx.storage.deleteAlarm()

    await this.ctx.storage.put('data', d)
    return false
  }

  private async broadcast(excludeCid?: string): Promise<void> {
    const d = this.data
    this.ensureHost()
    this.settle()

    const joined = d.seats.filter((s) => s !== null).length
    const names = d.seats.map((s) => s?.name ?? '')
    const bots = d.seats.map((s) => s?.bot === true)
    const live = this.liveSockets(excludeCid)
    const online = d.seats.map((_, i) => live.some((l) => l.att.seat === i))

    for (const { ws, att } of live) {
      if (d.game !== null) {
        const view = JSON.parse(view_for(d.game, att.seat))
        this.send(ws, {
          type: 'State',
          view,
          totals: d.totals,
          names,
          online,
          bots,
          scoreLimit: d.scoreLimit,
          gameOver: d.gameOver,
          gameWinner: d.gameWinner,
        })
      } else {
        const isHost = d.seats[att.seat]?.token === d.hostToken
        this.send(ws, {
          type: 'Waiting',
          seat: att.seat,
          joined,
          names,
          isHost,
          scoreLimit: d.scoreLimit,
        })
      }
    }
    await this.plan(excludeCid)
  }
}