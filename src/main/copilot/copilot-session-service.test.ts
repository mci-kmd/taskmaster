import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionConfig, SessionEvent } from '@github/copilot-sdk'
import type { PersistedThread } from '../../shared/app-types'
import { createCopilotSessionService } from './copilot-session-service'

const harness = vi.hoisted(() => ({
  config: null as SessionConfig | null,
  listener: null as ((event: SessionEvent) => void) | null,
  getEvents: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
  disconnect: vi.fn(),
  setModel: vi.fn(),
  getCurrentModel: vi.fn(),
  listModels: vi.fn(),
  createSession: vi.fn(),
  broadcast: vi.fn(),
  unsubscribe: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: harness.broadcast } }] }
}))
vi.mock('./copilot-sdk-manager', () => ({
  CopilotSdkManager: class {
    setStatusListener = vi.fn()
    setRuntimeStatus = vi.fn()
    loadSdk = async (): Promise<unknown> => ({
      version: 'test',
      module: {
        CopilotClient: class {
          start = vi.fn()
          stop = vi.fn()
          getAuthStatus = async (): Promise<unknown> => ({ isAuthenticated: true })
          getStatus = async (): Promise<unknown> => ({ version: 'test' })
          listModels = harness.listModels
          createSession = harness.createSession
          resumeSession = harness.createSession
        }
      }
    })
  }
}))

function event(type: string, data: unknown, extra = {}): SessionEvent {
  return {
    type,
    data,
    id: crypto.randomUUID(),
    timestamp: '2026-09-18T10:00:00Z',
    ...extra
  } as SessionEvent
}
function emit(type: string, data: unknown): void {
  harness.listener!(event(type, data))
}
function setup(): ReturnType<typeof createCopilotSessionService> {
  return createCopilotSessionService({
    resolveThread: (id) => ({
      thread: {
        id,
        agentInterface: 'custom',
        resumeSessionId: null,
        latestCopilotTitle: null
      } as PersistedThread,
      cwd: '/project'
    }),
    onSessionStarted: vi.fn(),
    onTitleChanged: vi.fn(),
    onUserMessage: vi.fn()
  })
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

beforeEach(() => {
  vi.clearAllMocks()
  harness.getEvents.mockResolvedValue([])
  harness.getCurrentModel.mockResolvedValue({ modelId: 'model' })
  harness.listModels.mockResolvedValue([])
  harness.setModel.mockResolvedValue(undefined)
  harness.send.mockResolvedValue('message-id')
  harness.abort.mockResolvedValue(undefined)
  harness.disconnect.mockResolvedValue(undefined)
  harness.createSession.mockImplementation(async (config: SessionConfig) => {
    harness.config = config
    return {
      sessionId: 'session-id',
      getEvents: harness.getEvents,
      send: harness.send,
      abort: harness.abort,
      disconnect: harness.disconnect,
      setModel: harness.setModel,
      rpc: {
        model: { getCurrent: harness.getCurrentModel },
        mode: { get: async () => 'plan' }
      },
      on: (listener: (event: SessionEvent) => void) => {
        harness.listener = listener
        return harness.unsubscribe
      }
    }
  })
})

describe('Copilot session interactions', () => {
  it('queues concurrent approvals, rejects duplicate responses, and preserves later requests', async () => {
    const service = setup()
    await service.start('thread')
    const first = harness.config!.onPermissionRequest!(
      { kind: 'read', intention: 'Read file', path: '/a' },
      { sessionId: 'session-id' }
    )
    const firstId = service.getSession('thread')!.pendingInteraction!.id
    const second = harness.config!.onPermissionRequest!(
      { kind: 'read', intention: 'Read file', path: '/b' },
      { sessionId: 'session-id' }
    )
    expect(service.getSession('thread')!.pendingInteraction!.id).toBe(firstId)
    const response = { threadId: 'thread', interactionId: firstId, action: 'approve-once' as const }
    expect(service.respond(response)).toBe(true)
    expect(service.respond(response)).toBe(false)
    await expect(first).resolves.toEqual({ kind: 'approve-once', approvedInteractively: true })
    const secondId = service.getSession('thread')!.pendingInteraction!.id
    expect(secondId).not.toBe(firstId)
    service.respond({ threadId: 'thread', interactionId: secondId, action: 'reject' })
    await expect(second).resolves.toEqual({ kind: 'reject' })
    expect(service.getSession('thread')!.pendingInteraction).toBeNull()
  })

  it('stops pending approvals and partial streams without leaving the view busy', async () => {
    const service = setup()
    await service.start('thread')
    await service.send({
      threadId: 'thread',
      prompt: 'Hello',
      attachments: [],
      agentMode: 'interactive'
    })
    emit('assistant.message_delta', { messageId: 'reply', deltaContent: 'Partial answer' })
    emit('tool.execution_start', { toolCallId: 'tool', toolName: 'shell' })
    const approval = harness.config!.onPermissionRequest!(
      { kind: 'read', intention: 'Read file', path: '/a' },
      { sessionId: 'session-id' }
    )
    const another = harness.config!.onPermissionRequest!(
      { kind: 'read', intention: 'Read file', path: '/b' },
      { sessionId: 'session-id' }
    )
    await service.abort('thread')
    await expect(approval).resolves.toEqual({ kind: 'reject' })
    await expect(another).resolves.toEqual({ kind: 'reject' })
    expect(service.getSession('thread')).toMatchObject({
      phase: 'idle',
      pendingInteraction: null,
      timeline: [{ content: 'Partial answer', streaming: false }, { status: 'cancelled' }]
    })
  })

  it('does not publish stale interaction state after a thread is stopped', async () => {
    const service = setup()
    await service.start('thread')
    const response = harness.config!.onPermissionRequest!(
      { kind: 'read', intention: 'Read file', path: '/a' },
      { sessionId: 'session-id' }
    )
    await service.stopThread('thread')
    await response
    expect(service.getSession('thread')).toBeNull()
    expect(harness.broadcast.mock.calls.at(-1)?.[1].snapshot.phase).toBe('disconnected')
  })

  it('blocks overlapping sends and model changes while a response runs', async () => {
    const service = setup()
    await service.start('thread')
    const input = {
      threadId: 'thread',
      prompt: 'Hello',
      attachments: [],
      agentMode: 'interactive' as const
    }
    const results = await Promise.all([service.send(input), service.send(input)])
    expect(results.map((result) => result.ok)).toEqual([true, false])
    expect(harness.send).toHaveBeenCalledTimes(1)
    expect(
      (await service.setModel({ threadId: 'thread', model: 'another', reasoningEffort: null })).ok
    ).toBe(false)
    expect(harness.setModel).not.toHaveBeenCalled()
  })

  it('reconnects a failed session rather than returning the same error snapshot', async () => {
    const service = setup()
    await service.start('thread')
    emit('session.error', { message: 'Connection lost' })
    const result = await service.start('thread')
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
    expect(harness.createSession).toHaveBeenCalledTimes(2)
    expect(result.snapshot?.phase).toBe('idle')
  })
})

describe('Copilot timeline hydration', () => {
  it('preserves tool names and partial output at completion, in history and live events', async () => {
    harness.getEvents.mockResolvedValue([
      event('tool.execution_start', {
        toolCallId: 'old',
        toolName: 'shell',
        shellToolInfo: { displayCommand: 'git status' }
      }),
      event('tool.execution_complete', { toolCallId: 'old', success: true }),
      event('assistant.message', { messageId: 'agent', content: 'Nested' }, { agentId: 'child' })
    ])
    const service = setup()
    const result = await service.start('thread')
    expect(result.snapshot).toMatchObject({
      agentMode: 'plan',
      timeline: [{ title: 'shell', detail: 'git status', status: 'complete' }]
    })
    emit('tool.execution_start', { toolCallId: 'live', toolName: 'read_file' })
    emit('tool.execution_partial_result', { toolCallId: 'live', partialOutput: 'File contents' })
    emit('tool.execution_complete', { toolCallId: 'live', success: true })
    expect(service.getSession('thread')!.timeline.at(-1)).toMatchObject({
      title: 'read_file',
      detail: 'File contents',
      status: 'complete'
    })
  })

  it('buffers live events while history loads and makes concurrent starts await hydration', async () => {
    const history = deferred<SessionEvent[]>()
    harness.getEvents.mockReturnValue(history.promise)
    const service = setup()
    const first = service.start('thread')
    await vi.waitFor(() => expect(harness.getEvents).toHaveBeenCalled())
    expect(service.getSession('thread')?.phase).toBe('connecting')
    const second = service.start('thread')
    emit('assistant.message', { messageId: 'live', content: 'Arrived during load' })
    history.resolve([event('user.message', { messageId: 'old', content: 'Earlier message' })])
    const results = await Promise.all([first, second])
    expect(harness.createSession).toHaveBeenCalledTimes(1)
    for (const result of results)
      expect(result.snapshot?.timeline).toMatchObject([
        { content: 'Earlier message' },
        { content: 'Arrived during load' }
      ])
  })

  it('does not revive a thread closed during history hydration', async () => {
    const history = deferred<SessionEvent[]>()
    harness.getEvents.mockReturnValue(history.promise)
    const service = setup()
    const starting = service.start('thread')
    await vi.waitFor(() => expect(harness.getEvents).toHaveBeenCalled())
    const stopping = service.stopThread('thread')
    history.resolve([])
    expect((await starting).ok).toBe(false)
    await stopping
    expect(service.hasSession('thread')).toBe(false)
    expect(harness.unsubscribe).toHaveBeenCalled()
  })
})

it('does not append buffered deltas to a finalized message already present in history', async () => {
  const history = deferred<SessionEvent[]>()
  harness.getEvents.mockReturnValue(history.promise)
  const service = setup()
  const starting = service.start('thread')
  await vi.waitFor(() => expect(harness.getEvents).toHaveBeenCalled())
  emit('assistant.message_delta', { messageId: 'reply', deltaContent: 'Hello' })
  history.resolve([event('assistant.message', { messageId: 'reply', content: 'Hello there' })])
  const result = await starting
  expect(result.snapshot?.timeline).toMatchObject([{ content: 'Hello there' }])
  expect(result.snapshot?.timeline[0]).not.toHaveProperty('streaming', true)
})

it('uses the model default when resetting effort and reports the runtime settings', async () => {
  harness.listModels.mockResolvedValue([
    {
      id: 'model',
      name: 'Model',
      capabilities: { supports: { vision: true } },
      supportedReasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high'
    }
  ])
  const service = setup()
  await service.start('thread')
  harness.getCurrentModel.mockResolvedValue({ modelId: 'model', reasoningEffort: 'high' })
  const result = await service.setModel({
    threadId: 'thread',
    model: 'model',
    reasoningEffort: null
  })
  expect(harness.setModel).toHaveBeenCalledWith('model', {
    reasoningEffort: 'high',
    reasoningSummary: 'concise'
  })
  expect(result.snapshot).toMatchObject({ model: 'model', reasoningEffort: 'high' })
})

it('does not claim a model selection took effect when the runtime kept the existing settings', async () => {
  const service = setup()
  await service.start('thread')
  harness.getCurrentModel.mockResolvedValue({ modelId: 'model', reasoningEffort: 'low' })
  const result = await service.setModel({
    threadId: 'thread',
    model: 'requested-model',
    reasoningEffort: 'high'
  })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('not applied')
  expect(result.snapshot).toMatchObject({ model: 'model', reasoningEffort: 'low' })
})

it('prevents sending while model settings are still being applied', async () => {
  const service = setup()
  await service.start('thread')
  const pending = deferred<void>()
  harness.setModel.mockReturnValueOnce(pending.promise)
  const changing = service.setModel({ threadId: 'thread', model: 'model', reasoningEffort: null })
  await vi.waitFor(() => expect(harness.setModel).toHaveBeenCalled())
  const sending = await service.send({
    threadId: 'thread',
    prompt: 'Hello',
    attachments: [],
    agentMode: 'interactive'
  })
  expect(sending.ok).toBe(false)
  expect(harness.send).not.toHaveBeenCalled()
  pending.resolve(undefined)
  await changing
  expect(
    (
      await service.send({
        threadId: 'thread',
        prompt: 'Hello',
        attachments: [],
        agentMode: 'interactive'
      })
    ).ok
  ).toBe(true)
})
