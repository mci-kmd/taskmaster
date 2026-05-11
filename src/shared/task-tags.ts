export const DEFAULT_PROJECT_TASK_TAGS = ['bug', 'feature'] as const

const TASK_TAG_SPLIT_PATTERN = /[\r\n,]+/

function normalizeTaskTag(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) {
    return null
  }

  return trimmed.replace(/\s+/g, ' ')
}

function getTaskTagKey(value: string): string {
  return value.toLowerCase()
}

export function normalizeTaskTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) {
    return []
  }

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    const value = normalizeTaskTag(tag)
    if (!value) {
      continue
    }

    const key = getTaskTagKey(value)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push(value)
  }

  return normalized
}

export function normalizeTaskTagsAgainstAllowed(
  tags: readonly string[] | null | undefined,
  allowedTags: readonly string[]
): string[] {
  if (!tags || tags.length === 0 || allowedTags.length === 0) {
    return []
  }

  const allowed = normalizeTaskTags(allowedTags)
  const allowedByKey = new Map(allowed.map((tag) => [getTaskTagKey(tag), tag]))
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    const value = normalizeTaskTag(tag)
    if (!value) {
      continue
    }

    const key = getTaskTagKey(value)
    const canonical = allowedByKey.get(key)
    if (!canonical || seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push(canonical)
  }

  return normalized
}

export function parseTaskTagsInput(input: string | null | undefined): string[] {
  return normalizeTaskTags((input ?? '').split(TASK_TAG_SPLIT_PATTERN))
}

export function normalizeTaskTagsInput(input: string | null | undefined): string {
  return parseTaskTagsInput(input).join('\n')
}

export function sortTaskTags(tags: readonly string[], preferredOrder: readonly string[]): string[] {
  const normalized = normalizeTaskTags(tags)
  if (normalized.length <= 1) {
    return normalized
  }

  const preferred = new Map(
    normalizeTaskTags(preferredOrder).map((tag, index) => [getTaskTagKey(tag), index])
  )
  const originalOrder = new Map(normalized.map((tag, index) => [getTaskTagKey(tag), index]))

  return [...normalized].sort((left, right) => {
    const leftKey = getTaskTagKey(left)
    const rightKey = getTaskTagKey(right)
    const leftIndex = preferred.get(leftKey)
    const rightIndex = preferred.get(rightKey)

    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex
    }

    if (leftIndex !== undefined) {
      return -1
    }

    if (rightIndex !== undefined) {
      return 1
    }

    return (originalOrder.get(leftKey) ?? 0) - (originalOrder.get(rightKey) ?? 0)
  })
}

export function mergeTaskTags(primary: readonly string[], secondary: readonly string[]): string[] {
  return normalizeTaskTags([...primary, ...secondary])
}
