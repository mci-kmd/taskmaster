import type { CopilotModelSelection, CopilotReasoningEffort, ThreadCommitPhase } from './app-types'
import { REASONING_EFFORTS } from './reasoning-effort'

export const DEFAULT_COMMIT_MESSAGE_MODEL: CopilotModelSelection = {
  model: 'gpt-6-luna',
  reasoningEffort: 'medium'
}

export const COMMIT_SHORTCUT_LABEL = 'Ctrl+S'

export const COMMIT_PHASE_LABELS: Record<ThreadCommitPhase, string> = {
  generating: 'Writing commit message…',
  hook: 'Running pre-commit hook…',
  committing: 'Committing…',
  pushing: 'Pushing…'
}

export function normalizeCommitMessageModel(value: unknown): CopilotModelSelection | null {
  if (!value || typeof value !== 'object') return null
  const { model, reasoningEffort } = value as Record<string, unknown>
  if (typeof model !== 'string' || !model.trim()) return null
  if (
    reasoningEffort !== null &&
    !REASONING_EFFORTS.includes(reasoningEffort as CopilotReasoningEffort)
  )
    return null
  return { model: model.trim(), reasoningEffort: reasoningEffort as CopilotReasoningEffort | null }
}

export function resolveCommitMessageModel(repository: {
  commitMessageModel?: CopilotModelSelection
}): CopilotModelSelection {
  return normalizeCommitMessageModel(repository.commitMessageModel) ?? DEFAULT_COMMIT_MESSAGE_MODEL
}

export function isSameModelSelection(
  a: CopilotModelSelection | null | undefined,
  b: CopilotModelSelection | null | undefined
): boolean {
  return a?.model === b?.model && (a?.reasoningEffort ?? null) === (b?.reasoningEffort ?? null)
}
