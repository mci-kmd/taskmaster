import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export type SessionRecord = { sessionId: string; id: string }

/**
 * An append-only JSONL file of records keyed by id and grouped by Copilot session, for timeline
 * details the runtime does not persist. Later lines replace earlier ones with the same id.
 */
export function createSessionRecordStore<T extends SessionRecord>(
  path: string,
  isRecord: (value: unknown) => value is T,
  label: string
): {
  getRecords: (sessionId: string) => T[]
  saveRecord: (record: T) => void
} {
  let records: Map<string, T> | null = null
  let needsLineBreak = false

  const load = (): Map<string, T> => {
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
        console.error(`Could not compact ${label}s:`, error)
      }
    }
    return records
  }

  return {
    getRecords: (sessionId) =>
      [...load().values()].filter((record) => record.sessionId === sessionId),
    saveRecord: (record) => {
      if (!isRecord(record)) throw new Error(`The ${label} is invalid.`)
      const current = load()
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `${needsLineBreak ? '\n' : ''}${JSON.stringify(record)}\n`)
      needsLineBreak = false
      current.set(record.id, record)
    }
  }
}
