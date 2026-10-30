import { createHash } from 'crypto'
import type { CopilotPastedText } from '../../shared/app-types'
import { createSessionRecordStore } from './session-record-store'

// The runtime keeps only a message's full text, so the pasted parts are kept here to show as pills.
export interface PastedTextRecord {
  /** Session the message was sent in. */
  sessionId: string
  /** From {@link pastedTextKey}, so forks and resets of the session still find it. */
  id: string
  pastedTexts: CopilotPastedText[]
}

/** Identifies a message by its content, which carries over to forked sessions. */
export const pastedTextKey = (content: string): string =>
  `pasted:${createHash('sha256').update(content).digest('base64url')}`

export const isPastedText = (value: unknown): value is CopilotPastedText =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as CopilotPastedText).name === 'string' &&
  typeof (value as CopilotPastedText).text === 'string'

function isRecord(value: unknown): value is PastedTextRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sessionId === 'string' &&
    typeof record.id === 'string' &&
    Array.isArray(record.pastedTexts) &&
    record.pastedTexts.every(isPastedText)
  )
}

export function createPastedTextStore(path: string): {
  getPastedTexts: (content: string) => CopilotPastedText[] | null
  savePastedTexts: (sessionId: string, content: string, pastedTexts: CopilotPastedText[]) => void
} {
  const store = createSessionRecordStore(path, isRecord, 'pasted text')
  return {
    getPastedTexts: (content) => store.getRecord(pastedTextKey(content))?.pastedTexts ?? null,
    savePastedTexts: (sessionId, content, pastedTexts) =>
      store.saveRecord({ sessionId, id: pastedTextKey(content), pastedTexts })
  }
}
