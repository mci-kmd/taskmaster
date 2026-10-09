import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ModelPerformanceSample } from '../../shared/app-types'

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const COMPACTION_INTERVAL_MS = 24 * 60 * 60 * 1000

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

// A sample needs timing (for speed) or billed usage (for credits); older samples have no usage.
function isSample(value: unknown): value is ModelPerformanceSample {
  if (!value || typeof value !== 'object') return false
  const sample = value as Record<string, unknown>
  const billed = isAmount(sample.nanoAiu)
  return (
    typeof sample.id === 'string' &&
    typeof sample.model === 'string' &&
    typeof sample.timestamp === 'string' &&
    Number.isFinite(Date.parse(sample.timestamp)) &&
    isAmount(sample.outputTokens) &&
    isAmount(sample.durationMs) &&
    ((sample.outputTokens > 0 && sample.durationMs > 0) || billed) &&
    (sample.timeToFirstTokenMs === null || isAmount(sample.timeToFirstTokenMs)) &&
    (sample.nanoAiu === undefined || sample.nanoAiu === null || billed)
  )
}

// One sample per line; damaged lines and legacy JSON arrays are tolerated and compacted away.
function parseSamples(content: string): { samples: ModelPerformanceSample[]; clean: boolean } {
  const samples: ModelPerformanceSample[] = []
  const ids = new Set<string>()
  let clean = true
  for (const line of content.split('\n')) {
    const text = line.trim()
    if (!text) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      clean = false
      continue
    }
    if (Array.isArray(parsed)) clean = false
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!isSample(item) || ids.has(item.id)) {
        clean = false
        continue
      }
      ids.add(item.id)
      samples.push(item)
    }
  }
  return { samples, clean }
}

export function createModelPerformanceStore(
  path: string,
  now: () => number = Date.now
): {
  getSamples: () => ModelPerformanceSample[]
  addSample: (sample: ModelPerformanceSample) => void
} {
  let samples: ModelPerformanceSample[] | null = null
  let ids = new Set<string>()
  let saveError: Error | null = null
  let needsLineBreak = false
  let lastCompaction = 0

  const isRetained = (sample: ModelPerformanceSample): boolean =>
    Date.parse(sample.timestamp) >= now() - RETENTION_MS

  const compact = (items: ModelPerformanceSample[]): ModelPerformanceSample[] => {
    const retained = items.filter(isRetained)
    lastCompaction = now()
    try {
      mkdirSync(dirname(path), { recursive: true })
      const tempPath = `${path}.tmp`
      writeFileSync(tempPath, retained.map((item) => `${JSON.stringify(item)}\n`).join(''))
      renameSync(tempPath, path)
      needsLineBreak = false
    } catch (error) {
      console.error('Could not compact model performance data:', error)
    }
    return retained
  }

  const load = (): ModelPerformanceSample[] => {
    if (samples) return samples
    let content = ''
    try {
      content = readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parsed = parseSamples(content)
    needsLineBreak = content.length > 0 && !content.endsWith('\n')
    lastCompaction = now()
    samples =
      parsed.clean && parsed.samples.every(isRetained) ? parsed.samples : compact(parsed.samples)
    ids = new Set(samples.map((item) => item.id))
    return samples
  }

  return {
    getSamples: () => {
      if (saveError) throw saveError
      return load().filter((item) => isRetained(item) && Date.parse(item.timestamp) <= now())
    },
    addSample: (sample) => {
      if (!isSample(sample)) throw new Error('Model performance sample is invalid.')
      const current = load()
      if (ids.has(sample.id)) return
      try {
        mkdirSync(dirname(path), { recursive: true })
        appendFileSync(path, `${needsLineBreak ? '\n' : ''}${JSON.stringify(sample)}\n`)
        needsLineBreak = false
        saveError = null
      } catch (error) {
        saveError = error instanceof Error ? error : new Error(String(error))
        throw saveError
      }
      current.push(sample)
      ids.add(sample.id)
      if (now() - lastCompaction >= COMPACTION_INTERVAL_MS) {
        samples = compact(current)
        ids = new Set(samples.map((item) => item.id))
      }
    }
  }
}
