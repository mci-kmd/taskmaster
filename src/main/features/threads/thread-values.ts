export function normalizeTrackedText(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export const MAX_PINNED_MESSAGES = 100

/** Unique, non-empty timeline item ids in pin order; undefined when there are none. */
export function normalizePinnedMessageIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))
  ].slice(-MAX_PINNED_MESSAGES)
  return ids.length ? ids : undefined
}

export function normalizeCustomTitle(title: string | null | undefined): string | null {
  const trimmedTitle = title?.trim()
  return trimmedTitle ? trimmedTitle : null
}
