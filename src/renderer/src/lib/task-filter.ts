import { normalizeTaskQuery } from '../../../shared/task-filter'

export {
  isTaskFilterActive,
  matchesTaskFilter,
  normalizeTaskQuery,
  type TaskFilter
} from '../../../shared/task-filter'

export type HighlightSegment = {
  text: string
  match: boolean
}

export function splitHighlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = normalizeTaskQuery(query)
  const haystack = text.toLowerCase()
  // Case mapping can change length for some characters, which would misalign the ranges.
  if (needle.length === 0 || haystack.length !== text.length) {
    return [{ text, match: false }]
  }

  const segments: HighlightSegment[] = []
  let cursor = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), match: false })
    }
    segments.push({ text: text.slice(index, index + needle.length), match: true })
    cursor = index + needle.length
    index = haystack.indexOf(needle, cursor)
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false })
  }
  return segments
}
