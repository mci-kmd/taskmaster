import {
  FALLBACK_DKK_PER_USD,
  nanoAiuToCredits,
  nanoAiuToDkk,
  USD_PER_AI_CREDIT
} from '../../../../shared/ai-credits'

export const PROMPT_COST_BASIS = `Estimate: 1 credit = $${USD_PER_AI_CREDIT}, $1 = ${FALLBACK_DKK_PER_USD} DKK`

export function formatPromptDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** An amount of credits or DKK without a unit; tiny non-zero amounts show as "<0.01". */
export function formatCostAmount(amount: number): string {
  if (amount > 0 && amount < 0.01) return '<0.01'
  return amount.toFixed(amount < 100 ? 2 : 0)
}

/** Credits without a unit, for tables with a unit header. */
export function formatCredits(nanoAiu: number): string {
  return formatCostAmount(nanoAiuToCredits(nanoAiu))
}

export function formatPromptCredits(nanoAiu: number): string {
  return `${formatCredits(nanoAiu)} credits`
}

/** DKK estimate without a unit, for tables with a unit header. */
export function formatDkk(nanoAiu: number): string {
  const dkk = nanoAiuToDkk(nanoAiu)
  if (dkk > 0 && dkk < 0.01) return '<0.01'
  return dkk.toFixed(2)
}

export function formatPromptDkk(nanoAiu: number): string {
  const dkk = formatDkk(nanoAiu)
  return dkk.startsWith('<') ? `${dkk} DKK` : `≈${dkk} DKK`
}
