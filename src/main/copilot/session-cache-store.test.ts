import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it } from 'vitest'
import { createSessionCacheStore, type SessionCacheRecord } from './session-cache-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-cache-'))
  dirs.push(dir)
  return join(dir, 'session-cache.jsonl')
}
const record = (
  sessionId: string,
  extra: Partial<SessionCacheRecord> = {}
): SessionCacheRecord => ({
  sessionId,
  id: sessionId,
  cacheByModel: { 'claude-opus': '2026-09-30T10:05:00Z' },
  contextTokens: 82_000,
  tokenLimit: 200_000,
  updatedAt: '2026-09-30T10:00:00Z',
  ...extra
})

it('persists latest cache state per session across reloads', () => {
  const path = file()
  const store = createSessionCacheStore(path)
  store.saveCacheState(record('a'))
  store.saveCacheState(record('b', { contextTokens: 12_000 }))
  store.saveCacheState(record('a', { contextTokens: 95_000 }))
  expect(store.getCacheState('a')).toEqual(record('a', { contextTokens: 95_000 }))

  const reloaded = createSessionCacheStore(path)
  expect(reloaded.getCacheState('a')).toEqual(record('a', { contextTokens: 95_000 }))
  expect(reloaded.getCacheState('b')).toEqual(record('b', { contextTokens: 12_000 }))
  expect(reloaded.getCacheState('missing')).toBeNull()
  expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2)
})

it('skips damaged lines and rejects malformed records', () => {
  const path = file()
  writeFileSync(path, `not json\n${JSON.stringify(record('a'))}\n{"sessionId":"bad"}`)
  const store = createSessionCacheStore(path)
  expect(store.getCacheState('a')).toEqual(record('a'))
  expect(() => store.saveCacheState(record('b', { contextTokens: -5 }))).toThrow()
  expect(() => store.saveCacheState(record('b', { cacheByModel: { m: 'not-a-date' } }))).toThrow()
})
