import type { CopilotTimelineItem } from '../../../../shared/app-types'

export type HistoryPosition = { id: string; prompt: string }

export function promptHistory(timeline: CopilotTimelineItem[]): HistoryPosition[] {
  const entries: HistoryPosition[] = []
  for (const item of timeline) {
    if (item.type !== 'user' || !item.content.trim()) continue
    const entry = { id: item.id, prompt: item.content }
    if (entries.at(-1)?.prompt === entry.prompt) entries[entries.length - 1] = entry
    else entries.push(entry)
  }
  return entries
}

export function stepPromptHistory(
  entries: HistoryPosition[],
  position: HistoryPosition | null,
  prompt: string,
  direction: 'older' | 'newer'
): { position: HistoryPosition | null; prompt: string } | null {
  let index = -1
  if (position?.prompt === prompt) {
    index = entries.findIndex((entry) => entry.id === position.id)
    if (index < 0) index = entries.findLastIndex((entry) => entry.prompt === prompt)
  }
  if (index < 0 && (prompt.length > 0 || direction === 'newer')) return null
  const next = direction === 'older' ? (index < 0 ? entries.length - 1 : index - 1) : index + 1
  if (next < 0) return null
  if (next >= entries.length) return { position: null, prompt: '' }
  return { position: entries[next], prompt: entries[next].prompt }
}
