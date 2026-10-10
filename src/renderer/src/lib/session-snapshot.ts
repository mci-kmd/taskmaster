import type { CopilotSessionSnapshot, CopilotTimelineItem } from '../../../shared/app-types'

/**
 * Folds a session snapshot from the main process into the one on screen.
 *
 * Every IPC message is a fresh copy, so without this each update would hand React new objects
 * for the whole conversation and re-render (and re-parse) every message. Unchanged items keep
 * their previous objects, and an unchanged timeline keeps its previous array.
 *
 * While the same session reconnects (e.g. after a Copilot update) the main process starts from
 * an empty timeline; the conversation stays on screen until the reloaded history arrives.
 */
export function reconcileSessionSnapshot(
  previous: CopilotSessionSnapshot | null,
  next: CopilotSessionSnapshot
): CopilotSessionSnapshot {
  if (!previous || previous.threadId !== next.threadId) return next
  if (
    next.timeline.length === 0 &&
    previous.timeline.length > 0 &&
    next.phase !== 'idle' &&
    next.phase !== 'running' &&
    (next.sessionId === null || next.sessionId === previous.sessionId)
  ) {
    return { ...next, timeline: previous.timeline }
  }
  const timeline = reconcileTimeline(previous.timeline, next.timeline)
  return timeline === next.timeline ? next : { ...next, timeline }
}

function reconcileTimeline(
  previous: CopilotTimelineItem[],
  next: CopilotTimelineItem[]
): CopilotTimelineItem[] {
  if (previous.length === 0) return next
  const byId = new Map(previous.map((item) => [item.id, item]))
  let reused = 0
  const items = next.map((item) => {
    const existing = byId.get(item.id)
    if (existing && sameValue(existing, item)) {
      reused++
      return existing
    }
    return item
  })
  if (reused === previous.length && items.length === previous.length) {
    // Nothing changed: keep the array too, so memoized consumers skip their work.
    return items.every((item, index) => item === previous[index]) ? previous : items
  }
  return items
}

/** Structural equality for IPC data (plain objects, arrays and primitives). */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) =>
    sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
  )
}
