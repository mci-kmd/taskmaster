import type { PersistedThread } from './app-types'

type CopilotTitleThread = Pick<PersistedThread, 'latestCopilotTitle'>

export function normalizeCopilotTitle(title: string | null | undefined): string | null {
  const trimmedTitle = title?.trim()
  if (!trimmedTitle) {
    return null
  }
  return trimmedTitle
}

export function getCopilotTitle(
  thread: CopilotTitleThread,
  runtimeTitle: string | null | undefined
): string | null {
  return normalizeCopilotTitle(runtimeTitle) ?? normalizeCopilotTitle(thread.latestCopilotTitle)
}
