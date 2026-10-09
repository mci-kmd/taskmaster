import type { CopilotModelSelection } from '../../../shared/app-types'
import { resolveCommitMessageModel } from '../../../shared/commit'
import { normalizeCopilotTitle } from '../../../shared/thread-title'
import type { ThreadGitContext } from './thread-git-context'

export type TitleRequest = CopilotModelSelection & {
  cwd: string
  systemMessage: string
  prompt: string
}

const MAX_PROMPT_CHARS = 1_500
const MAX_CONVERSATION_CHARS = 6_000
const MAX_TITLE_CHARS = 80

export const TITLE_SYSTEM_MESSAGE = [
  'You name conversations between a developer and a coding assistant.',
  'Reply with only the title: no preamble, quotes, or trailing punctuation.',
  'Use at most six words in sentence case that say what the work is about.'
].join(' ')

const truncate = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

/** The first prompt sets the topic; later ones show where the work went, newest kept first. */
export function buildTitlePrompt(prompts: string[]): string {
  const [first, ...rest] = prompts.map((prompt) => truncate(prompt.trim(), MAX_PROMPT_CHARS))
  const included = [first]
  let length = first.length
  const later: string[] = []
  for (const prompt of rest.reverse()) {
    if (length + prompt.length > MAX_CONVERSATION_CHARS) break
    later.unshift(prompt)
    length += prompt.length
  }
  included.push(...later)
  return [
    'Write a title for this conversation. The developer’s messages, oldest first:',
    ...included.map((prompt, index) => `Message ${index + 1}:\n${prompt}`)
  ].join('\n\n')
}

export function cleanGeneratedTitle(reply: string): string | null {
  const line = reply
    .split(/\r?\n/u)
    .map((text) => text.trim())
    .find(Boolean)
  if (!line) return null
  const title = line
    .replace(/^[#*_\s]+/u, '')
    .replace(/^title\s*:\s*/iu, '')
    .replace(/^[*_\s]+|[*_\s]+$/gu, '')
    .replace(/^["'“‘`]+|["'”’`]+$/gu, '')
    .replace(/[.!]+$/u, '')
    .trim()
  return normalizeCopilotTitle(truncate(title, MAX_TITLE_CHARS))
}

/**
 * Names threads with the project's commit message model. A title is generated after a message
 * when the thread has neither a manual nor a generated one, and can be regenerated on request.
 */
export function createThreadTitleService(dependencies: {
  resolveThreadContext: (threadId: string) => ThreadGitContext
  /** The thread's user messages, oldest first. */
  getUserPrompts: (threadId: string) => string[]
  generateText: (request: TitleRequest) => Promise<string>
  saveState: () => void
  onTitleChanged: (threadId: string) => void
}): {
  generateTitleIfMissing: (threadId: string) => void
  regenerateTitle: (threadId: string) => Promise<{ ok: boolean; error?: string }>
} {
  const generating = new Set<string>()
  // One automatic attempt per thread and run, so a failing model isn't retried every message.
  const attempted = new Set<string>()

  const generate = async (
    threadId: string,
    replaceManualTitle: boolean
  ): Promise<{ ok: boolean; error?: string }> => {
    const context = dependencies.resolveThreadContext(threadId)
    if (!context.ok) return { ok: false, error: context.error }
    const { thread, repository, cwd } = context
    const prompts = dependencies.getUserPrompts(threadId).filter((prompt) => prompt.trim())
    if (!prompts.length && thread.lastUserMessage) prompts.push(thread.lastUserMessage)
    if (!prompts.length) return { ok: false, error: 'Send a message before naming this thread.' }
    if (generating.has(threadId)) return { ok: false, error: 'A title is already being written.' }

    generating.add(threadId)
    try {
      const title = cleanGeneratedTitle(
        await dependencies.generateText({
          ...resolveCommitMessageModel(repository),
          cwd,
          systemMessage: TITLE_SYSTEM_MESSAGE,
          prompt: buildTitlePrompt(prompts)
        })
      )
      if (!title) return { ok: false, error: 'Copilot returned an empty title.' }
      thread.generatedTitle = title
      if (replaceManualTitle) thread.customTitle = null
      dependencies.saveState()
      dependencies.onTitleChanged(threadId)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: `Could not write a title: ${error instanceof Error ? error.message : String(error)}`
      }
    } finally {
      generating.delete(threadId)
    }
  }

  return {
    generateTitleIfMissing: (threadId) => {
      const context = dependencies.resolveThreadContext(threadId)
      if (!context.ok || context.thread.customTitle || context.thread.generatedTitle) return
      if (attempted.has(threadId)) return
      attempted.add(threadId)
      void generate(threadId, false).then((result) => {
        if (!result.ok) console.warn(`Could not name thread ${threadId}:`, result.error)
      })
    },
    regenerateTitle: (threadId) => generate(threadId, true)
  }
}
