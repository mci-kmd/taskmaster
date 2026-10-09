import type { PersistedThread } from './app-types'

type CopilotTitleThread = Pick<PersistedThread, 'latestCopilotTitle'>

export function normalizeCopilotTitle(title: string | null | undefined): string | null {
  const trimmedTitle = title?.trim()
  if (!trimmedTitle) {
    return null
  }
  return trimmedTitle
}

type TitledThread = Pick<
  PersistedThread,
  'customTitle' | 'generatedTitle' | 'latestCopilotTitle' | 'branchName'
>

/** A manual title wins, then the generated one, then the live or last Copilot session title. */
export function resolveThreadTitle(
  thread: Omit<TitledThread, 'branchName'>,
  runtimeTitle: string | null | undefined
): string | null {
  return (
    normalizeCopilotTitle(thread.customTitle) ??
    normalizeCopilotTitle(thread.generatedTitle) ??
    getCopilotTitle(thread, runtimeTitle)
  )
}

/** For main-process messages such as the quit confirmation. */
export function threadDisplayName(thread: TitledThread | undefined): string {
  return (thread && (resolveThreadTitle(thread, null) ?? thread.branchName)) || 'Untitled thread'
}

export function getCopilotTitle(
  thread: CopilotTitleThread,
  runtimeTitle: string | null | undefined
): string | null {
  return normalizeCopilotTitle(runtimeTitle) ?? normalizeCopilotTitle(thread.latestCopilotTitle)
}
