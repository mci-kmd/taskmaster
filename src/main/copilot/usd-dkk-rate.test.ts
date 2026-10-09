import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_DKK_PER_USD } from '../../shared/ai-credits'
import { createUsdDkkRate, USD_RATES_URL } from './usd-dkk-rate'

const response = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as unknown as Response

describe('USD to DKK rate', () => {
  it('starts with the fallback and switches to a looked-up rate', async () => {
    const fetchRates = vi.fn(async () =>
      response({ result: 'success', time_last_update_unix: 1_790_000_000, rates: { DKK: 6.41 } })
    )
    const rate = createUsdDkkRate(fetchRates as unknown as typeof fetch)
    expect(rate.get()).toEqual({
      dkkPerUsd: FALLBACK_DKK_PER_USD,
      source: 'fallback',
      updatedAt: null
    })
    await rate.refresh()
    expect(fetchRates).toHaveBeenCalledWith(USD_RATES_URL, expect.anything())
    expect(rate.get()).toEqual({
      dkkPerUsd: 6.41,
      source: 'live',
      updatedAt: new Date(1_790_000_000_000).toISOString()
    })
  })

  it.each([
    ['network errors', async () => Promise.reject(new Error('offline'))],
    ['HTTP errors', async () => response({}, false)],
    ['error results', async () => response({ result: 'error' })],
    ['missing rates', async () => response({ result: 'success', rates: {} })],
    ['implausible rates', async () => response({ result: 'success', rates: { DKK: 0 } })],
    [
      'invalid JSON',
      async () => ({ ok: true, json: async () => JSON.parse('{') }) as unknown as Response
    ]
  ])('silently keeps the fallback on %s', async (_name, fetchRates) => {
    const rate = createUsdDkkRate(fetchRates as unknown as typeof fetch)
    await expect(rate.refresh()).resolves.toBeUndefined()
    expect(rate.get()).toEqual({
      dkkPerUsd: FALLBACK_DKK_PER_USD,
      source: 'fallback',
      updatedAt: null
    })
  })
})
