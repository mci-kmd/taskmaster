import type { CopilotInteractionOutcome } from '../../shared/app-types'
import { createSessionRecordStore } from './session-record-store'

// Interaction events are not persisted by the runtime, so answered requests are kept here to
// survive restarts.
export interface InteractionRecord {
  sessionId: string
  id: string
  /** Timeline item the interaction is shown after. */
  anchorId: string
  timestamp: string
  title: string
  prompt: string
  answer: string
  outcome: CopilotInteractionOutcome
}

const OUTCOMES: readonly CopilotInteractionOutcome[] = ['answered', 'declined']

function isRecord(value: unknown): value is InteractionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    ['sessionId', 'id', 'anchorId', 'timestamp', 'title', 'prompt', 'answer'].every(
      (key) => typeof record[key] === 'string'
    ) && OUTCOMES.includes(record.outcome as CopilotInteractionOutcome)
  )
}

export function createInteractionRecordStore(path: string): {
  getInteractions: (sessionId: string) => InteractionRecord[]
  saveInteraction: (record: InteractionRecord) => void
} {
  const store = createSessionRecordStore(path, isRecord, 'interaction record')
  return { getInteractions: store.getRecords, saveInteraction: store.saveRecord }
}
