import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

// Usage events are not persisted by the runtime, so summaries are kept here to survive restarts.
export interface PromptSummaryRecord {
  sessionId: string
  id: string
  /** Timeline item the summary is shown after. */
  anchorId: string
  timestamp: string
  durationMs: number
  nanoAiu: number | null
}

function isRecord(value: unknown): value is PromptSummaryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sessionId === 'string' &&
    typeof record.id === 'string' &&
    typeof record.anchorId === 'string' &&
    typeof record.timestamp === 'string' &&
    typeof record.durationMs === 'number' &&
    Number.isFinite(record.durationMs) &&
    record.durationMs >= 0 &&
    (record.nanoAiu === null ||
      (typeof record.nanoAiu === 'number' && Number.isFinite(record.nanoAiu)))
  )
}

export function createPromptSummaryStore(path: string): {
  getSummaries: (sessionId: string) => PromptSummaryRecord[]
  saveSummary: (record: PromptSummaryRecord) => void
} {
  let records: Map<string, PromptSummaryRecord> | null = null
  let needsLineBreak = false

  const load = (): Map<string, PromptSummaryRecord> => {
    if (records) return records
    let content = ''
    try {
      content = readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    records = new Map()
    let lines = 0
    for (const line of content.split('\n')) {
      const text = line.trim()
      if (!text) continue
      lines++
      try {
        const parsed: unknown = JSON.parse(text)
        // Later lines update earlier ones (e.g. usage reported after the prompt finished).
        if (isRecord(parsed)) records.set(parsed.id, parsed)
      } catch {
        // Skip damaged lines; compaction below drops them.
      }
    }
    needsLineBreak = content.length > 0 && !content.endsWith('\n')
    if (lines !== records.size) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(
          `${path}.tmp`,
          [...records.values()].map((record) => `${JSON.stringify(record)}\n`).join('')
        )
        renameSync(`${path}.tmp`, path)
        needsLineBreak = false
      } catch (error) {
        console.error('Could not compact prompt summaries:', error)
      }
    }
    return records
  }

  return {
    getSummaries: (sessionId) =>
      [...load().values()].filter((record) => record.sessionId === sessionId),
    saveSummary: (record) => {
      if (!isRecord(record)) throw new Error('Prompt summary is invalid.')
      const current = load()
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `${needsLineBreak ? '\n' : ''}${JSON.stringify(record)}\n`)
      needsLineBreak = false
      current.set(record.id, record)
    }
  }
}
