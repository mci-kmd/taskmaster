// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotApi, CopilotSessionSnapshot, ThreadSnapshot } from '../../../shared/app-types'
import CopilotThreadView from './CopilotThreadView'

const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSkills: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
  respond: vi.fn(),
  setModel: vi.fn(),
  getSdkStatus: vi.fn(),
  checkForSdkUpdate: vi.fn(),
  updateSdk: vi.fn(),
  pickAttachments: vi.fn(),
  getPathForFile: vi.fn(),
  onSession: vi.fn(),
  onSdkStatus: vi.fn()
}))
vi.mock('../shared/api/client', () => ({ getRendererApi: () => ({ copilot: mock }) }))
let listener: Parameters<CopilotApi['onSession']>[0]
let threadCount = 0
const thread = (): ThreadSnapshot => ({ id: `test-${++threadCount}` }) as ThreadSnapshot
function snapshot(
  threadId: string,
  patch: Partial<CopilotSessionSnapshot> = {}
): CopilotSessionSnapshot {
  return {
    threadId,
    sessionId: 'session',
    title: null,
    phase: 'idle',
    model: 'model',
    reasoningEffort: null,
    nextModelSelection: null,
    agentMode: 'interactive',
    models: [
      {
        id: 'model',
        name: 'Test model',
        supportsVision: true,
        supportedReasoningEfforts: ['low', 'high'],
        defaultReasoningEffort: null
      }
    ],
    timeline: [],
    pendingInteraction: null,
    error: null,
    ...patch
  }
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((r) => {
      resolve = r
    }),
    resolve: (value) => resolve(value)
  }
}
const input = (): HTMLTextAreaElement => screen.getByRole('combobox', { name: 'Message Copilot' })
const send = (): HTMLButtonElement => screen.getByRole('button', { name: 'Send ↑' })
async function ready(): Promise<void> {
  await screen.findByText('Ready')
}

beforeEach(() => {
  vi.resetAllMocks()
  mock.getSession.mockImplementation(async (id) => snapshot(id))
  mock.listSkills.mockResolvedValue({ skills: [] })
  mock.getSdkStatus.mockResolvedValue(null)
  mock.checkForSdkUpdate.mockResolvedValue(null)
  mock.onSession.mockImplementation((callback) => {
    listener = callback
    return vi.fn()
  })
  mock.onSdkStatus.mockReturnValue(vi.fn())
  mock.send.mockResolvedValue({ ok: true })
  mock.respond.mockResolvedValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function chooseOption(label: string, option: string): void {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  if (label === 'Model') {
    fireEvent.click(screen.getByRole('treeitem', { name: 'Other models' }))
    fireEvent.click(screen.getByRole('treeitem', { name: option }))
  } else {
    fireEvent.click(screen.getByRole('option', { name: option }))
  }
}

describe('Copilot session composer', () => {
  it('keeps drafts and attachments per thread, including after changing views', async () => {
    const a = thread(),
      b = thread()
    const attachment = { id: 'file', type: 'file', displayName: 'notes.md', path: '/notes.md' }
    mock.pickAttachments.mockResolvedValue({ ok: true, attachments: [attachment] })
    const view = render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'Draft for A' } })
    const attach = screen.getByRole('button', { name: 'Attach files' })
    expect(attach.querySelector('svg')).toBeTruthy()
    expect(attach.textContent).not.toContain('＋')
    fireEvent.click(attach)
    await screen.findByRole('button', { name: 'Remove notes.md' })
    view.rerender(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    expect(input().value).toBe('')
    expect(screen.queryByRole('button', { name: 'Remove notes.md' })).toBeNull()
    await ready()
    fireEvent.change(input(), { target: { value: 'Draft for B' } })
    view.rerender(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    expect(input().value).toBe('Draft for A [📎 notes.md] ')
    expect(screen.getByRole('button', { name: 'Remove notes.md' })).toBeTruthy()
    view.unmount()
    render(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    expect(input().value).toBe('Draft for B')
  })

  it('marks pasted and picked files where they were added and shows image thumbnails', async () => {
    const a = thread()
    mock.pickAttachments.mockResolvedValue({
      ok: true,
      attachments: [
        {
          id: 'picked',
          type: 'file',
          path: '/shot.png',
          displayName: 'image.png',
          previewUrl: 'data:image/png;base64,cGlja2Vk'
        }
      ]
    })
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'Compare this with that' } })
    input().setSelectionRange(12, 12)
    const image = new File(['png'], 'image.png', { type: 'image/png' })
    fireEvent.paste(input(), { clipboardData: { files: [image] } })
    const pasted = await screen.findByRole('button', { name: 'Remove image.png' })
    expect(input().value).toBe('Compare this [📎 image.png] with that')
    expect(input().selectionStart).toBe('Compare this [📎 image.png]'.length)
    expect(pasted.querySelector('img')?.getAttribute('src')).toBe(
      `data:image/png;base64,${btoa('png')}`
    )

    input().setSelectionRange(input().value.length, input().value.length)
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    const picked = await screen.findByRole('button', { name: 'Remove image (2).png' })
    expect(picked.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cGlja2Vk')
    expect(input().value).toBe('Compare this [📎 image.png] with that [📎 image (2).png] ')

    fireEvent.click(pasted)
    expect(input().value).toBe('Compare this with that [📎 image (2).png] ')
    const chip = document.querySelector('.tm-session-prompt-marker')
    expect(chip?.textContent).toBe('[📎 image (2).png]')
    expect(chip?.closest('[aria-hidden="true"]')).toBeTruthy()

    const value = input().value
    const inside = value.indexOf('[') + 5
    fireEvent.change(input(), {
      target: {
        value: value.slice(0, inside) + 'x' + value.slice(inside),
        selectionStart: inside + 1,
        selectionEnd: inside + 1
      }
    })
    expect(input().value).toBe('Compare this with that [📎 image (2).png]x ')
    const typed = input().value
    const end = typed.indexOf(']') + 1
    fireEvent.change(input(), {
      target: {
        value: typed.slice(0, end - 1) + typed.slice(end),
        selectionStart: end - 1,
        selectionEnd: end - 1
      }
    })
    expect(input().value).toBe('Compare this with that x ')
    expect(screen.queryByRole('button', { name: 'Remove image (2).png' })).toBeNull()
    expect(document.querySelector('.tm-session-prompt-marker')).toBeNull()
  })

  it('sends files with their markers', async () => {
    const a = thread()
    mock.pickAttachments.mockResolvedValue({
      ok: true,
      attachments: [{ id: 'picked', type: 'file', path: '/a.png', displayName: 'image.png' }]
    })
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'Compare' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByRole('button', { name: 'Remove image.png' })
    input().setSelectionRange(8, 8)
    fireEvent.keyDown(input(), { key: 'ArrowRight' })
    expect(input().selectionStart).toBe('Compare [📎 image.png]'.length)
    fireEvent.keyDown(input(), { key: 'ArrowLeft' })
    expect(input().selectionStart).toBe(8)
    fireEvent.click(send())
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Compare [📎 image.png]',
          attachments: [expect.objectContaining({ id: 'picked', displayName: 'image.png' })]
        })
      )
    )
  })

  it('shows file markers inline in sent messages', async () => {
    const a = thread()
    mock.getSession.mockResolvedValue(
      snapshot(a.id, {
        timeline: [
          {
            id: 'user',
            type: 'user',
            content: 'Look at [📎 a [1].png] then fix it',
            attachments: ['a [1].png', 'notes.md'],
            timestamp: ''
          }
        ]
      })
    )
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    const message = await screen.findByRole('article', { name: 'Your message' })
    const inline = message.querySelector('.tm-session-inline-attachment')
    expect(inline?.textContent).toBe('a [1].png')
    expect(message.textContent).toContain('Look at a [1].png then fix it')
    expect(
      [...message.querySelectorAll('.tm-session-attachment')].map((chip) => chip.textContent)
    ).toEqual(['notes.md'])
  })

  it('retains the draft and recovers controls after a rejected send', async () => {
    mock.send.mockRejectedValueOnce(new Error('Connection lost'))
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'Please fix it' } })
    fireEvent.click(send())
    expect((await screen.findByRole('alert')).textContent).toContain('Connection lost')
    expect(input().value).toBe('Please fix it')
    expect(send().disabled).toBe(false)
    fireEvent.click(send())
    await waitFor(() => expect(input().value).toBe(''))
    expect(mock.send).toHaveBeenCalledTimes(2)
  })

  it('preserves edits made while sending, and prevents duplicate sends', async () => {
    const pending = deferred<{ ok: boolean }>()
    mock.send.mockReturnValue(pending.promise)
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'First message' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.change(input(), { target: { value: 'Next message' } })
    await act(async () => pending.resolve({ ok: true }))
    expect(mock.send).toHaveBeenCalledTimes(1)
    expect(input().value).toBe('Next message')
  })

  it('does not submit IME composition, Shift+Enter, connecting sessions, or running turns', async () => {
    const a = thread()
    mock.getSession.mockResolvedValue(snapshot(a.id, { phase: 'connecting' }))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await act(async () => undefined)
    fireEvent.change(input(), { target: { value: 'Hello' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(mock.send).not.toHaveBeenCalled()
    act(() => listener({ snapshot: snapshot(a.id) }))
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(mock.send).not.toHaveBeenCalled()
    act(() => listener({ snapshot: snapshot(a.id, { phase: 'running' }) }))
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(mock.send).not.toHaveBeenCalled()
    expect(send().disabled).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement).disabled).toBe(
      false
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('ignores late responses from the previously selected thread', async () => {
    const a = thread(),
      b = thread()
    const pending = deferred<CopilotSessionSnapshot>()
    mock.getSession.mockImplementation((id) =>
      id === a.id ? pending.promise : Promise.resolve(snapshot(id))
    )
    const view = render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    view.rerender(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    await ready()
    await act(async () =>
      pending.resolve(
        snapshot(a.id, {
          timeline: [{ id: 'old', type: 'assistant', content: 'Wrong thread', timestamp: '' }]
        })
      )
    )
    expect(screen.queryByText('Wrong thread')).toBeNull()
  })

  it('does not let a late initial snapshot overwrite a newer session event', async () => {
    const a = thread()
    const pending = deferred<CopilotSessionSnapshot>()
    mock.getSession.mockReturnValue(pending.promise)
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          phase: 'running',
          timeline: [{ id: 'new', type: 'assistant', content: 'Latest answer', timestamp: '' }]
        })
      })
    )
    await act(async () => pending.resolve(snapshot(a.id)))
    expect(screen.getByText('Latest answer')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('shows model and approval failures, without swallowing them', async () => {
    const a = thread()
    mock.setModel.mockResolvedValue({ ok: false, error: 'Model unavailable' })
    mock.respond.mockRejectedValue(new Error('Response failed'))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    chooseOption('Reasoning effort', 'High')
    expect((await screen.findByRole('alert')).textContent).toContain('Model unavailable')
    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          phase: 'running',
          pendingInteraction: {
            id: 'permission',
            kind: 'permission',
            title: 'Allow read access?',
            description: '/file',
            allowSessionApproval: false
          }
        })
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Response failed'))
    expect(
      (
        screen
          .getByRole('button', { name: 'Allow once' })
          .closest('fieldset') as HTMLFieldSetElement
      ).disabled
    ).toBe(false)
  })

  it('keeps a scrolled-up reader in place while streaming, then jumps on request', async () => {
    const a = thread()
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    const conversation = screen.getByRole('region', { name: 'Conversation' })
    Object.defineProperties(conversation, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 300 }
    })
    conversation.scrollTop = 200
    fireEvent.scroll(conversation)
    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          phase: 'running',
          timeline: [
            {
              id: 'reply',
              type: 'assistant',
              content: 'Streaming output',
              timestamp: '',
              streaming: true
            }
          ]
        })
      })
    )
    expect(conversation.scrollTop).toBe(200)
    fireEvent.click(screen.getByRole('button', { name: '↓ Jump to latest' }))
    expect(conversation.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: '↓ Jump to latest' })).toBeNull()
  })
})

describe('Copilot session tool groups', () => {
  it('hides empty reasoning without splitting calls and shows it when content arrives', async () => {
    const a = thread()
    const tool = {
      id: 'one',
      type: 'tool' as const,
      title: 'Read file',
      detail: 'File contents',
      status: 'complete' as const,
      timestamp: ''
    }
    const reasoning = {
      id: 'reasoning',
      type: 'reasoning' as const,
      content: ' \n\t ',
      timestamp: '',
      streaming: true
    }
    const timeline = [
      tool,
      reasoning,
      { ...tool, id: 'two' },
      { ...reasoning, id: 'empty', content: '', streaming: false }
    ]
    mock.getSession.mockResolvedValue(snapshot(a.id, { timeline }))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    expect(screen.queryByText('Reasoning')).toBeNull()
    expect(screen.queryByText('Thinking…')).toBeNull()
    expect(screen.getByRole('button', { name: /2 tool calls/ })).toBeTruthy()

    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          timeline: timeline.map((item) =>
            item.id === 'reasoning' ? { ...reasoning, content: 'Compare the two files.' } : item
          )
        })
      })
    )
    expect(screen.getAllByRole('button', { name: /1 tool call/ })).toHaveLength(2)
    expect(screen.getByText('Thinking…').closest('details')).toBeNull()
    expect(screen.getByText('Compare the two files.')).toBeTruthy()
    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          timeline: timeline.map((item) =>
            item.id === 'reasoning'
              ? { ...reasoning, content: 'Compare the two files and decide.', streaming: false }
              : item
          )
        })
      })
    )
    expect(screen.getByText('Reasoning').closest('details')).toBeNull()
    expect(screen.getByText('Compare the two files and decide.')).toBeTruthy()
  })

  it('merges calls across empty assistant messages and restores a boundary when text streams in', async () => {
    const a = thread()
    const tool = (id: string): CopilotSessionSnapshot['timeline'][number] => ({
      id,
      type: 'tool',
      title: 'Read file',
      detail: 'File contents',
      status: 'complete',
      timestamp: ''
    })
    const empty = (id: string, content = ''): CopilotSessionSnapshot['timeline'][number] => ({
      id,
      type: 'assistant',
      content,
      model: 'model',
      timestamp: '',
      streaming: true
    })
    const timeline = [
      empty('leading'),
      tool('one'),
      tool('two'),
      empty('middle', ' \n\t '),
      tool('three'),
      tool('four'),
      empty('trailing'),
      tool('five')
    ]
    mock.getSession.mockResolvedValue(snapshot(a.id, { timeline }))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    expect(screen.getAllByRole('button', { name: /tool calls/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /5 tool calls/ })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Copilot message' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()

    const content = '  Here is what I found.\n'
    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          timeline: timeline.map((item) => (item.id === 'middle' ? { ...item, content } : item))
        })
      })
    )
    expect(screen.getByRole('button', { name: /2 tool calls/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /3 tool calls/ })).toBeTruthy()
    const message = screen.getByRole('article', { name: 'Copilot message' })
    expect(within(message).getByText('Here is what I found.')).toBeTruthy()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    fireEvent.click(within(message).getByRole('button', { name: 'Copy message' }))
    await screen.findByText('Copied')
    expect(writeText).toHaveBeenCalledWith(content)
  })

  it('keeps attachment-only user messages as boundaries without offering to copy empty text', async () => {
    const a = thread()
    const tool = {
      id: 'one',
      type: 'tool' as const,
      title: 'Read file',
      detail: '',
      status: 'complete' as const,
      timestamp: ''
    }
    mock.getSession.mockResolvedValue(
      snapshot(a.id, {
        timeline: [
          tool,
          { id: 'user', type: 'user', content: ' \n ', attachments: ['notes.md'], timestamp: '' },
          { ...tool, id: 'two', detail: ' \t ' }
        ]
      })
    )
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    const message = screen.getByRole('article', { name: 'Your message' })
    expect(within(message).getByText('notes.md')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
    const groups = screen.getAllByRole('button', { name: /1 tool call/ })
    expect(groups).toHaveLength(2)
    for (const group of groups) fireEvent.click(group)
    expect(screen.queryByRole('button', { name: 'Copy output' })).toBeNull()
  })

  it('collapses consecutive calls without grouping across messages, reasoning, or notices', async () => {
    const a = thread()
    const tool = (id: string): CopilotSessionSnapshot['timeline'][number] => ({
      id,
      type: 'tool',
      title: 'Read file',
      detail: `Output ${id}`,
      status: 'complete',
      timestamp: ''
    })
    mock.getSession.mockResolvedValue(
      snapshot(a.id, {
        timeline: [
          tool('one'),
          tool('two'),
          { id: 'assistant', type: 'assistant', content: 'Checking the result', timestamp: '' },
          tool('three'),
          { id: 'reasoning', type: 'reasoning', content: 'Consider the next step', timestamp: '' },
          tool('four'),
          {
            id: 'notice',
            type: 'notice',
            tone: 'warning',
            content: 'Check permissions',
            timestamp: ''
          },
          tool('five'),
          { id: 'user', type: 'user', content: 'Continue please', timestamp: '' },
          tool('six')
        ]
      })
    )
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    const conversation = screen.getByRole('region', { name: 'Conversation' })
    const groups = within(conversation).getAllByRole('button', { name: /tool calls?/ })
    expect(groups).toHaveLength(5)
    expect(groups[0].textContent).toContain('2 tool callsRead file ×2Done')
    expect(groups.every((group) => group.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(screen.queryByText('Output one')).toBeNull()
    const ordered = [
      groups[0],
      screen.getByText('Checking the result'),
      groups[1],
      screen.getByText('Reasoning'),
      groups[2],
      screen.getByText('Check permissions'),
      groups[3],
      screen.getByText('Continue please'),
      groups[4]
    ]
    for (let index = 1; index < ordered.length; index++) {
      expect(
        ordered[index - 1].compareDocumentPosition(ordered[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    fireEvent.click(groups[0])
    const details = screen.getByRole('region', { name: 'Tool calls' })
    expect(groups[0].getAttribute('aria-controls')).toBe(details.id)
    const call = within(details).getByText('Output one').closest('details')!
    expect(call.open).toBe(false)
    fireEvent.click(call.querySelector('summary')!)
    expect(call.open).toBe(true)
    expect(within(call).getByRole('button', { name: 'Copy output' })).toBeTruthy()
    fireEvent.click(groups[0])
    expect(screen.queryByRole('region', { name: 'Tool calls' })).toBeNull()
  })

  it('preserves expansion as calls arrive and exposes running, failed, and stopped status', async () => {
    const a = thread()
    const first = {
      id: 'one',
      type: 'tool' as const,
      title: 'Read file',
      detail: 'File contents',
      status: 'running' as const,
      timestamp: ''
    }
    mock.getSession.mockResolvedValue(snapshot(a.id, { timeline: [first], phase: 'running' }))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    const group = await screen.findByRole('button', { name: /1 tool call.*1 running/ })
    fireEvent.click(group)
    const next: CopilotSessionSnapshot['timeline'] = [
      { ...first, status: 'complete' },
      { ...first, id: 'two', title: 'Run tests', detail: 'Tests failed', status: 'failed' },
      { ...first, id: 'three', title: 'Check types', detail: 'Checking', status: 'running' }
    ]
    act(() => listener({ snapshot: snapshot(a.id, { timeline: next, phase: 'running' }) }))
    expect(
      screen.getByRole('button', { name: /3 tool calls.*Check types.*1 running · 1 failed/ })
    ).toBe(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Tests failed').closest('details')!.open).toBe(true)
    fireEvent.click(group)
    act(() =>
      listener({
        snapshot: snapshot(a.id, {
          timeline: next.map((item) =>
            item.type === 'tool' && item.status === 'running'
              ? { ...item, status: 'cancelled' }
              : item
          )
        })
      })
    )
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(group.textContent).toContain('1 failed · 1 stopped')
    expect(group.textContent).not.toContain('running')
  })
})

describe('Copilot session settings and surrounding controls', () => {
  it('selects model and effort while working and marks them for the next message', async () => {
    const a = thread()
    const running = snapshot(a.id, {
      phase: 'running',
      models: [
        ...snapshot(a.id).models,
        {
          id: 'other',
          name: 'Other model',
          supportsVision: false,
          supportedReasoningEfforts: ['low', 'high'],
          defaultReasoningEffort: 'low'
        }
      ]
    })
    mock.getSession.mockResolvedValue(running)
    mock.setModel.mockImplementation(async ({ model, reasoningEffort }) => ({
      ok: true,
      snapshot: {
        ...running,
        nextModelSelection: { model, reasoningEffort }
      }
    }))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await screen.findByText('Working…')
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement).disabled).toBe(
      false
    )
    chooseOption('Model', 'Other model')
    await screen.findByText('For next message')
    expect(mock.setModel).toHaveBeenCalledWith({
      threadId: a.id,
      model: 'other',
      reasoningEffort: 'low'
    })
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement).value).toBe(
      'other'
    )
    chooseOption('Reasoning effort', 'High')
    await waitFor(() =>
      expect(mock.setModel).toHaveBeenLastCalledWith({
        threadId: a.id,
        model: 'other',
        reasoningEffort: 'high'
      })
    )
    expect(send().disabled).toBe(true)
  })

  it('applies a model and its default effort, shows progress, and preserves the draft', async () => {
    const a = thread()
    const initial = snapshot(a.id)
    initial.models.push({
      id: 'other',
      name: 'Other model',
      supportsVision: false,
      supportedReasoningEfforts: ['medium', 'high'],
      defaultReasoningEffort: 'medium'
    })
    mock.getSession.mockResolvedValue(initial)
    const pending = deferred<{ ok: boolean; snapshot: CopilotSessionSnapshot }>()
    mock.setModel.mockReturnValue(pending.promise)
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'Keep my draft' } })
    chooseOption('Model', 'Other model')
    expect(mock.setModel).toHaveBeenCalledWith({
      threadId: a.id,
      model: 'other',
      reasoningEffort: 'medium'
    })
    expect(screen.getByText('Applying model settings…')).toBeTruthy()
    expect(send().disabled).toBe(true)
    const applied = { ...initial, model: 'other', reasoningEffort: 'medium' as const }
    await act(async () => pending.resolve({ ok: true, snapshot: applied }))
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement).value).toBe(
      'other'
    )
    expect(
      (screen.getByRole('combobox', { name: 'Reasoning effort' }) as HTMLButtonElement).value
    ).toBe('medium')
    expect(input().value).toBe('Keep my draft')
    mock.setModel.mockResolvedValue({ ok: true, snapshot: { ...applied, reasoningEffort: 'high' } })
    chooseOption('Reasoning effort', 'High')
    await waitFor(() =>
      expect(mock.setModel).toHaveBeenLastCalledWith({
        threadId: a.id,
        model: 'other',
        reasoningEffort: 'high'
      })
    )
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Reasoning effort' }) as HTMLButtonElement).value
      ).toBe('high')
    )
  })

  it('retains the active model after a failed change and hides unsupported reasoning controls', async () => {
    const a = thread()
    const initial = snapshot(a.id)
    initial.models.push({
      id: 'plain',
      name: 'Plain model',
      supportsVision: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null
    })
    mock.getSession.mockResolvedValue(initial)
    mock.setModel.mockResolvedValueOnce({
      ok: false,
      error: 'Model unavailable',
      snapshot: initial
    })
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    chooseOption('Model', 'Plain model')
    await screen.findByRole('alert')
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement).value).toBe(
      'model'
    )
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toBeTruthy()
    mock.setModel.mockResolvedValueOnce({
      ok: true,
      snapshot: { ...initial, model: 'plain', reasoningEffort: null }
    })
    chooseOption('Model', 'Plain model')
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull()
    )
    expect(mock.setModel).toHaveBeenLastCalledWith({
      threadId: a.id,
      model: 'plain',
      reasoningEffort: null
    })
  })

  it('keeps an unavailable current model visible instead of silently showing another model', async () => {
    const a = thread()
    mock.getSession.mockResolvedValue(snapshot(a.id, { model: 'legacy-model', models: [] }))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    const model = screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement
    expect(model.value).toBe('legacy-model')
    expect(model.disabled).toBe(true)
    expect(model.textContent).toBe('legacy-model')
  })

  it('uses the selected mode for the next message and follows subsequent runtime mode changes', async () => {
    const a = thread()
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    chooseOption('Agent mode', 'Plan')
    fireEvent.change(input(), { target: { value: 'Plan this feature' } })
    mock.send.mockImplementation(async () => {
      act(() => listener({ snapshot: snapshot(a.id, { phase: 'running', agentMode: 'plan' }) }))
      return { ok: true }
    })
    fireEvent.click(send())
    await waitFor(() => expect(input().value).toBe(''))
    expect(mock.send).toHaveBeenCalledWith({
      threadId: a.id,
      prompt: 'Plan this feature',
      attachments: [],
      agentMode: 'plan'
    })
    act(() =>
      listener({ snapshot: snapshot(a.id, { phase: 'running', agentMode: 'interactive' }) })
    )
    expect((screen.getByRole('combobox', { name: 'Agent mode' }) as HTMLButtonElement).value).toBe(
      'interactive'
    )
  })

  it('keeps Stop available during file selection and prevents duplicate aborts', async () => {
    const a = thread()
    const picker = deferred<{ ok: boolean; cancelled: boolean }>()
    const abort = deferred<boolean>()
    mock.getSession.mockResolvedValue(snapshot(a.id, { phase: 'running' }))
    mock.pickAttachments.mockReturnValue(picker.promise)
    mock.abort.mockReturnValue(abort.promise)
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await screen.findByText('Working…')
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    fireEvent.click(stop)
    fireEvent.click(screen.getByRole('button', { name: 'Stopping…' }))
    expect(mock.abort).toHaveBeenCalledTimes(1)
    act(() => listener({ snapshot: snapshot(a.id) }))
    expect(send().disabled).toBe(true)
    await act(async () => {
      abort.resolve(true)
      picker.resolve({ ok: false, cancelled: true })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stopping…' })).toBeNull()
  })

  it('offers a retry after Stop fails', async () => {
    const a = thread()
    mock.getSession.mockResolvedValue(snapshot(a.id, { phase: 'running' }))
    mock.abort.mockRejectedValueOnce(new Error('Stop failed'))
    render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Stop failed')
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not let a late update check replace newer connection status', async () => {
    const check = deferred<{ installedVersion: string }>()
    mock.checkForSdkUpdate.mockReturnValue(check.promise)
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    const onStatus = mock.onSdkStatus.mock.calls[0][0]
    act(() => onStatus({ status: { installedVersion: '2.0.0', runtimeVersion: 'current' } }))
    await act(async () => check.resolve({ installedVersion: '1.0.0' }))
    expect(screen.getByRole('status').getAttribute('title')).toContain('2.0.0')
  })
})

describe('prompt recall and skill completions', () => {
  const skills = [
    {
      name: 'review',
      commandName: 'review',
      description: 'Review code changes',
      source: 'project',
      argumentHint: '[files]'
    },
    {
      name: 'test',
      commandName: 'test',
      description: 'Run the test suite',
      source: 'personal-copilot'
    }
  ]
  const historyItems = [
    { id: 'one', type: 'user' as const, content: 'First request', timestamp: '' },
    { id: 'two', type: 'assistant' as const, content: 'An answer', timestamp: '' },
    { id: 'three', type: 'user' as const, content: 'Second request', timestamp: '' },
    { id: 'four', type: 'user' as const, content: 'Second request', timestamp: '' },
    { id: 'five', type: 'user' as const, content: '', timestamp: '', attachments: ['image.png'] }
  ]

  it('recalls sent prompts in order, skips duplicates and attachments, and returns to an empty draft', async () => {
    mock.getSession.mockImplementation(async (id) => snapshot(id, { timeline: historyItems }))
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('Second request')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('First request')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('First request')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().value).toBe('Second request')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().value).toBe('')
  })

  it('protects edited drafts, attached files, modifier keys and IME from history navigation', async () => {
    mock.getSession.mockImplementation(async (id) => snapshot(id, { timeline: historyItems }))
    mock.pickAttachments.mockResolvedValue({
      ok: true,
      attachments: [{ id: 'a', type: 'file', path: '/notes', displayName: 'notes' }]
    })
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.keyDown(input(), { key: 'ArrowUp', isComposing: true })
    fireEvent.keyDown(input(), { key: 'ArrowUp', ctrlKey: true })
    expect(input().value).toBe('')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.change(input(), { target: { value: 'Edited recall' } })
    input().setSelectionRange(0, 0)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('Edited recall')
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByRole('button', { name: 'Remove notes' })
    expect(input().value).toBe('[📎 notes] ')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('[📎 notes] ')
  })

  it('uses restored session history and keeps recall isolated when switching threads', async () => {
    const a = thread(),
      b = thread()
    mock.getSession.mockImplementation(async (id) =>
      snapshot(id, { timeline: id === a.id ? historyItems : [] })
    )
    const view = render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('Second request')
    view.rerender(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('')
    fireEvent.change(input(), { target: { value: 'B draft' } })
    view.rerender(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    expect(input().value).toBe('Second request')
  })

  it('filters skills by description, completes with Tab or Enter, and only sends on a later Enter', async () => {
    mock.listSkills.mockResolvedValue({ skills })
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: '/suite' } })
    const option = await screen.findByRole('option', { name: /\/test/ })
    expect(option.textContent).toContain('personal copilot')
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(input().value).toBe('/test ')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(mock.send).not.toHaveBeenCalled()
    fireEvent.change(input(), { target: { value: '/' } })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input().value).toBe('/test ')
    expect(mock.send).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ prompt: '/test' }))
    )
  })

  it('dismisses skills with Escape, keeps multiline editing, and replaces just the command token', async () => {
    mock.listSkills.mockResolvedValue({ skills })
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: '$rev' } })
    await screen.findByRole('option', { name: /\$review/ })
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    expect(input().value).toBe('$rev')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input().value).toBe('$rev')
    fireEvent.change(input(), {
      target: { value: '/rev existing arguments', selectionStart: 4, selectionEnd: 4 }
    })
    fireEvent.click(await screen.findByRole('option', { name: /\/review/ }))
    expect(input().value).toBe('/review existing arguments')
    expect(input().selectionStart).toBe(8)
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(mock.send).not.toHaveBeenCalled()
  })

  it('shows loading, failure and empty states without losing the draft', async () => {
    const loading = deferred<{ skills: typeof skills }>()
    mock.listSkills.mockReturnValueOnce(loading.promise)
    render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: '/' } })
    expect(screen.getByText('Loading skills…')).toBeTruthy()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(mock.send).not.toHaveBeenCalled()
    await act(async () => loading.resolve({ skills: [] }))
    expect(screen.getByText('No skills available for this session.')).toBeTruthy()
    expect(input().value).toBe('/')
  })

  it('does not show another thread’s skills from a late catalog response', async () => {
    const a = thread(),
      b = thread()
    const loading = deferred<{ skills: typeof skills }>()
    mock.listSkills.mockImplementation((id) =>
      id === a.id ? loading.promise : Promise.resolve({ skills: [] })
    )
    const view = render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    view.rerender(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: '/' } })
    await act(async () => loading.resolve({ skills }))
    expect(screen.queryByRole('option', { name: /\/review/ })).toBeNull()
    expect(screen.getByText('No skills available for this session.')).toBeTruthy()
  })
})

it('completes inline dollar references while preserving the surrounding draft', async () => {
  mock.listSkills.mockResolvedValue({
    skills: [
      { name: 'review', commandName: 'review', description: 'Review code', source: 'project' }
    ]
  })
  render(<CopilotThreadView thread={thread()} onSessionChange={vi.fn()} />)
  await ready()
  fireEvent.change(input(), {
    target: { value: 'Please use $rev on this diff', selectionStart: 15, selectionEnd: 15 }
  })
  fireEvent.click(await screen.findByRole('option', { name: /\$review/ }))
  expect(input().value).toBe('Please use $review on this diff')
  expect(input().selectionStart).toBe(19)
  expect(mock.send).not.toHaveBeenCalled()
})
