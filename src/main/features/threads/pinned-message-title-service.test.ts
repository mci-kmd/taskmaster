import { describe, expect, it, vi } from 'vitest'
import type { PersistedRepository, PersistedThread } from '../../../shared/app-types'
import type { TitleRequest } from './thread-title-service'
import {
  buildPinTitlePrompt,
  createPinnedMessageTitleService
} from './pinned-message-title-service'

function setup(options: {
  generate?: (request: TitleRequest) => Promise<string>
  content?: string | null
}): {
  service: ReturnType<typeof createPinnedMessageTitleService>
  thread: PersistedThread
  generateText: ReturnType<typeof vi.fn<(request: TitleRequest) => Promise<string>>>
  onTitleChanged: ReturnType<typeof vi.fn>
} {
  const thread = {
    id: 'thread',
    pinnedMessageIds: ['assistant:a']
  } as PersistedThread
  const repository = {
    id: 'repo',
    commitMessageModel: { model: 'fast-model', reasoningEffort: 'low' }
  } as PersistedRepository
  const generateText = vi.fn<(request: TitleRequest) => Promise<string>>(
    options.generate ?? (async () => 'Title: "Plan for the login redirect fix."')
  )
  const onTitleChanged = vi.fn()
  const service = createPinnedMessageTitleService({
    resolveThreadContext: () => ({ ok: true, thread, repository, cwd: '/repo' }),
    getMessageContent: () =>
      options.content === undefined ? 'Here is the plan: first, ...' : options.content,
    generateText,
    saveState: vi.fn(),
    onTitleChanged
  })
  return { service, thread, generateText, onTitleChanged }
}

describe('pinned message titles', () => {
  it('titles a pinned message with the project commit message model', async () => {
    const { service, thread, generateText, onTitleChanged } = setup({})
    await service.generatePinTitle('thread', 'assistant:a')
    expect(thread.pinnedMessageTitles).toEqual({
      'assistant:a': 'Plan for the login redirect fix'
    })
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fast-model', reasoningEffort: 'low', cwd: '/repo' })
    )
    expect(generateText.mock.calls[0][0].prompt).toContain('Here is the plan')
    expect(onTitleChanged).toHaveBeenCalledWith('thread')
    // An existing title is kept.
    await service.generatePinTitle('thread', 'assistant:a')
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('skips messages that are not pinned or not loaded, and pins removed meanwhile', async () => {
    const unpinned = setup({})
    await unpinned.service.generatePinTitle('thread', 'assistant:other')
    expect(unpinned.generateText).not.toHaveBeenCalled()

    const missing = setup({ content: null })
    await missing.service.generatePinTitle('thread', 'assistant:a')
    expect(missing.generateText).not.toHaveBeenCalled()

    const removed = setup({
      generate: async () => {
        removed.thread.pinnedMessageIds = undefined
        return 'Plan'
      }
    })
    await removed.service.generatePinTitle('thread', 'assistant:a')
    expect(removed.thread).not.toHaveProperty('pinnedMessageTitles')
    expect(removed.onTitleChanged).not.toHaveBeenCalled()
  })

  it('leaves the pin untitled when the model fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service, thread } = setup({ generate: async () => Promise.reject(new Error('x')) })
    await service.generatePinTitle('thread', 'assistant:a')
    expect(thread).not.toHaveProperty('pinnedMessageTitles')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('caps long titles and messages', async () => {
    const { service, thread } = setup({ generate: async () => 'word '.repeat(30) })
    await service.generatePinTitle('thread', 'assistant:a')
    expect(thread.pinnedMessageTitles?.['assistant:a'].length).toBeLessThanOrEqual(61)
    expect(buildPinTitlePrompt('x'.repeat(10_000)).length).toBeLessThan(8_100)
  })
})
