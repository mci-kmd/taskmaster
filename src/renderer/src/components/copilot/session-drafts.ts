import { useCallback, useSyncExternalStore } from 'react'
import type { CopilotAgentMode, CopilotAttachment } from '../../../../shared/app-types'
import { insertAttachmentMarkers, withUniqueNames } from './attachment-markers'

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

type AttachHandler = (attachments: CopilotAttachment[]) => void
const composers = new Map<string, AttachHandler>()

/** Lets an open composer place attachments from elsewhere at its caret. */
export function registerComposer(threadId: string, attach: AttachHandler): () => void {
  composers.set(threadId, attach)
  return () => {
    if (composers.get(threadId) === attach) composers.delete(threadId)
  }
}

export function attachToDraft(threadId: string, attachments: CopilotAttachment[]): void {
  if (!attachments.length) return
  const composer = composers.get(threadId)
  if (composer) {
    composer(attachments)
    return
  }
  const current = drafts.get(threadId) ?? emptyDraft
  const named = withUniqueNames(attachments, current.attachments)
  const { prompt } = insertAttachmentMarkers(
    current.prompt,
    named.map((item) => item.displayName),
    current.prompt.length
  )
  drafts.set(threadId, { ...current, prompt, attachments: [...current.attachments, ...named] })
  listeners.forEach((listener) => listener())
}
