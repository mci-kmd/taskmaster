/**
 * An aside is a side conversation forked from a thread's session. It runs as its own Copilot
 * session, keyed by this id in place of a thread id, so the thread's conversation is untouched.
 */
const ASIDE_PREFIX = 'aside:'

export function asideSessionKey(threadId: string): string {
  return `${ASIDE_PREFIX}${threadId}`
}

export function isAsideSessionKey(key: string): boolean {
  return key.startsWith(ASIDE_PREFIX)
}

/** The thread an aside belongs to, or null when the key isn't an aside's. */
export function asideParentThreadId(key: string): string | null {
  return isAsideSessionKey(key) ? key.slice(ASIDE_PREFIX.length) : null
}
