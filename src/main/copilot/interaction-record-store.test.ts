import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it } from 'vitest'
import { createInteractionRecordStore, type InteractionRecord } from './interaction-record-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'interactions-'))
  dirs.push(dir)
  return join(dir, 'interactions.jsonl')
}
const record = (id: string, extra: Partial<InteractionRecord> = {}): InteractionRecord => ({
  sessionId: 'a',
  id,
  anchorId: 'tool:1',
  timestamp: '2026-09-30T10:00:00Z',
  title: 'Copilot needs your input',
  prompt: 'Which database?',
  answer: 'Postgres',
  outcome: 'answered',
  ...extra
})

it('persists interactions per session and skips invalid lines', () => {
  const path = file()
  writeFileSync(path, `not json\n${JSON.stringify({ ...record('x'), outcome: 'maybe' })}\n`)
  const store = createInteractionRecordStore(path)
  store.saveInteraction(record('1'))
  store.saveInteraction(record('2', { sessionId: 'b', outcome: 'declined', answer: 'Skipped' }))
  const reloaded = createInteractionRecordStore(path)
  expect(reloaded.getInteractions('a')).toEqual([record('1')])
  expect(reloaded.getInteractions('b')).toEqual([
    record('2', { sessionId: 'b', outcome: 'declined', answer: 'Skipped' })
  ])
  expect(() => store.saveInteraction({ ...record('3'), prompt: 1 } as never)).toThrow()
})
