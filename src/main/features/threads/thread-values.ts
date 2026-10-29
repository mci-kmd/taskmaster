export function normalizeTrackedText(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export const MAX_PINNED_MESSAGES = 100
/** Fits the pin rail's preview label. */
export const MAX_PINNED_MESSAGE_TITLE_CHARS = 60

/** Unique, non-empty timeline item ids in pin order; undefined when there are none. */
export function normalizePinnedMessageIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))
  ].slice(-MAX_PINNED_MESSAGES)
  return ids.length ? ids : undefined
}

/** Non-empty titles of pinned messages only; undefined when there are none. */
export function normalizePinnedMessageTitles(
  value: unknown,
  pinnedMessageIds: readonly string[] | undefined
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !pinnedMessageIds)
    return undefined
  const titles: Record<string, string> = {}
  for (const id of pinnedMessageIds) {
    const title = (value as Record<string, unknown>)[id]
    if (typeof title === 'string' && title.trim()) titles[id] = title.trim()
  }
  return Object.keys(titles).length ? titles : undefined
}

/** Drops titles of messages that are no longer pinned. */
export function prunePinnedMessageTitles(thread: {
  pinnedMessageIds?: string[]
  pinnedMessageTitles?: Record<string, string>
}): void {
  const titles = normalizePinnedMessageTitles(thread.pinnedMessageTitles, thread.pinnedMessageIds)
  if (titles) thread.pinnedMessageTitles = titles
  else delete thread.pinnedMessageTitles
}

export function normalizeCustomTitle(title: string | null | undefined): string | null {
  const trimmedTitle = title?.trim()
  return trimmedTitle ? trimmedTitle : null
}
