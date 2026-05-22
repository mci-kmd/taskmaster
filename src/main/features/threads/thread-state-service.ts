import type {
  AppSnapshot,
  PersistedAppState,
  PersistedThread,
  UpdateThreadCopilotTitleInput,
  UpdateThreadInput,
  UpdateThreadLastUserMessageInput,
  UpdateThreadResumeSessionInput,
  MutationResult
} from '../../../shared/app-types'

type ThreadStateServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'ui'>
  findThread: (threadId: string) => PersistedThread | undefined
  saveState: () => void
  updateSelection: (repositoryId: string | null, threadId: string | null) => void
  buildSelectionSnapshot: () => AppSnapshot
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  normalizeCustomTitle: (title: string | null | undefined) => string | null
  normalizeTrackedText: (value: string | null) => string | null
  normalizeCopilotTitle: (
    thread: Pick<PersistedThread, 'sessionName'>,
    title: string | null | undefined
  ) => string | null
  nowIso: () => string
}

export function createThreadStateService(dependencies: ThreadStateServiceDependencies): {
  updateThread: (input: UpdateThreadInput) => MutationResult
  updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) => boolean
  updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) => boolean
  updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) => boolean
  selectRepository: (repositoryId: string | null) => AppSnapshot
  selectThread: (threadId: string | null) => AppSnapshot
  markThreadLaunched: (threadId: string) => void
} {
  return {
    updateThread: (input: UpdateThreadInput): MutationResult => {
      const thread = dependencies.findThread(input.threadId)
      if (!thread) {
        return dependencies.failureResult('Thread not found.')
      }

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

      const normalizedTitle = dependencies.normalizeCopilotTitle(thread, trimmedTitle)
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
        (!shouldClearTitle || thread.latestCopilotTitle === null) &&
        thread.hasLaunched
      ) {
        return true
      }

      thread.resumeSessionId = nextSessionId
      thread.hasLaunched = true
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
      const nextActivityAt = dependencies.nowIso()
      if (thread.lastUserMessage === nextMessage) {
        thread.lastActivityAt = nextActivityAt
        dependencies.saveState()
        return true
      }

      thread.lastUserMessage = nextMessage
      thread.lastActivityAt = nextActivityAt
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
    },

    markThreadLaunched: (threadId: string): void => {
      const thread = dependencies.findThread(threadId)
      if (!thread) {
        return
      }

      thread.hasLaunched = true
      dependencies.updateSelection(thread.repositoryId, thread.id)
      dependencies.saveState()
    }
  }
}
