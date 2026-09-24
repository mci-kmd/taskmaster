import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CopilotClientOptions,
  ModelInfo,
  PermissionRequest,
  SessionConfig,
  SessionEvent
} from '@github/copilot-sdk'
import type { CopilotModelSelection, PersistedThread } from '../../shared/app-types'
import { createCopilotSessionService } from './copilot-session-service'

const harness = vi.hoisted(() => ({
  clientOptions: null as CopilotClientOptions | null,
  clientCount: 0,
  activity: vi.fn(),
  recordPerformanceSample: vi.fn(),
  config: null as SessionConfig | null,
  listener: null as ((event: SessionEvent) => void) | null,
  getEvents: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
  disconnect: vi.fn(),
  setModel: vi.fn(),
  getCurrentModel: vi.fn(),
  listModels: vi.fn(),
  listSkills: vi.fn(),
  invokeCommand: vi.fn(),
  createSession: vi.fn(),
  ping: vi.fn(),
  forceStop: vi.fn(),
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
      runtimePath: 'C:\\runtime\\copilot-runtime.exe',
      module: {
        CopilotClient: class {
          constructor(options: CopilotClientOptions) {
            harness.clientOptions = options
            harness.clientCount += 1
          }
          start = vi.fn()
          stop = vi.fn()
          forceStop = harness.forceStop
          ping = harness.ping
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
function setup(
  globalFlags: string[] = [],
  overrides: Partial<Parameters<typeof createCopilotSessionService>[0]> = {}
): ReturnType<typeof createCopilotSessionService> {
  return createCopilotSessionService({
    resolveThread: (id) => ({
      thread: {
        id,
        agentInterface: 'custom',
        resumeSessionId: null,
        latestCopilotTitle: null
      } as PersistedThread,
      cwd: '/project',
      globalFlags
    }),
    onSessionStarted: vi.fn(),
    onTitleChanged: vi.fn(),
    onUserMessage: vi.fn(),
    onActivity: harness.activity,
    recordPerformanceSample: harness.recordPerformanceSample,
    getPerformanceSamples: () => [],
    ...overrides
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

function shellPermissionRequest(managedApprovalRequired = false): PermissionRequest {
  return {
    kind: 'shell',
    intention: 'Check status',
    fullCommandText: 'git status',
    canOfferSessionApproval: true,
    commands: [{ identifier: 'git', readOnly: true }],
    hasWriteFileRedirection: false,
    possiblePaths: [],
    possibleUrls: [],
    managedApprovalRequired
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.clientOptions = null
  harness.clientCount = 0
  harness.getEvents.mockResolvedValue([])
  harness.getCurrentModel.mockResolvedValue({ modelId: 'model' })
  harness.listSkills.mockResolvedValue({ skills: [] })
  harness.invokeCommand.mockResolvedValue({
    kind: 'agent-prompt',
    prompt: 'Expanded instructions',
    displayPrompt: '/review'
  })
  harness.listModels.mockResolvedValue([])
  harness.ping.mockResolvedValue({ message: 'pong', timestamp: '' })
  harness.forceStop.mockResolvedValue(undefined)
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
        mode: { get: async () => 'plan' },
        skills: { list: harness.listSkills },
        commands: { invoke: harness.invokeCommand }
      },
      on: (listener: (event: SessionEvent) => void) => {
        harness.listener = listener
        return harness.unsubscribe
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('records model usage with call timing, including subagents, and ignores unmeasurable calls', async () => {
  const service = setup()
  await service.start('thread')
  const usage = event('assistant.usage', {
    model: 'model-a',
    outputTokens: 120,
    duration: 2400,
    timeToFirstTokenMs: 310
  })
  harness.listener!(usage)
  expect(harness.recordPerformanceSample).toHaveBeenCalledWith({
    id: usage.id,
    model: 'model-a',
    timestamp: usage.timestamp,
    outputTokens: 120,
    durationMs: 2400,
    timeToFirstTokenMs: 310
  })
  harness.listener!(
    event('assistant.usage', { model: 'model-b', outputTokens: 40, duration: 1000 })
  )
  expect(harness.recordPerformanceSample).toHaveBeenLastCalledWith(
    expect.objectContaining({ model: 'model-b', timeToFirstTokenMs: null })
  )
  harness.listener!(event('assistant.usage', { model: 'model-c', outputTokens: 0, duration: 1000 }))
  harness.listener!(event('assistant.usage', { model: 'model-d', outputTokens: 100, duration: 0 }))
  harness.listener!(
    event(
      'assistant.usage',
      { model: 'subagent', outputTokens: 30, duration: 200 },
      { agentId: 'child' }
    )
  )
  expect(harness.recordPerformanceSample).toHaveBeenCalledTimes(3)
  expect(harness.recordPerformanceSample).toHaveBeenLastCalledWith(
    expect.objectContaining({ model: 'subagent', outputTokens: 30 })
  )
})

describe('global model defaults', () => {
  it('uses the last confirmed choice for new threads in another project and after restart', async () => {
    let saved: CopilotModelSelection | null = null
    const preferences = {
      getModelDefaults: () => saved,
      onModelSelected: (value: CopilotModelSelection) => {
        saved = value
      },
      resolveThread: (id: string) => ({
        thread: {
          id,
          repositoryId: id,
          agentInterface: 'custom',
          resumeSessionId: null
        } as PersistedThread,
        cwd: `/projects/${id}`,
        globalFlags: []
      })
    }
    const service = setup([], preferences)
    await service.start('first')
    harness.getCurrentModel.mockResolvedValue({ modelId: 'chosen-model', reasoningEffort: 'high' })
    expect(
      (
        await service.setModel({
          threadId: 'first',
          model: 'chosen-model',
          reasoningEffort: 'high'
        })
      ).ok
    ).toBe(true)
    expect(saved).toEqual({ model: 'chosen-model', reasoningEffort: 'high' })
    await service.start('second')
    expect(harness.config).toMatchObject({
      workingDirectory: '/projects/second',
      model: 'chosen-model',
      reasoningEffort: 'high'
    })
    await service.shutdown()
    await setup([], preferences).start('third')
    expect(harness.config).toMatchObject({
      workingDirectory: '/projects/third',
      model: 'chosen-model',
      reasoningEffort: 'high'
    })
  })

  it('does not remember rejected model changes or settings the runtime did not apply', async () => {
    const onModelSelected = vi.fn()
    const service = setup([], { onModelSelected })
    await service.start('thread')
    harness.setModel.mockRejectedValueOnce(new Error('Unavailable model'))
    expect(
      (await service.setModel({ threadId: 'thread', model: 'unavailable', reasoningEffort: null }))
        .ok
    ).toBe(false)
    expect(
      (
        await service.setModel({
          threadId: 'thread',
          model: 'different-model',
          reasoningEffort: 'high'
        })
      ).ok
    ).toBe(false)
    expect(onModelSelected).not.toHaveBeenCalled()
  })

  it('keeps the most recent choice when changes in separate threads finish out of order', async () => {
    const onModelSelected = vi.fn()
    const service = setup([], { onModelSelected })
    await service.start('first')
    await service.start('second')
    const pending = deferred<void>()
    harness.setModel.mockReturnValueOnce(pending.promise)
    const first = service.setModel({ threadId: 'first', model: 'earlier', reasoningEffort: 'low' })
    await vi.waitFor(() => expect(harness.setModel).toHaveBeenCalledTimes(1))
    harness.getCurrentModel.mockResolvedValueOnce({ modelId: 'latest', reasoningEffort: 'high' })
    await service.setModel({ threadId: 'second', model: 'latest', reasoningEffort: 'high' })
    harness.getCurrentModel.mockResolvedValueOnce({ modelId: 'earlier', reasoningEffort: 'low' })
    pending.resolve(undefined)
    await first
    expect(onModelSelected).toHaveBeenCalledTimes(1)
    expect(onModelSelected).toHaveBeenCalledWith({ model: 'latest', reasoningEffort: 'high' })
  })
})

describe('background model discovery', () => {
  const catalog = [
    {
      id: 'model',
      name: 'Available model',
      capabilities: { supports: { vision: true } }
    }
  ] as ModelInfo[]

  it('opens threads and accepts prompts before the shared model catalog arrives', async () => {
    const pending = deferred<ModelInfo[]>()
    harness.listModels.mockReturnValueOnce(pending.promise)
    const service = setup()
    const [first, second] = await Promise.all([service.start('first'), service.start('second')])
    expect(first.snapshot).toMatchObject({ phase: 'idle', models: [] })
    expect(second.snapshot).toMatchObject({ phase: 'idle', models: [] })
    expect(harness.listModels).toHaveBeenCalledTimes(1)
    expect(
      (
        await service.send({
          threadId: 'first',
          prompt: 'Hello',
          attachments: [],
          agentMode: 'interactive'
        })
      ).ok
    ).toBe(true)

    pending.resolve(catalog)
    await vi.waitFor(() => {
      for (const id of ['first', 'second']) {
        expect(service.getSession(id)?.models).toEqual([
          expect.objectContaining({ id: 'model', name: 'Available model' })
        ])
      }
    })
    expect(service.getSession('first')?.phase).toBe('running')
    expect(service.getSession('second')?.phase).toBe('idle')
  })

  it('keeps the conversation usable when discovery fails and retries on the next start', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      harness.listModels.mockRejectedValueOnce(new Error('Catalog unavailable'))
      const service = setup()
      expect((await service.start('thread')).snapshot?.phase).toBe('idle')
      expect(warning).toHaveBeenCalled()
      harness.listModels.mockResolvedValueOnce(catalog)
      await service.start('thread')
      await vi.waitFor(() => expect(service.getSession('thread')?.models).toHaveLength(1))
      expect(harness.listModels).toHaveBeenCalledTimes(2)
    } finally {
      warning.mockRestore()
    }
  })

  it('ignores catalog results from a replaced SDK client', async () => {
    const stale = deferred<ModelInfo[]>()
    harness.listModels.mockReturnValueOnce(stale.promise)
    const service = setup()
    await service.start('first')
    harness.ping.mockRejectedValueOnce(new Error('Runtime exited'))
    await service.start('second')
    expect(harness.clientCount).toBe(2)
    stale.resolve(catalog)
    await stale.promise
    expect(service.getSession('second')?.models).toEqual([])
    expect(service.getSession('first')).toBeNull()
  })

  it('can shut down while model discovery is pending without publishing late results', async () => {
    const pending = deferred<ModelInfo[]>()
    harness.listModels.mockReturnValueOnce(pending.promise)
    const service = setup()
    await service.start('thread')
    await service.shutdown()
    harness.broadcast.mockClear()
    pending.resolve(catalog)
    await pending.promise
    expect(service.getSession('thread')).toBeNull()
    expect(harness.broadcast).not.toHaveBeenCalled()
  })
})

describe('Copilot session interactions', () => {
  it('removes inherited Copilot CLI Git prompt restrictions from the runtime', async () => {
    vi.stubEnv('COPILOT_CLI', '1')
    vi.stubEnv('COPILOT_AGENT_SESSION_ID', 'parent-session')
    vi.stubEnv('GCM_INTERACTIVE', 'Never')
    vi.stubEnv('GIT_TERMINAL_PROMPT', '0')
    vi.stubEnv('GIT_ASKPASS', '')
    vi.stubEnv('GIT_CONFIG_COUNT', '1')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'credential.interactive')
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'never')

    const service = setup()
    await service.start('thread')

    const env = harness.clientOptions?.env
    expect(env).toBeDefined()
    for (const key of [
      'COPILOT_CLI',
      'COPILOT_AGENT_SESSION_ID',
      'GCM_INTERACTIVE',
      'GIT_TERMINAL_PROMPT',
      'GIT_ASKPASS',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0'
    ]) {
      expect(env).not.toHaveProperty(key)
    }
    expect(env?.COPILOT_CLI_PATH).toBe('C:\\runtime\\copilot-runtime.exe')
  })

  it('replaces a dead SDK client when reconnecting after startup fails', async () => {
    harness.createSession.mockRejectedValueOnce(
      new Error('fatal: Cannot prompt because user interactivity has been disabled.')
    )
    const service = setup()
    expect((await service.start('thread')).ok).toBe(false)

    harness.ping.mockRejectedValueOnce(new Error('Cannot call write after a stream was destroyed'))
    const result = await service.start('thread')

    expect(result.snapshot?.phase).toBe('idle')
    expect(harness.clientCount).toBe(2)
    expect(harness.forceStop).toHaveBeenCalledTimes(1)
  })

  it('honors --yolo while preserving managed-policy approval prompts', async () => {
    const service = setup(['--yolo'])
    await service.start('thread')

    await expect(
      harness.config!.onPermissionRequest!(shellPermissionRequest(), {
        sessionId: 'session-id'
      })
    ).resolves.toEqual({ kind: 'approve-once' })
    expect(service.getSession('thread')!.pendingInteraction).toBeNull()

    const managedApproval = harness.config!.onPermissionRequest!(shellPermissionRequest(true), {
      sessionId: 'session-id',
      managedSettingsEnabled: true
    })
    const interaction = service.getSession('thread')!.pendingInteraction!
    service.respond({
      threadId: 'thread',
      interactionId: interaction.id,
      action: 'approve-once'
    })
    await expect(managedApproval).resolves.toEqual({
      kind: 'approve-once',
      approvedInteractively: true
    })
  })

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
    harness.disconnect.mockRejectedValueOnce(
      new Error('Cannot call write after a stream was destroyed')
    )
    const result = await service.start('thread')
    expect(harness.disconnect).toHaveBeenCalledTimes(1)
    expect(harness.createSession).toHaveBeenCalledTimes(2)
    expect(harness.forceStop).toHaveBeenCalledTimes(1)
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

it('records activity when a running turn completes, but not when opening an idle session', async () => {
  const service = setup()
  await service.start('thread-1')
  emit('session.idle', {})
  expect(harness.activity).not.toHaveBeenCalled()
  emit('assistant.turn_start', { turnId: 'turn-1' })
  emit('session.idle', {})
  expect(harness.activity).toHaveBeenCalledExactlyOnceWith('thread-1')
  await service.shutdown()
})

describe('session skills and prompt history', () => {
  const skill = {
    name: 'review',
    commandName: 'plugin:review',
    description: 'Review changes',
    source: 'plugin',
    enabled: true,
    userInvocable: true
  }
  const input = {
    threadId: 'thread',
    prompt: '/plugin:review the diff',
    attachments: [],
    agentMode: 'interactive' as const
  }

  it('discovers skills in the session context and excludes disabled or non-invocable skills', async () => {
    harness.listSkills.mockResolvedValue({
      skills: [
        skill,
        { ...skill },
        { ...skill, commandName: 'disabled', enabled: false },
        { ...skill, commandName: 'hidden', userInvocable: false }
      ]
    })
    const service = setup()
    await service.start('thread')
    expect(harness.config).toMatchObject({
      workingDirectory: '/project',
      enableConfigDiscovery: true,
      enableSkills: true
    })
    expect(await service.listSkills('thread')).toEqual({
      skills: [
        {
          name: 'review',
          commandName: 'plugin:review',
          description: 'Review changes',
          source: 'plugin'
        }
      ]
    })
    expect((await service.listSkills('missing')).error).toContain('Connect')
  })

  it('expands selected skills with arguments, retaining the original command and attachments', async () => {
    harness.listSkills.mockResolvedValue({ skills: [skill] })
    const service = setup()
    const attachment = { id: 'a', type: 'file' as const, path: '/repo/file', displayName: 'file' }
    expect((await service.send({ ...input, attachments: [attachment] })).ok).toBe(true)
    expect(harness.invokeCommand).toHaveBeenCalledWith({ name: 'plugin:review', input: 'the diff' })
    expect(harness.send).toHaveBeenCalledWith({
      prompt: 'Expanded instructions',
      displayPrompt: input.prompt,
      agentMode: 'interactive',
      attachments: [{ type: 'file', path: '/repo/file', displayName: 'file' }]
    })
  })

  it('accepts the leading dollar skill syntax without executing arbitrary CLI commands', async () => {
    harness.listSkills.mockResolvedValue({ skills: [skill] })
    const service = setup()
    await service.send({ ...input, prompt: '$plugin:review' })
    expect(harness.invokeCommand).toHaveBeenCalledWith({ name: 'plugin:review', input: '' })
    emit('session.idle', {})
    await service.send({ ...input, prompt: '/clear' })
    expect(harness.invokeCommand).toHaveBeenCalledTimes(1)
    expect(harness.send).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: '/clear' }))
  })

  it('reports catalog failures without breaking the conversation or silently sending a skill', async () => {
    const service = setup()
    await service.start('thread')
    harness.listSkills.mockRejectedValueOnce(new Error('Catalog unavailable'))
    expect(await service.listSkills('thread')).toEqual({ skills: [], error: 'Catalog unavailable' })
    expect(service.getSession('thread')?.phase).toBe('idle')
    harness.listSkills.mockRejectedValueOnce(new Error('Skill lookup failed'))
    expect((await service.send(input)).error).toBe('Skill lookup failed')
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('rejects manually typed disabled skills before invoking or sending', async () => {
    harness.listSkills.mockResolvedValue({ skills: [{ ...skill, enabled: false }] })
    expect((await setup().send(input)).error).toContain('not available')
    expect(harness.invokeCommand).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('does not send a skill after stopping while its expansion is pending', async () => {
    harness.listSkills.mockResolvedValue({ skills: [skill] })
    const expansion = deferred<unknown>()
    harness.invokeCommand.mockReturnValueOnce(expansion.promise)
    const service = setup()
    await service.start('thread')
    const sending = service.send(input)
    await vi.waitFor(() => expect(harness.invokeCommand).toHaveBeenCalled())
    await service.abort('thread')
    expansion.resolve({ kind: 'agent-prompt', prompt: 'Instructions', displayPrompt: '/review' })
    expect((await sending).ok).toBe(false)
    expect(harness.send).not.toHaveBeenCalled()
    expect(service.getSession('thread')?.phase).toBe('idle')
  })

  it('keeps injected context and autopilot continuations out of recalled user prompts', async () => {
    harness.getEvents.mockResolvedValue([
      event('user.message', { content: '/review', source: 'user' }),
      event('user.message', { content: 'Hidden skill instructions', source: 'skill-review' }),
      event('user.message', { content: 'Continue', isAutopilotContinuation: true })
    ])
    const service = setup()
    const result = await service.start('thread')
    expect(result.snapshot?.timeline).toEqual([
      expect.objectContaining({ type: 'user', content: '/review' })
    ])
    emit('user.message', { content: 'More injected instructions', source: 'system' })
    expect(service.getSession('thread')?.timeline).toHaveLength(1)
  })
})

it('expands multiple inline skills once each and preserves the surrounding request', async () => {
  harness.listSkills.mockResolvedValue({
    skills: ['review', 'test'].map((name) => ({
      name,
      description: name,
      source: 'project',
      enabled: true,
      userInvocable: true
    }))
  })
  harness.invokeCommand.mockImplementation(async ({ name }) => ({
    kind: 'agent-prompt',
    prompt: `Instructions for ${name}`,
    displayPrompt: `/${name}`
  }))
  const prompt = 'Use $review and $test, then $review again on this diff'
  const service = setup()
  expect(
    (await service.send({ threadId: 'thread', prompt, attachments: [], agentMode: 'interactive' }))
      .ok
  ).toBe(true)
  expect(harness.invokeCommand).toHaveBeenCalledTimes(2)
  expect(harness.invokeCommand).toHaveBeenCalledWith({ name: 'review', input: prompt })
  expect(harness.send).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: `Instructions for review\n\nInstructions for test\n\n${prompt}`,
      displayPrompt: prompt
    })
  )
})
