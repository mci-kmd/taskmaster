// 1 GitHub AI credit = $0.01 USD (docs.github.com, usage-based billing for individuals).
const USD_PER_AI_CREDIT = 0.01
// ECB reference rate on 2026-09-29. DKK is pegged to EUR, so this only drifts with EUR/USD.
const DKK_PER_USD = 6.58

export const PROMPT_COST_BASIS = `Estimate: 1 credit = $${USD_PER_AI_CREDIT}, $1 = ${DKK_PER_USD} DKK`

export function formatPromptDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatPromptCredits(nanoAiu: number): string {
  const credits = nanoAiu / 1e9
  if (credits > 0 && credits < 0.01) return '<0.01 credits'
  return `${credits.toFixed(credits < 100 ? 2 : 0)} credits`
}

export function formatPromptDkk(nanoAiu: number): string {
  const dkk = (nanoAiu / 1e9) * USD_PER_AI_CREDIT * DKK_PER_USD
  if (dkk > 0 && dkk < 0.01) return '<0.01 DKK'
  return `≈${dkk.toFixed(2)} DKK`
}
