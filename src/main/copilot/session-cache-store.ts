import { createSessionRecordStore } from './session-record-store'

// Usage and cache-expiration events are ephemeral in the runtime, so the latest
// known per-session cache/context state is kept here across restarts.
export interface SessionCacheRecord {
  sessionId: string
  /** Fixed per session (`sessionId`) so newer writes replace older ones on load. */
  id: string
  /** Latest known cache expiration timestamps keyed by model id. */
  cacheByModel: Record<string, string>
  contextTokens: number | null
  tokenLimit: number | null
  updatedAt: string
}

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function isCacheByModel(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || typeof entry !== 'string' || !Number.isFinite(Date.parse(entry))) return false
  }
  return true
}

function isRecord(value: unknown): value is SessionCacheRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sessionId === 'string' &&
    typeof record.id === 'string' &&
    isCacheByModel(record.cacheByModel) &&
    (record.contextTokens === null || isFiniteNonNegative(record.contextTokens)) &&
    (record.tokenLimit === null || isFiniteNonNegative(record.tokenLimit)) &&
    typeof record.updatedAt === 'string' &&
    Number.isFinite(Date.parse(record.updatedAt))
  )
}

export function createSessionCacheStore(path: string): {
  getCacheState: (sessionId: string) => SessionCacheRecord | null
  saveCacheState: (record: SessionCacheRecord) => void
} {
  const store = createSessionRecordStore(path, isRecord, 'session cache state')
  return {
    getCacheState: (sessionId: string) => store.getRecords(sessionId).at(-1) ?? null,
    saveCacheState: store.saveRecord
  }
}
