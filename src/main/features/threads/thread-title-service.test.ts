import { describe, expect, it, vi } from 'vitest'
import type { PersistedRepository, PersistedThread } from '../../../shared/app-types'
import {
  buildTitlePrompt,
  cleanGeneratedTitle,
  createThreadTitleService,
  type TitleRequest
} from './thread-title-service'

function setup(
  thread: Partial<PersistedThread> = {},
  options: { prompts?: string[]; generate?: (request: TitleRequest) => Promise<string> } = {}
): {
  service: ReturnType<typeof createThreadTitleService>
  thread: PersistedThread
  generateText: ReturnType<typeof vi.fn<(request: TitleRequest) => Promise<string>>>
  onTitleChanged: ReturnType<typeof vi.fn>
} {
  const persisted = {
    id: 'thread',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    ...thread
  } as PersistedThread
  const repository = {
    id: 'repo',
    commitMessageModel: { model: 'fast-model', reasoningEffort: 'low' }
  } as PersistedRepository
  const generateText = vi.fn<(request: TitleRequest) => Promise<string>>(
    options.generate ?? (async () => '"Fix login redirect."')
  )
  const onTitleChanged = vi.fn()
  const service = createThreadTitleService({
    resolveThreadContext: () => ({ ok: true, thread: persisted, repository, cwd: '/repo' }),
    getUserPrompts: () => options.prompts ?? ['The login page redirects in a loop'],
    generateText,
    saveState: vi.fn(),
    onTitleChanged
  })
  return { service, thread: persisted, generateText, onTitleChanged }
}

describe('thread titles', () => {
  it('names an untitled thread once with the project commit message model', async () => {
    const { service, thread, generateText, onTitleChanged } = setup()
    service.generateTitleIfMissing('thread')
    await vi.waitFor(() => expect(thread.generatedTitle).toBe('Fix login redirect'))
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fast-model', reasoningEffort: 'low', cwd: '/repo' })
    )
    expect(generateText.mock.calls[0][0].prompt).toContain('The login page redirects in a loop')
    expect(onTitleChanged).toHaveBeenCalledWith('thread')
    service.generateTitleIfMissing('thread')
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('leaves manually titled threads alone and tries a failing thread only once', async () => {
    const titled = setup({ customTitle: 'Mine' })
    titled.service.generateTitleIfMissing('thread')
    expect(titled.generateText).not.toHaveBeenCalled()

    const failing = setup({}, { generate: async () => Promise.reject(new Error('offline')) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    failing.service.generateTitleIfMissing('thread')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    failing.service.generateTitleIfMissing('thread')
    expect(failing.generateText).toHaveBeenCalledTimes(1)
  })

  it('regenerates on request, replacing a manual title', async () => {
    const { service, thread } = setup(
      { customTitle: 'Mine', generatedTitle: 'Old' },
      { prompts: ['First', 'Second'], generate: async () => 'Title: New name' }
    )
    expect(await service.regenerateTitle('thread')).toEqual({ ok: true })
    expect(thread).toMatchObject({ customTitle: null, generatedTitle: 'New name' })
  })

  it('reports why a title could not be written', async () => {
    expect(await setup({}, { prompts: [] }).service.regenerateTitle('thread')).toEqual({
      ok: false,
      error: 'Send a message before naming this thread.'
    })
    expect(
      await setup({}, { generate: async () => '  \n' }).service.regenerateTitle('thread')
    ).toEqual({ ok: false, error: 'Copilot returned an empty title.' })
  })
})

describe('title prompt and reply', () => {
  it('keeps the first message and as many recent ones as fit', () => {
    const long = (text: string): string => text.padEnd(5000, '.')
    const prompt = buildTitlePrompt([
      'first',
      long('skipped'),
      ...['a', 'b', 'c', 'd'].map(long),
      'latest'
    ])
    expect(prompt).toContain('Message 1:\nfirst')
    expect(prompt).toContain('latest')
    expect(prompt).toContain(`Message 2:\nb${'.'.repeat(1499)}…`)
    expect(prompt).not.toContain('skipped')
  })

  it('cleans quotes, labels and trailing punctuation', () => {
    expect(cleanGeneratedTitle('**Title:** "Add dark mode."\nExtra')).toBe('Add dark mode')
    expect(cleanGeneratedTitle('`Refactor the parser`')).toBe('Refactor the parser')
    expect(cleanGeneratedTitle('')).toBeNull()
  })
})
