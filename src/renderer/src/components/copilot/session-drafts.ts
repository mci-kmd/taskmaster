import { useCallback, useSyncExternalStore } from 'react'
import type { CopilotAgentMode, CopilotAttachment } from '../../../../shared/app-types'

type Draft = {
  prompt: string
  attachments: CopilotAttachment[]
  agentMode: CopilotAgentMode | null
}
const emptyDraft: Draft = { prompt: '', attachments: [], agentMode: null }
// In-memory only: survive thread/view changes without persisting file contents to disk.
const drafts = new Map<string, Draft>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSessionDraft(
  threadId: string
): [Draft, (update: (draft: Draft) => Draft) => void] {
  const draft = useSyncExternalStore(subscribe, () => drafts.get(threadId) ?? emptyDraft)
  const update = useCallback(
    (change: (draft: Draft) => Draft) => {
      drafts.set(threadId, change(drafts.get(threadId) ?? emptyDraft))
      listeners.forEach((listener) => listener())
    },
    [threadId]
  )
  return [draft, update]
}
