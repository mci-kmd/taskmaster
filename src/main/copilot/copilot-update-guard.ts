import type { CopilotSdkUpdateBlocker, CopilotSessionSnapshot } from '../../shared/app-types'

export function collectCopilotSdkUpdateBlockers(
  sessions: Iterable<Pick<CopilotSessionSnapshot, 'threadId' | 'phase'>>,
  startingThreadIds: Iterable<string>,
  getThreadTitle: (threadId: string) => string
): CopilotSdkUpdateBlocker[] {
  const blockingThreadIds = new Set<string>()

  for (const session of sessions) {
    if (session.phase === 'running') {
      blockingThreadIds.add(session.threadId)
    }
  }
  for (const threadId of startingThreadIds) {
    blockingThreadIds.add(threadId)
  }

  return [...blockingThreadIds].map((threadId) => ({
    threadId,
    title: getThreadTitle(threadId)
  }))
}
