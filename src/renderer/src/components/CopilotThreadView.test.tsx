// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotApi, CopilotSessionSnapshot, ThreadSnapshot } from '../../../shared/app-types'
import CopilotThreadView from './CopilotThreadView'

const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
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
const input = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message Copilot' })
const send = (): HTMLButtonElement => screen.getByRole('button', { name: 'Send ↑' })
async function ready(): Promise<void> {
  await screen.findByText('Ready')
}

beforeEach(() => {
  vi.resetAllMocks()
  mock.getSession.mockImplementation(async (id) => snapshot(id))
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
afterEach(cleanup)

describe('Copilot session composer', () => {
  it('keeps drafts and attachments per thread, including after changing views', async () => {
    const a = thread(),
      b = thread()
    const attachment = { id: 'file', type: 'file', displayName: 'notes.md', path: '/notes.md' }
    mock.pickAttachments.mockResolvedValue({ ok: true, attachments: [attachment] })
    const view = render(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    await ready()
    fireEvent.change(input(), { target: { value: 'Draft for A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    await screen.findByRole('button', { name: 'Remove notes.md' })
    view.rerender(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    expect(input().value).toBe('')
    expect(screen.queryByRole('button', { name: 'Remove notes.md' })).toBeNull()
    await ready()
    fireEvent.change(input(), { target: { value: 'Draft for B' } })
    view.rerender(<CopilotThreadView thread={a} onSessionChange={vi.fn()} />)
    expect(input().value).toBe('Draft for A')
    expect(screen.getByRole('button', { name: 'Remove notes.md' })).toBeTruthy()
    view.unmount()
    render(<CopilotThreadView thread={b} onSessionChange={vi.fn()} />)
    expect(input().value).toBe('Draft for B')
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
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).disabled).toBe(
      true
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Reasoning effort' }), {
      target: { value: 'high' }
    })
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
