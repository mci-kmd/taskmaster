import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelPerformanceSample } from '../../shared/app-types'
import { createModelPerformanceStore } from './model-performance-store'

const paths: string[] = []
const now = Date.parse('2026-09-24T12:00:00.000Z')
function sample(id: string, ageMs: number): ModelPerformanceSample {
  return {
    id,
    model: 'model-a',
    timestamp: new Date(now - ageMs).toISOString(),
    outputTokens: 150,
    durationMs: 2500,
    timeToFirstTokenMs: 350
  }
}
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'taskmaster-performance-'))
  paths.push(path)
  return path
}
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true })
})

function lines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

describe('model performance store', () => {
  it('appends samples, deduplicates event IDs across reloads, and drops expired samples', () => {
    const path = join(directory(), 'performance.json')
    const store = createModelPerformanceStore(path, () => now)
    store.addSample(sample('old', 31 * 24 * 60 * 60 * 1000))
    store.addSample(sample('recent', 2 * 60 * 60 * 1000))
    store.addSample(sample('recent', 2 * 60 * 60 * 1000))
    expect(store.getSamples()).toEqual([sample('recent', 2 * 60 * 60 * 1000)])
    expect(lines(path)).toHaveLength(2)
    expect(createModelPerformanceStore(path, () => now).getSamples()).toEqual(store.getSamples())
    expect(lines(path)).toEqual(store.getSamples())
  })

  it('keeps valid samples when the file has damaged lines or the legacy array format', () => {
    const path = join(directory(), 'performance.json')
    writeFileSync(
      path,
      `${JSON.stringify([sample('legacy', 0)])}\n{"broken"\n${JSON.stringify({ id: 'bad' })}\n${JSON.stringify(sample('line', 0))}\n{"partial":`
    )
    const store = createModelPerformanceStore(path, () => now)
    expect(store.getSamples()).toEqual([sample('legacy', 0), sample('line', 0)])
    store.addSample(sample('next', 0))
    expect(lines(path)).toEqual([sample('legacy', 0), sample('line', 0), sample('next', 0)])
  })

  it('does not lose the next sample after an interrupted write', () => {
    const path = join(directory(), 'performance.json')
    writeFileSync(path, `${JSON.stringify(sample('first', 0))}\n{"partial":`)
    createModelPerformanceStore(path, () => now).addSample(sample('second', 0))
    expect(createModelPerformanceStore(path, () => now).getSamples()).toEqual([
      sample('first', 0),
      sample('second', 0)
    ])
  })

  it('compacts expired samples daily while running', () => {
    const path = join(directory(), 'performance.json')
    let current = now
    const store = createModelPerformanceStore(path, () => current)
    store.addSample(sample('first', 0))
    current += 31 * 24 * 60 * 60 * 1000
    store.addSample({ ...sample('second', 0), timestamp: new Date(current).toISOString() })
    expect(lines(path)).toEqual([
      { ...sample('second', 0), timestamp: new Date(current).toISOString() }
    ])
  })

  it('surfaces unreadable data and write errors instead of silently losing measurements', () => {
    const path = join(directory(), 'performance.json')
    const store = createModelPerformanceStore(path, () => now)
    expect(() => store.addSample({ ...sample('bad', 0), durationMs: 0 })).toThrow('invalid')
    mkdirSync(path)
    expect(() => store.addSample(sample('good', 0))).toThrow()
    expect(() => store.getSamples()).toThrow()
  })
})
