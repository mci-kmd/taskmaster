export const DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS = 50_000
export const AUTO_COMPACT_THRESHOLD_MIN_TOKENS = 1_000
export const AUTO_COMPACT_THRESHOLD_MAX_TOKENS = 1_000_000

/**
 * Resolves the persisted setting into the active token threshold, or `null` when disabled.
 * Absent (`undefined`) uses the default threshold.
 */
export function resolveAutoCompactThresholdTokens(value: number | null | undefined): number | null {
  if (value === null) return null
  if (value === undefined) return DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.min(
    AUTO_COMPACT_THRESHOLD_MAX_TOKENS,
    Math.max(AUTO_COMPACT_THRESHOLD_MIN_TOKENS, Math.round(value))
  )
}

/**
 * Normalizes a persisted or incoming threshold value for storage.
 * Returns `undefined` for the default (omitted on disk) and `null` when explicitly disabled.
 */
export function normalizeAutoCompactThresholdTokens(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === 0) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  const clamped = Math.min(
    AUTO_COMPACT_THRESHOLD_MAX_TOKENS,
    Math.max(AUTO_COMPACT_THRESHOLD_MIN_TOKENS, Math.round(value))
  )
  return clamped === DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS ? undefined : clamped
}

export function formatTokenCount(tokens: number): string {
  const safe = Math.max(0, Math.round(tokens))
  if (safe < 1_000) return String(safe)
  if (safe < 100_000) {
    const k = Number((safe / 1_000).toFixed(1))
    return `${k}k`
  }
  return `${Math.round(safe / 1_000)}k`
}

export function formatContextUsage(contextTokens: number, tokenLimit?: number | null): string {
  const current = formatTokenCount(contextTokens)
  if (typeof tokenLimit === 'number' && Number.isFinite(tokenLimit) && tokenLimit > 0) {
    return `${current} / ${formatTokenCount(tokenLimit)} tokens`
  }
  return `${current} tokens`
}

/** Returns true only when a known cache expiration timestamp is in the past. */
export function isCacheStale(
  cacheExpiresAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (typeof cacheExpiresAt !== 'string' || !cacheExpiresAt) return false
  const expiresAtMs = Date.parse(cacheExpiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs
}

export function shouldAutoCompact(params: {
  contextTokens: number | null | undefined
  cacheExpiresAt: string | null | undefined
  thresholdTokens: number | null
  nowMs?: number
}): boolean {
  const { contextTokens, cacheExpiresAt, thresholdTokens, nowMs } = params
  if (thresholdTokens === null || !Number.isFinite(thresholdTokens) || thresholdTokens <= 0) {
    return false
  }
  if (typeof contextTokens !== 'number' || !Number.isFinite(contextTokens)) return false
  if (contextTokens <= thresholdTokens) return false
  return isCacheStale(cacheExpiresAt, nowMs)
}
