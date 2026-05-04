import type { PersistedThread } from './app-types'

type CopilotTitleThread = Pick<PersistedThread, 'latestCopilotTitle' | 'sessionName'>

export function normalizeCopilotTitle(
  thread: Pick<PersistedThread, 'sessionName'>,
  title: string | null | undefined
): string | null {
  const trimmedTitle = title?.trim()
  if (!trimmedTitle || trimmedTitle === thread.sessionName) {
    return null
  }
  return trimmedTitle
}

export function getCopilotTitle(
  thread: CopilotTitleThread,
  runtimeTitle: string | null | undefined
): string | null {
  return (
    normalizeCopilotTitle(thread, runtimeTitle) ??
    normalizeCopilotTitle(thread, thread.latestCopilotTitle)
  )
}
