import type { ThreadSnapshot } from '../../../shared/app-types'
import { resolveThreadTitle } from '../../../shared/thread-title'

/**
 * Prefers the manual title, then the generated one, then the live or latest Copilot title,
 * and finally falls back to the thread's non-Copilot display label.
 */
export function composeThreadTitle(
  thread: ThreadSnapshot,
  runtimeTitle: string | null | undefined
): string {
  return resolveThreadTitle(thread, runtimeTitle) ?? thread.displayTitle
}
