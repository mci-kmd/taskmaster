import type { ThreadSnapshot } from '../../../shared/app-types'

/**
 * Combines a thread's persisted custom label with whatever title the running
 * Copilot CLI has set via OSC. The runtime title takes priority — the custom
 * label only acts as a prefix when present.
 */
export function composeThreadTitle(
  thread: ThreadSnapshot,
  runtimeTitle: string | null | undefined
): string {
  const trimmedRuntime = runtimeTitle?.trim()
  if (trimmedRuntime) {
    return thread.customTitle ? `${thread.customTitle} — ${trimmedRuntime}` : trimmedRuntime
  }
  return thread.displayTitle
}
