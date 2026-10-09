/** SDK usage is reported in nano-AI units; 1 GitHub AI credit = 1e9 nano-AIU. */
export const NANO_AIU_PER_AI_CREDIT = 1e9
/** 1 GitHub AI credit = $0.01 USD (docs.github.com, usage-based billing for individuals). */
export const USD_PER_AI_CREDIT = 0.01
/**
 * ECB reference rate on 2026-09-29. DKK is pegged to EUR, so this only drifts with EUR/USD.
 * Used until (or if) the live rate lookup at startup succeeds.
 */
export const FALLBACK_DKK_PER_USD = 6.58

export function nanoAiuToCredits(nanoAiu: number): number {
  return nanoAiu / NANO_AIU_PER_AI_CREDIT
}

export function nanoAiuToDkk(nanoAiu: number, dkkPerUsd = FALLBACK_DKK_PER_USD): number {
  return nanoAiuToCredits(nanoAiu) * USD_PER_AI_CREDIT * dkkPerUsd
}
