import type { ProjectTaskSnapshot, ProjectTaskTag } from '../../../shared/app-types'

export type TaskFilter = {
  query: string
  labels: readonly ProjectTaskTag[]
}

export type HighlightSegment = {
  text: string
  match: boolean
}

export function normalizeTaskQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function isTaskFilterActive(filter: TaskFilter): boolean {
  return normalizeTaskQuery(filter.query).length > 0 || filter.labels.length > 0
}

/** Matches the query against title or description, and any selected label. */
export function matchesTaskFilter(
  task: Pick<ProjectTaskSnapshot, 'title' | 'description' | 'tags'>,
  filter: TaskFilter
): boolean {
  const query = normalizeTaskQuery(filter.query)
  if (
    query.length > 0 &&
    !task.title.toLowerCase().includes(query) &&
    !task.description.toLowerCase().includes(query)
  ) {
    return false
  }

  if (filter.labels.length === 0) {
    return true
  }

  const taskLabels = new Set(task.tags.map((tag) => tag.toLowerCase()))
  return filter.labels.some((label) => taskLabels.has(label.toLowerCase()))
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
