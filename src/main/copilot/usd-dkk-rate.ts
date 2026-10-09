import { FALLBACK_DKK_PER_USD } from '../../shared/ai-credits'
import type { UsdDkkRate } from '../../shared/app-types'

// Free, keyless, daily-updated rates. Any failure keeps the fallback.
export const USD_RATES_URL = 'https://open.er-api.com/v6/latest/USD'
const LOOKUP_TIMEOUT_MS = 10_000

function parseRate(body: unknown): UsdDkkRate | null {
  if (!body || typeof body !== 'object') return null
  const data = body as { result?: unknown; rates?: unknown; time_last_update_unix?: unknown }
  if (data.result !== 'success' || !data.rates || typeof data.rates !== 'object') return null
  const dkkPerUsd = (data.rates as Record<string, unknown>).DKK
  // Reject implausible values so a bad response can't distort estimates.
  if (typeof dkkPerUsd !== 'number' || !Number.isFinite(dkkPerUsd)) return null
  if (dkkPerUsd < 1 || dkkPerUsd > 50) return null
  const updatedAt =
    typeof data.time_last_update_unix === 'number' && Number.isFinite(data.time_last_update_unix)
      ? new Date(data.time_last_update_unix * 1000).toISOString()
      : null
  return { dkkPerUsd, source: 'live', updatedAt }
}

export function createUsdDkkRate(fetchRates: typeof fetch = fetch): {
  get: () => UsdDkkRate
  refresh: () => Promise<void>
} {
  let rate: UsdDkkRate = { dkkPerUsd: FALLBACK_DKK_PER_USD, source: 'fallback', updatedAt: null }
  return {
    get: () => rate,
    refresh: async () => {
      try {
        const response = await fetchRates(USD_RATES_URL, {
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
        })
        if (!response.ok) return
        const live = parseRate(await response.json())
        if (live) rate = live
      } catch {
        // Offline or unavailable: keep the current rate silently.
      }
    }
  }
}
