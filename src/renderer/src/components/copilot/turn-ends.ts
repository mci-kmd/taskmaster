import type { CopilotTimelineItem } from '../../../../shared/app-types'

/**
 * The last Copilot message of each turn, where the conversation can be reset or forked, and
 * which of those it offers: the latest turn can't be reset to, nor forked from while running.
 */
export function findTurnEnds(
  items: CopilotTimelineItem[],
  running: boolean
): Map<string, { reset: boolean; fork: boolean }> {
  const result = new Map<string, { reset: boolean; fork: boolean }>()
  let latest = true
  let ended = false
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    // Steering joins the running turn rather than starting one.
    if (item.type === 'user' && !item.steered) {
      latest = false
      ended = false
    } else if (item.type === 'assistant' && item.content.trim() && !ended) {
      ended = true
      result.set(item.id, { reset: !latest, fork: !latest || !running })
    }
  }
  return result
}
