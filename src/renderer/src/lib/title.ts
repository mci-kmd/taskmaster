import type { ThreadSnapshot } from '../../../shared/app-types'

/**
 * Prefers the live Copilot title, then the latest persisted Copilot title,
 * and finally falls back to the thread's non-Copilot display label.
 */
export function composeThreadTitle(
  thread: ThreadSnapshot,
  runtimeTitle: string | null | undefined
): string {
  const copilotTitle = runtimeTitle?.trim() || thread.latestCopilotTitle?.trim()
  if (copilotTitle) {
    return thread.customTitle ? `${thread.customTitle} — ${copilotTitle}` : copilotTitle
  }
  return thread.displayTitle
}
