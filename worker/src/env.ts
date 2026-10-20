import type { SongRegistry } from './registry'

export interface Env {
  ROOMS: DurableObjectNamespace
  REGISTRY: DurableObjectNamespace<SongRegistry>
  ALLOWED_ORIGINS: string
}