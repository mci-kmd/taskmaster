import type { CopilotSubagentUsage } from '../../shared/app-types'
import { createSessionRecordStore } from './session-record-store'

// Usage events are not persisted by the runtime, so summaries are kept here to survive restarts.
export interface PromptSummaryRecord {
  sessionId: string
  id: string
  /** Timeline item the summary is shown after. */
  anchorId: string
  timestamp: string
  durationMs: number
  nanoAiu: number | null
  /** Absent in summaries saved before sub-agents were tracked. */
  subagents?: CopilotSubagentUsage[]
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isSubagent(value: unknown): value is CopilotSubagentUsage {
  if (!value || typeof value !== 'object') return false
  const agent = value as Record<string, unknown>
  return (
    typeof agent.id === 'string' &&
    (agent.model === null || typeof agent.model === 'string') &&
    (agent.reasoningEffort === null || typeof agent.reasoningEffort === 'string') &&
    (agent.durationMs === null || (isFiniteNumber(agent.durationMs) && agent.durationMs >= 0)) &&
    (agent.nanoAiu === null || isFiniteNumber(agent.nanoAiu))
  )
}

function isRecord(value: unknown): value is PromptSummaryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sessionId === 'string' &&
    typeof record.id === 'string' &&
    typeof record.anchorId === 'string' &&
    typeof record.timestamp === 'string' &&
    isFiniteNumber(record.durationMs) &&
    record.durationMs >= 0 &&
    (record.nanoAiu === null || isFiniteNumber(record.nanoAiu)) &&
    (record.subagents === undefined ||
      (Array.isArray(record.subagents) && record.subagents.every(isSubagent)))
  )
}

export function createPromptSummaryStore(path: string): {
  getSummaries: (sessionId: string) => PromptSummaryRecord[]
  saveSummary: (record: PromptSummaryRecord) => void
} {
  // Later lines update earlier ones (e.g. usage reported after the prompt finished).
  const store = createSessionRecordStore(path, isRecord, 'prompt summary')
  return { getSummaries: store.getRecords, saveSummary: store.saveRecord }
}
