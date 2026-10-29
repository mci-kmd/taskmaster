import { resolveCommitMessageModel } from '../../../shared/commit'
import type { ThreadGitContext } from './thread-git-context'
import { cleanGeneratedTitle, type TitleRequest } from './thread-title-service'
import { MAX_PINNED_MESSAGE_TITLE_CHARS } from './thread-values'

const MAX_MESSAGE_CHARS = 8_000

export const PIN_TITLE_SYSTEM_MESSAGE = [
  'You write short headings for answers a coding assistant gave a developer.',
  'Reply with only the heading: no preamble, quotes, or trailing punctuation.',
  `Use sentence case and at most ${MAX_PINNED_MESSAGE_TITLE_CHARS} characters (about eight`,
  'words) that say what the answer contains, so the developer can find it again in a list.'
].join(' ')

export function buildPinTitlePrompt(message: string): string {
  const text = message.trim()
  return [
    'Write a heading for this answer:',
    text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text
  ].join('\n\n')
}

/**
 * Titles pinned Copilot messages with the project's commit message model, since a message's
 * opening words rarely say what it contains. Runs in the background after a pin; until it
 * finishes, or when it fails, the pin shows the start of the message.
 */
export function createPinnedMessageTitleService(dependencies: {
  resolveThreadContext: (threadId: string) => ThreadGitContext
  /** The text of a message in the thread's connected session, or null when it isn't there. */
  getMessageContent: (threadId: string, messageId: string) => string | null
  generateText: (request: TitleRequest) => Promise<string>
  saveState: () => void
  onTitleChanged: (threadId: string) => void
}): {
  generatePinTitle: (threadId: string, messageId: string) => Promise<void>
} {
  const generating = new Set<string>()

  const isPinned = (threadId: string, messageId: string): boolean => {
    const context = dependencies.resolveThreadContext(threadId)
    return context.ok && (context.thread.pinnedMessageIds ?? []).includes(messageId)
  }

  return {
    generatePinTitle: async (threadId, messageId) => {
      const context = dependencies.resolveThreadContext(threadId)
      if (!context.ok) return
      const { thread, repository, cwd } = context
      if (thread.pinnedMessageTitles?.[messageId] || !isPinned(threadId, messageId)) return
      const content = dependencies.getMessageContent(threadId, messageId)?.trim()
      const key = `${threadId}\n${messageId}`
      if (!content || generating.has(key)) return

      generating.add(key)
      try {
        const title = cleanGeneratedTitle(
          await dependencies.generateText({
            ...resolveCommitMessageModel(repository),
            cwd,
            systemMessage: PIN_TITLE_SYSTEM_MESSAGE,
            prompt: buildPinTitlePrompt(content)
          }),
          MAX_PINNED_MESSAGE_TITLE_CHARS
        )
        // The message may have been unpinned, or the thread removed, while the model wrote.
        const current = dependencies.resolveThreadContext(threadId)
        if (!title || !current.ok || !isPinned(threadId, messageId)) return
        current.thread.pinnedMessageTitles = {
          ...current.thread.pinnedMessageTitles,
          [messageId]: title
        }
        dependencies.saveState()
        dependencies.onTitleChanged(threadId)
      } catch (error) {
        console.warn(`Could not title pinned message ${messageId}:`, error)
      } finally {
        generating.delete(key)
      }
    }
  }
}
