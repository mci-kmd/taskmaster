import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it } from 'vitest'
import { createPromptSummaryStore, type PromptSummaryRecord } from './prompt-summary-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-summaries-'))
  dirs.push(dir)
  return join(dir, 'prompt-summaries.jsonl')
}
const record = (id: string, extra: Partial<PromptSummaryRecord> = {}): PromptSummaryRecord => ({
  sessionId: 'a',
  id,
  anchorId: 'assistant:1',
  timestamp: '2026-09-30T10:00:00Z',
  durationMs: 1000,
  nanoAiu: 5,
  ...extra
})

it('persists summaries per session, with later updates winning', () => {
  const path = file()
  const store = createPromptSummaryStore(path)
  store.saveSummary(record('1'))
  store.saveSummary(record('2', { sessionId: 'b' }))
  store.saveSummary(record('1', { nanoAiu: 9 }))
  expect(store.getSummaries('a')).toEqual([record('1', { nanoAiu: 9 })])
  const reloaded = createPromptSummaryStore(path)
  expect(reloaded.getSummaries('a')).toEqual([record('1', { nanoAiu: 9 })])
  expect(reloaded.getSummaries('b')).toEqual([record('2', { sessionId: 'b' })])
  expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2)
})

it('skips damaged lines and rejects invalid records', () => {
  const path = file()
  writeFileSync(path, `not json\n${JSON.stringify(record('1'))}\n{"id":"x"}`)
  const store = createPromptSummaryStore(path)
  expect(store.getSummaries('a')).toEqual([record('1')])
  expect(() => store.saveSummary({ ...record('2'), durationMs: -1 })).toThrow()
})

it('persists sub-agent usage and rejects malformed entries', () => {
  const path = file()
  const subagents = [{ id: 'x', model: 'm', reasoningEffort: null, durationMs: 10, nanoAiu: null }]
  createPromptSummaryStore(path).saveSummary(record('1', { subagents }))
  const store = createPromptSummaryStore(path)
  expect(store.getSummaries('a')).toEqual([record('1', { subagents })])
  expect(() =>
    store.saveSummary(record('2', { subagents: [{ ...subagents[0], durationMs: -1 }] }))
  ).toThrow()
  expect(() => store.saveSummary(record('2', { subagents: [{ id: 'x' }] as never }))).toThrow()
})
