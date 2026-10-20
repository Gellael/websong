import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'

/** Total room yang boleh ada sekaligus. */
export const MAX_ROOMS = 50
/** Jumlah meja yang ditampilkan di halaman utama. */
export const MAX_LISTED = 8
/** Catatan room yang tidak diperbarui selama ini dianggap sudah mati. */
const STALE_MS = 30 * 60 * 1000

/** Data yang dilaporkan tiap room ke registry. */
export interface RoomInfo {
  host: string
  joined: number
  scoreLimit: number
  status: 'waiting' | 'playing'
  isPublic: boolean
  online: boolean // ada pemain manusia yang sedang terhubung
  gameOver: boolean
}

/** Bentuk yang dikirim ke frontend (sama dengan TableInfo di types.ts). */
export interface TableInfo {
  room: string
  host: string
  joined: number
  scoreLimit: number
  status: 'waiting' | 'playing'
}

interface Entry extends RoomInfo {
  updatedAt: number
}

/**
 * Satu instance (idFromName('main')) yang mencatat semua room aktif.
 * Dipakai untuk dua hal: membatasi total room (50) dan menampilkan daftar meja (8).
 */
export class SongRegistry extends DurableObject<Env> {
  private rooms = new Map<string, Entry>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<Map<string, Entry>>('rooms')
      if (saved) this.rooms = saved
    })
  }

  private prune(): boolean {
    const cutoff = Date.now() - STALE_MS
    let changed = false
    for (const [code, e] of this.rooms) {
      if (e.updatedAt < cutoff) {
        this.rooms.delete(code)
        changed = true
      }
    }
    return changed
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('rooms', this.rooms)
  }

  /** Dipanggil sebelum pemain masuk. false = server sudah penuh (50 room). */
  async reserve(code: string): Promise<boolean> {
    this.prune()
    const existing = this.rooms.get(code)
    if (existing) {
      existing.updatedAt = Date.now()
      await this.save()
      return true
    }
    if (this.rooms.size >= MAX_ROOMS) {
      await this.save()
      return false
    }
    this.rooms.set(code, {
      host: '',
      joined: 0,
      scoreLimit: 0,
      status: 'waiting',
      isPublic: false,
      online: true,
      gameOver: false,
      updatedAt: Date.now(),
    })
    await this.save()
    return true
  }

  /** Room melaporkan keadaan terbarunya. */
  async report(code: string, info: RoomInfo): Promise<void> {
    this.prune()
    if (!this.rooms.has(code) && this.rooms.size >= MAX_ROOMS) return
    this.rooms.set(code, { ...info, updatedAt: Date.now() })
    await this.save()
  }

  /** Room sudah dihapus. */
  async release(code: string): Promise<void> {
    if (this.rooms.delete(code)) await this.save()
  }

  /** Daftar meja publik: yang masih menunggu di atas, maksimal MAX_LISTED. */
  async list(): Promise<TableInfo[]> {
    if (this.prune()) await this.save()
    const out: TableInfo[] = []
    for (const [room, e] of this.rooms) {
      if (!e.isPublic || !e.online || e.gameOver || e.joined < 1) continue
      out.push({
        room,
        host: e.host,
        joined: e.joined,
        scoreLimit: e.scoreLimit,
        status: e.status,
      })
    }
    out.sort(
      (a, b) =>
        Number(b.status === 'waiting') - Number(a.status === 'waiting') ||
        b.joined - a.joined ||
        a.room.localeCompare(b.room),
    )
    return out.slice(0, MAX_LISTED)
  }
}