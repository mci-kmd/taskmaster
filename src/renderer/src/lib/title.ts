import type { ThreadSnapshot } from '../../../shared/app-types'
import { getCopilotTitle } from '../../../shared/thread-title'

/**
 * Prefers the live Copilot title, then the latest persisted Copilot title,
 * and finally falls back to the thread's non-Copilot display label.
 */
export function composeThreadTitle(
  thread: ThreadSnapshot,
  runtimeTitle: string | null | undefined
): string {
  const copilotTitle = getCopilotTitle(thread, runtimeTitle)
  if (copilotTitle) {
    return thread.customTitle ? `${thread.customTitle} — ${copilotTitle}` : copilotTitle
  }
  return thread.displayTitle
}
