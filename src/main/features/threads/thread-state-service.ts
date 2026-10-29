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
import { normalizePinnedMessageIds, prunePinnedMessageTitles } from './thread-values'

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
  /** Whether the thread's Copilot session is busy; such threads can't be suspended. */
  isThreadWorking?: (threadId: string) => boolean
  /** Called after a message is newly pinned, e.g. to title it. */
  onMessagePinned?: (threadId: string, messageId: string) => void
}

export function createThreadStateService(dependencies: ThreadStateServiceDependencies): {
  updateThread: (input: UpdateThreadInput) => MutationResult
  updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) => boolean
  updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) => boolean
  updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) => boolean
  settleThreadFromAgent: (threadId: string) => boolean
  /** Returns snoozed threads whose time has come to the inbox, awakened; returns their ids. */
  wakeSnoozedThreads: () => string[]
  /** The earliest snooze end in ms since the epoch, or null when nothing is snoozed. */
  nextSnoozeWakeAt: () => number | null
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
      // Suspending only reorders the inbox, so it leaves lastActivityAt alone.
      if (input.suspended !== undefined) {
        if (typeof input.suspended !== 'boolean') {
          return dependencies.failureResult('Invalid suspension status.')
        }
        if (input.suspended && !thread.suspendedAt) {
          if (thread.settledAt)
            return dependencies.failureResult('Resolved threads cannot be suspended.')
          if (dependencies.isThreadWorking?.(thread.id)) {
            return dependencies.failureResult(
              'Wait for Copilot to finish before suspending the thread.'
            )
          }
          thread.suspendedAt = dependencies.nowIso()
          dependencies.saveState()
        } else if (!input.suspended && thread.suspendedAt) {
          delete thread.suspendedAt
          dependencies.saveState()
        }
      }
      if (input.snoozedUntil !== undefined) {
        if (input.snoozedUntil === null) {
          if (thread.snoozedUntil) {
            delete thread.snoozedUntil
            dependencies.saveState()
          }
        } else {
          const until =
            typeof input.snoozedUntil === 'string' ? Date.parse(input.snoozedUntil) : Number.NaN
          if (!Number.isFinite(until)) return dependencies.failureResult('Invalid snooze time.')
          if (until <= Date.parse(dependencies.nowIso())) {
            return dependencies.failureResult('Pick a snooze time in the future.')
          }
          if (thread.settledAt)
            return dependencies.failureResult('Resolved threads cannot be snoozed.')
          thread.snoozedUntil = new Date(until).toISOString()
          delete thread.suspendedAt
          delete thread.awakenedAt
          dependencies.saveState()
        }
      }
      if (input.dismissAwakened === true && thread.awakenedAt) {
        delete thread.awakenedAt
        dependencies.saveState()
      }
      if (input.settled !== undefined) {
        if (typeof input.settled !== 'boolean') {
          return dependencies.failureResult('Invalid settlement status.')
        }
        thread.settledAt = input.settled ? (thread.settledAt ?? dependencies.nowIso()) : null
        if (input.settled) {
          delete thread.suspendedAt
          delete thread.snoozedUntil
          delete thread.awakenedAt
        }
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
      if (input.pinnedMessage !== undefined) {
        const { messageId, pinned } = input.pinnedMessage ?? {}
        if (typeof messageId !== 'string' || !messageId.trim() || typeof pinned !== 'boolean') {
          return dependencies.failureResult('Invalid pinned message.')
        }
        const current = thread.pinnedMessageIds ?? []
        if (current.includes(messageId) !== pinned) {
          const next = normalizePinnedMessageIds(
            pinned ? [...current, messageId] : current.filter((id) => id !== messageId)
          )
          if (next) thread.pinnedMessageIds = next
          else delete thread.pinnedMessageIds
          prunePinnedMessageTitles(thread)
          dependencies.saveState()
          if (pinned) dependencies.onMessagePinned?.(thread.id, messageId)
        }
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
        // Pins refer to messages of the previous conversation.
        delete thread.pinnedMessageIds
        delete thread.pinnedMessageTitles
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
      // A new prompt brings a settled, suspended or snoozed thread back, and attends to an
      // awakened one.
      if (thread.settledAt) thread.settledAt = null
      delete thread.suspendedAt
      delete thread.snoozedUntil
      delete thread.awakenedAt
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
      delete thread.suspendedAt
      delete thread.snoozedUntil
      delete thread.awakenedAt
      dependencies.saveState()
      return true
    },

    wakeSnoozedThreads: (): string[] => {
      const now = dependencies.nowIso()
      const nowMs = Date.parse(now)
      const woken: string[] = []
      for (const thread of dependencies.ensureState().threads) {
        if (!thread.snoozedUntil) continue
        const until = Date.parse(thread.snoozedUntil)
        if (Number.isFinite(until) && until > nowMs) continue
        delete thread.snoozedUntil
        if (!thread.settledAt) thread.awakenedAt = now
        woken.push(thread.id)
      }
      if (woken.length) dependencies.saveState()
      return woken
    },

    nextSnoozeWakeAt: (): number | null => {
      let next: number | null = null
      for (const thread of dependencies.ensureState().threads) {
        if (!thread.snoozedUntil) continue
        const until = Date.parse(thread.snoozedUntil)
        // Unreadable times wake at once.
        const at = Number.isFinite(until) ? until : 0
        if (next === null || at < next) next = at
      }
      return next
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
