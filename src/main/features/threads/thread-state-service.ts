import type {
  AppSnapshot,
  PersistedAppState,
  PersistedThread,
  ThreadWorkItem,
  UpdateThreadCopilotTitleInput,
  UpdateThreadInput,
  UpdateThreadLastUserMessageInput,
  UpdateThreadResumeSessionInput,
  MutationResult
} from '../../../shared/app-types'
import { normalizeThreadWorkItems, sameThreadWorkItems } from '../../../shared/work-items'

type ThreadStateServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'ui' | 'repositories' | 'threads'>
  findThread: (threadId: string) => PersistedThread | undefined
  saveState: () => void
  updateSelection: (repositoryId: string | null, threadId: string | null) => void
  buildSelectionSnapshot: () => AppSnapshot
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  normalizeCustomTitle: (title: string | null | undefined) => string | null
  normalizeTrackedText: (value: string | null) => string | null
  normalizeCopilotTitle: (title: string | null | undefined) => string | null
  nowIso: () => string
}

export function createThreadStateService(dependencies: ThreadStateServiceDependencies): {
  updateThread: (input: UpdateThreadInput) => MutationResult
  updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) => boolean
  updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) => boolean
  updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) => boolean
  settleThreadFromAgent: (threadId: string) => boolean
  setThreadWorkItems: (threadId: string, workItems: ThreadWorkItem[]) => boolean
  selectRepository: (repositoryId: string | null) => AppSnapshot
  selectThread: (threadId: string | null) => AppSnapshot
} {
  return {
    updateThread: (input: UpdateThreadInput): MutationResult => {
      const thread = dependencies.findThread(input.threadId)
      if (!thread) {
        return dependencies.failureResult('Thread not found.')
      }

      const state = dependencies.ensureState()
      if (input.settled !== undefined) {
        if (typeof input.settled !== 'boolean') {
          return dependencies.failureResult('Invalid settlement status.')
        }
        thread.settledAt = input.settled ? (thread.settledAt ?? dependencies.nowIso()) : null
        if (input.settled && state.ui.selectedThreadId === thread.id) {
          const next = state.threads
            .filter(
              (item) =>
                !item.settledAt &&
                item.id !== thread.id &&
                item.repositoryId === thread.repositoryId
            )
            .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0]
          dependencies.updateSelection(thread.repositoryId, next?.id ?? null)
        }
        dependencies.saveState()
      }
      if (input.customTitle === undefined) return dependencies.successResult()
      const customTitle = dependencies.normalizeCustomTitle(input.customTitle)
      if (thread.customTitle === customTitle) {
        return dependencies.successResult()
      }

      thread.customTitle = customTitle
      dependencies.saveState()
      return dependencies.successResult()
    },

    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput): boolean => {
      const thread = dependencies.findThread(input.threadId)
      if (!thread) {
        return false
      }

      const trimmedTitle = input.title.trim()
      if (!trimmedTitle) {
        return false
      }

      const normalizedTitle = dependencies.normalizeCopilotTitle(trimmedTitle)
      if (thread.latestCopilotTitle === normalizedTitle) {
        return true
      }

      thread.latestCopilotTitle = normalizedTitle
      dependencies.saveState()
      return true
    },

    updateThreadResumeSession: (input: UpdateThreadResumeSessionInput): boolean => {
      const thread = dependencies.findThread(input.threadId)
      if (!thread) {
        return false
      }

      const nextSessionId = input.sessionId.trim()
      if (!nextSessionId) {
        return false
      }

      const shouldClearTitle = input.source === 'new'
      if (
        thread.resumeSessionId === nextSessionId &&
        (!shouldClearTitle || thread.latestCopilotTitle === null)
      ) {
        return true
      }

      thread.resumeSessionId = nextSessionId
      if (shouldClearTitle) {
        thread.latestCopilotTitle = null
      }
      dependencies.saveState()
      return true
    },

    updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput): boolean => {
      const thread = dependencies.findThread(input.threadId)
      if (!thread) {
        return false
      }

      const nextMessage = dependencies.normalizeTrackedText(input.message)
      thread.lastActivityAt = dependencies.nowIso()
      thread.lastUserMessage = nextMessage
      if (input.model) thread.lastModel = { id: input.model.id, name: input.model.name }
      dependencies.saveState()
      return true
    },

    // Unlike settling from the UI, this keeps the selection so the user is not moved away
    // from a thread whose agent is still finishing its turn.
    settleThreadFromAgent: (threadId: string): boolean => {
      const thread = dependencies.findThread(threadId)
      if (!thread) return false
      if (thread.settledAt) return true
      thread.settledAt = dependencies.nowIso()
      dependencies.saveState()
      return true
    },

    setThreadWorkItems: (threadId: string, workItems: ThreadWorkItem[]): boolean => {
      const thread = dependencies.findThread(threadId)
      if (!thread) return false
      const next = normalizeThreadWorkItems(workItems)
      if (sameThreadWorkItems(next, thread.workItems)) return true
      if (next) thread.workItems = next
      else delete thread.workItems
      dependencies.saveState()
      return true
    },

    selectRepository: (repositoryId: string | null): AppSnapshot => {
      dependencies.updateSelection(repositoryId, null)
      dependencies.saveState()
      return dependencies.buildSelectionSnapshot()
    },

    selectThread: (threadId: string | null): AppSnapshot => {
      if (!threadId) {
        const state = dependencies.ensureState()
        state.ui.selectedThreadId = null
        dependencies.saveState()
        return dependencies.buildSelectionSnapshot()
      }

      const thread = dependencies.findThread(threadId)
      if (!thread) {
        return dependencies.buildSelectionSnapshot()
      }

      dependencies.updateSelection(thread.repositoryId, thread.id)
      dependencies.saveState()
      return dependencies.buildSelectionSnapshot()
    }
  }
}
