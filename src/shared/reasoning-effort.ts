import type { CopilotReasoningEffort } from './app-types'

/** From least to most reasoning. */
export const REASONING_EFFORTS: readonly CopilotReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

export function reasoningEffortLabel(value: CopilotReasoningEffort): string {
  return value === 'xhigh'
    ? 'Extra high'
    : value === 'max'
      ? 'Maximum'
      : value[0].toUpperCase() + value.slice(1)
}

/**
 * The next supported effort above (`1`) or below (`-1`) the current one, where no explicit
 * effort means the model's default. Null at either end or when the model has no efforts.
 */
export function stepReasoningEffort(
  supported: readonly CopilotReasoningEffort[],
  current: CopilotReasoningEffort | null,
  defaultEffort: CopilotReasoningEffort | null,
  direction: 1 | -1
): CopilotReasoningEffort | null {
  const efforts = REASONING_EFFORTS.filter((effort) => supported.includes(effort))
  if (!efforts.length) return null
  const from = current ?? defaultEffort
  const rank = from ? REASONING_EFFORTS.indexOf(from) : -1
  if (rank < 0) return direction === 1 ? efforts[0] : null
  const next =
    direction === 1
      ? efforts.find((effort) => REASONING_EFFORTS.indexOf(effort) > rank)
      : efforts.findLast((effort) => REASONING_EFFORTS.indexOf(effort) < rank)
  return next ?? null
}
