import { randomUUID } from 'crypto'
import { basename } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import type {
  CopilotAttachment,
  CopilotInteraction,
  CopilotInteractionResponse,
  CopilotModelOption,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSendInput,
  CopilotSessionSnapshot,
  CopilotSetModelInput,
  CopilotStartResult,
  CopilotTimelineItem,
  PersistedThread
} from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { sendIpc } from '../ipc/typed-ipc'
import type {
  CopilotClient,
  CopilotSession,
  AutoModeSwitchRequest,
  AutoModeSwitchResponse,
  ElicitationContext,
  ElicitationResult,
  ExitPlanModeRequest,
  ExitPlanModeResult,
  ModelInfo,
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent
} from '@github/copilot-sdk'
import { CopilotSdkManager } from './copilot-sdk-manager'
import { createCopilotRuntimeConnection } from './copilot-runtime-connection'
import { collectCopilotSdkUpdateBlockers } from './copilot-update-guard'

type ThreadContext = {
  thread: PersistedThread
  cwd: string
}

type UserInputRequest = {
  question: string
  choices?: string[]
  allowFreeform?: boolean
}

type UserInputResponse = {
  answer: string
  wasFreeform: boolean
}

type PendingInteraction = {
  interaction: CopilotInteraction
  resolve: (response: CopilotInteractionResponse) => void
}

type ActiveSession = {
  session: CopilotSession
  snapshot: CopilotSessionSnapshot
  pending: PendingInteraction | null
  unsubscribe: () => void
}

type ClientEntry = {
  client: CopilotClient
  models: CopilotModelOption[]
}

type StartOperation = {
  cancelled: boolean
  promise: Promise<CopilotStartResult>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function mapModel(model: ModelInfo): CopilotModelOption {
  return {
    id: model.id,
    name: model.name,
    supportsVision: model.capabilities.supports.vision,
    supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
    defaultReasoningEffort: model.defaultReasoningEffort ?? null
  }
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const name = record.displayName ?? record.fileName ?? record.path
      return typeof name === 'string' ? name : null
    })
    .filter((name): name is string => name !== null)
}

function getToolDetail(data: Record<string, unknown>): string {
  const error = data.error
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  const result = data.result
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>
    for (const key of ['content', 'textResultForLlm', 'output']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return ''
}

function timelineItemFromEvent(event: SessionEvent): CopilotTimelineItem | null {
  switch (event.type) {
    case 'user.message':
      return {
        id: `user:${event.data.messageId ?? event.id}`,
        type: 'user',
        content: event.data.content,
        timestamp: event.timestamp,
        attachments: attachmentNames(event.data.attachments)
      }
    case 'assistant.message':
      return {
        id: `assistant:${event.data.messageId}`,
        type: 'assistant',
        content: event.data.content,
        timestamp: event.timestamp,
        model: event.data.model
      }
    case 'assistant.reasoning':
      return {
        id: `reasoning:${event.data.reasoningId}`,
        type: 'reasoning',
        content: event.data.content,
        timestamp: event.timestamp
      }
    case 'tool.execution_start':
      return {
        id: `tool:${event.data.toolCallId}`,
        type: 'tool',
        title: event.data.toolDescription?.name ?? event.data.toolName,
        detail:
          event.data.shellToolInfo?.displayCommand ??
          (event.data.arguments ? formatJson(event.data.arguments) : ''),
        timestamp: event.timestamp,
        status: 'running'
      }
    case 'tool.execution_complete':
      return {
        id: `tool:${event.data.toolCallId}`,
        type: 'tool',
        title: event.data.toolDescription?.name ?? 'Tool',
        detail: getToolDetail(event.data as unknown as Record<string, unknown>),
        timestamp: event.timestamp,
        status: event.data.success ? 'complete' : 'failed'
      }
    case 'session.error':
      return {
        id: `error:${event.id}`,
        type: 'notice',
        content: event.data.message,
        timestamp: event.timestamp,
        tone: 'error'
      }
    case 'session.warning':
      return {
        id: `warning:${event.id}`,
        type: 'notice',
        content: event.data.message,
        timestamp: event.timestamp,
        tone: 'warning'
      }
    default:
      return null
  }
}

function normalizeElicitationSchema(
  context: ElicitationContext
): Extract<CopilotInteraction, { kind: 'elicitation' }>['schema'] {
  if (!context.requestedSchema) return undefined

  return {
    properties: Object.fromEntries(
      Object.entries(context.requestedSchema.properties).map(([name, field]) => {
        let options: string[] | undefined
        if ('enum' in field && Array.isArray(field.enum)) {
          options = field.enum
        } else if ('oneOf' in field && Array.isArray(field.oneOf)) {
          options = field.oneOf.map((option) => option.const)
        } else if (
          field.type === 'array' &&
          'items' in field &&
          field.items &&
          typeof field.items === 'object'
        ) {
          if ('enum' in field.items && Array.isArray(field.items.enum)) {
            options = field.items.enum
          } else if ('anyOf' in field.items && Array.isArray(field.items.anyOf)) {
            options = field.items.anyOf.map((option) => option.const)
          }
        }

        return [
          name,
          {
            type: field.type,
            title: field.title,
            description: field.description,
            default: field.default,
            options
          }
        ]
      })
    ),
    required: context.requestedSchema.required ?? []
  }
}

function permissionDescription(request: PermissionRequest): string {
  switch (request.kind) {
    case 'shell':
      return request.fullCommandText
    case 'read':
    case 'write':
      return formatJson(request)
    case 'url':
      return request.url
    case 'mcp':
      return `${request.serverName}: ${request.toolName}`
    default:
      return formatJson(request)
  }
}

export function createCopilotSessionService(dependencies: {
  resolveThread: (threadId: string) => ThreadContext | null
  getGlobalFlags: () => string[]
  onSessionStarted: (threadId: string, sessionId: string) => void
  onTitleChanged: (threadId: string, title: string) => void
  onUserMessage: (threadId: string, message: string) => void
}): {
  getSdkStatus: () => Promise<CopilotSdkStatus>
  checkForSdkUpdate: () => Promise<CopilotSdkStatus>
  updateSdk: () => Promise<CopilotSdkStatus>
  start: (threadId: string) => Promise<CopilotStartResult>
  getSession: (threadId: string) => CopilotSessionSnapshot | null
  send: (input: CopilotSendInput) => Promise<CopilotStartResult>
  abort: (threadId: string) => Promise<boolean>
  setModel: (input: CopilotSetModelInput) => Promise<CopilotStartResult>
  respond: (input: CopilotInteractionResponse) => boolean
  pickAttachments: () => Promise<{
    ok: boolean
    attachments?: CopilotAttachment[]
    cancelled?: boolean
    error?: string
  }>
  stopThread: (threadId: string) => Promise<void>
  hasSession: (threadId: string) => boolean
  shutdown: () => Promise<void>
} {
  const sdkManager = new CopilotSdkManager()
  const sessions = new Map<string, ActiveSession>()
  const startingThreads = new Map<string, StartOperation>()
  const clients = new Map<string, ClientEntry>()
  const clientPromises = new Map<string, Promise<ClientEntry>>()
  let sdkUpdateInProgress = false

  const broadcastSession = (snapshot: CopilotSessionSnapshot): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendIpc(window.webContents, IPC_CHANNELS.copilot.session, { snapshot })
    }
  }

  sdkManager.setStatusListener((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendIpc(window.webContents, IPC_CHANNELS.copilot.sdkStatus, { status })
    }
  })

  const updateSnapshot = (active: ActiveSession, patch: Partial<CopilotSessionSnapshot>): void => {
    active.snapshot = { ...active.snapshot, ...patch }
    broadcastSession(active.snapshot)
  }

  const upsertTimeline = (active: ActiveSession, item: CopilotTimelineItem): void => {
    const index = active.snapshot.timeline.findIndex((existing) => existing.id === item.id)
    const timeline = [...active.snapshot.timeline]
    if (index >= 0) {
      timeline[index] = item
    } else {
      timeline.push(item)
    }
    updateSnapshot(active, { timeline })
  }

  const createInteraction = (
    active: ActiveSession,
    interaction: CopilotInteraction
  ): Promise<CopilotInteractionResponse> =>
    new Promise((resolve) => {
      if (active.pending) {
        active.pending.resolve({
          threadId: active.snapshot.threadId,
          interactionId: active.pending.interaction.id,
          action: 'cancel'
        })
      }
      active.pending = { interaction, resolve }
      updateSnapshot(active, { pendingInteraction: interaction })
    })

  const clearInteraction = (active: ActiveSession, interactionId: string): void => {
    if (active.pending?.interaction.id !== interactionId) return
    active.pending = null
    updateSnapshot(active, { pendingInteraction: null })
  }

  const permissionHandler = (active: ActiveSession) => {
    return async (request: PermissionRequest): Promise<PermissionRequestResult> => {
      const interaction: CopilotInteraction = {
        id: randomUUID(),
        kind: 'permission',
        title: `Allow ${request.kind} access?`,
        description: permissionDescription(request),
        allowSessionApproval: request.kind !== 'shell' || Boolean(request.canOfferSessionApproval)
      }
      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      if (response.action === 'approve-session') return { kind: 'approve-for-session' }
      if (response.action === 'approve-once') {
        return { kind: 'approve-once', approvedInteractively: true }
      }
      return { kind: 'reject' }
    }
  }

  const userInputHandler = (active: ActiveSession) => {
    return async (request: UserInputRequest): Promise<UserInputResponse> => {
      const interaction: CopilotInteraction = {
        id: randomUUID(),
        kind: 'user-input',
        title: 'Copilot needs your input',
        description: request.question,
        choices: request.choices ?? [],
        allowFreeform: request.allowFreeform ?? true
      }
      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      return {
        answer: response.action === 'accept' ? (response.value ?? '') : '',
        wasFreeform: response.wasFreeform ?? true
      }
    }
  }

  const elicitationHandler = (active: ActiveSession) => {
    return async (context: ElicitationContext): Promise<ElicitationResult> => {
      const interaction: CopilotInteraction = {
        id: randomUUID(),
        kind: 'elicitation',
        title: context.elicitationSource
          ? `Input requested by ${context.elicitationSource}`
          : 'Copilot needs more information',
        description: context.message,
        mode: context.mode ?? 'form',
        url: context.url,
        schema: normalizeElicitationSchema(context)
      }

      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      return response.action === 'accept'
        ? { action: 'accept', content: response.values }
        : { action: response.action === 'decline' ? 'decline' : 'cancel' }
    }
  }

  const exitPlanModeHandler = (active: ActiveSession) => {
    return async (request: ExitPlanModeRequest): Promise<ExitPlanModeResult> => {
      const interaction: CopilotInteraction = {
        id: randomUUID(),
        kind: 'user-input',
        title: 'Plan ready',
        description: request.planContent ?? request.summary,
        choices: request.actions,
        allowFreeform: false
      }
      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      return response.action === 'accept'
        ? { approved: true, selectedAction: response.value }
        : { approved: false }
    }
  }

  const autoModeSwitchHandler = (active: ActiveSession) => {
    return async (request: AutoModeSwitchRequest): Promise<AutoModeSwitchResponse> => {
      const wait = request.retryAfterSeconds
        ? ` The current limit resets in about ${request.retryAfterSeconds} seconds.`
        : ''
      const interaction: CopilotInteraction = {
        id: randomUUID(),
        kind: 'user-input',
        title: 'Switch to Auto?',
        description: `The current model hit a rate limit.${wait}`,
        choices: ['Switch once', 'Always switch', 'Stay on current model'],
        allowFreeform: false
      }
      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      if (response.value === 'Switch once') return 'yes'
      if (response.value === 'Always switch') return 'yes_always'
      return 'no'
    }
  }

  const handleEvent = (active: ActiveSession, event: SessionEvent): void => {
    if (event.agentId) return

    if (event.type === 'assistant.message_delta') {
      const id = `assistant:${event.data.messageId}`
      const existing = active.snapshot.timeline.find((item) => item.id === id)
      upsertTimeline(active, {
        id,
        type: 'assistant',
        content:
          existing?.type === 'assistant'
            ? `${existing.content}${event.data.deltaContent}`
            : event.data.deltaContent,
        timestamp: event.timestamp,
        streaming: true,
        model: active.snapshot.model ?? undefined
      })
      return
    }

    if (event.type === 'assistant.reasoning_delta') {
      const id = `reasoning:${event.data.reasoningId}`
      const existing = active.snapshot.timeline.find((item) => item.id === id)
      upsertTimeline(active, {
        id,
        type: 'reasoning',
        content:
          existing?.type === 'reasoning'
            ? `${existing.content}${event.data.deltaContent}`
            : event.data.deltaContent,
        timestamp: event.timestamp,
        streaming: true
      })
      return
    }

    if (event.type === 'tool.execution_partial_result') {
      const id = `tool:${event.data.toolCallId}`
      const existing = active.snapshot.timeline.find((item) => item.id === id)
      if (existing?.type === 'tool') {
        upsertTimeline(active, {
          ...existing,
          detail: `${existing.detail}${event.data.partialOutput}`
        })
      }
      return
    }

    const item = timelineItemFromEvent(event)
    if (item) upsertTimeline(active, item)

    switch (event.type) {
      case 'user.message':
        dependencies.onUserMessage(active.snapshot.threadId, event.data.content)
        break
      case 'session.title_changed':
        dependencies.onTitleChanged(active.snapshot.threadId, event.data.title)
        updateSnapshot(active, { title: event.data.title })
        break
      case 'session.model_change':
        updateSnapshot(active, {
          model: event.data.newModel,
          reasoningEffort: (event.data.reasoningEffort as CopilotReasoningEffort | null) ?? null
        })
        break
      case 'session.idle':
        updateSnapshot(active, { phase: 'idle' })
        break
      case 'session.error':
        updateSnapshot(active, { phase: 'error', error: event.data.message })
        break
    }
  }

  const ensureClient = async (globalFlags: string[]): Promise<ClientEntry> => {
    const loaded = await sdkManager.loadSdk()
    const key = JSON.stringify([loaded.version, globalFlags])
    const existing = clients.get(key)
    if (existing) return existing
    const pending = clientPromises.get(key)
    if (pending) return pending

    const clientPromise = (async (): Promise<ClientEntry> => {
      const nextClient = new loaded.module.CopilotClient({
        connection: createCopilotRuntimeConnection(
          loaded.module.RuntimeConnection,
          loaded.runtimePath,
          globalFlags
        ),
        mode: 'copilot-cli',
        useLoggedInUser: true,
        logLevel: 'warning',
        clientInfo: {
          applicationName: 'Taskmaster',
          applicationVersion: app.getVersion(),
          integrationName: 'copilot-sdk',
          integrationVersion: loaded.version
        }
      })

      try {
        await nextClient.start()
        const [auth, runtime] = await Promise.all([
          nextClient.getAuthStatus(),
          nextClient.getStatus()
        ])
        await sdkManager.setRuntimeStatus({
          authenticated: auth.isAuthenticated,
          authLabel: auth.login ?? auth.statusMessage ?? auth.authType ?? null,
          runtimeVersion: runtime.version
        })
        if (!auth.isAuthenticated) {
          throw new Error(
            auth.statusMessage ?? 'Copilot is not signed in. Run the Copilot CLI login flow first.'
          )
        }
        const entry = {
          client: nextClient,
          models: (await nextClient.listModels()).map(mapModel)
        }
        clients.set(key, entry)
        return entry
      } catch (error) {
        await nextClient.forceStop().catch(() => undefined)
        throw error
      }
    })()
    clientPromises.set(key, clientPromise)

    try {
      return await clientPromise
    } finally {
      clientPromises.delete(key)
    }
  }

  const startInternal = async (
    threadId: string,
    operation: StartOperation
  ): Promise<CopilotStartResult> => {
    const existing = sessions.get(threadId)
    if (existing) return { ok: true, snapshot: existing.snapshot }

    const context = dependencies.resolveThread(threadId)
    if (!context) return { ok: false, error: 'Thread not found.' }
    if (context.thread.agentInterface !== 'custom') {
      return { ok: false, error: 'This thread uses the Copilot CLI interface.' }
    }

    const snapshot: CopilotSessionSnapshot = {
      threadId,
      sessionId: context.thread.resumeSessionId,
      title: context.thread.latestCopilotTitle,
      phase: 'connecting',
      model: null,
      reasoningEffort: null,
      agentMode: 'interactive',
      models: [],
      timeline: [],
      pendingInteraction: null,
      error: null
    }
    broadcastSession(snapshot)

    try {
      const entry = await ensureClient(dependencies.getGlobalFlags())
      const config: SessionConfig = {
        workingDirectory: context.cwd,
        streaming: true,
        enableFileChangeTracking: true,
        askUserVariant: 'elicitation'
      }
      const placeholder: ActiveSession = {
        session: null as unknown as CopilotSession,
        snapshot,
        pending: null,
        unsubscribe: () => undefined
      }
      config.onPermissionRequest = permissionHandler(placeholder)
      config.onUserInputRequest = userInputHandler(placeholder)
      config.onElicitationRequest = elicitationHandler(placeholder)
      config.onExitPlanModeRequest = exitPlanModeHandler(placeholder)
      config.onAutoModeSwitchRequest = autoModeSwitchHandler(placeholder)

      const session = context.thread.resumeSessionId
        ? await entry.client.resumeSession(context.thread.resumeSessionId, config)
        : await entry.client.createSession(config)
      if (operation.cancelled) {
        await session.disconnect()
        return { ok: false, error: 'Copilot session start was cancelled.' }
      }
      placeholder.session = session
      placeholder.snapshot = {
        ...placeholder.snapshot,
        sessionId: session.sessionId,
        models: entry.models,
        phase: 'idle'
      }
      placeholder.unsubscribe = session.on((event) => handleEvent(placeholder, event))
      sessions.set(threadId, placeholder)
      dependencies.onSessionStarted(threadId, session.sessionId)

      const [history, currentModel] = await Promise.all([
        session.getEvents(),
        session.rpc.model.getCurrent()
      ])
      const timeline: CopilotTimelineItem[] = []
      for (const event of history) {
        const item = timelineItemFromEvent(event)
        if (!item) continue
        const index = timeline.findIndex((existingItem) => existingItem.id === item.id)
        if (index >= 0) {
          timeline[index] = item
        } else {
          timeline.push(item)
        }
      }
      placeholder.snapshot = {
        ...placeholder.snapshot,
        model: currentModel.modelId ?? null,
        reasoningEffort:
          (currentModel.reasoningEffort as CopilotReasoningEffort | undefined) ?? null,
        timeline
      }
      broadcastSession(placeholder.snapshot)
      return { ok: true, snapshot: placeholder.snapshot }
    } catch (error) {
      const active = sessions.get(threadId)
      if (active) {
        active.unsubscribe()
        await active.session.disconnect().catch(() => undefined)
        sessions.delete(threadId)
      }
      const message = errorMessage(error)
      const failed = { ...snapshot, phase: 'error' as const, error: message }
      broadcastSession(failed)
      return { ok: false, error: message, snapshot: failed }
    }
  }

  const start = (threadId: string): Promise<CopilotStartResult> => {
    if (sdkUpdateInProgress) {
      return Promise.resolve({
        ok: false,
        error: 'The Copilot SDK is being updated. Try again when the update finishes.'
      })
    }
    const existing = sessions.get(threadId)
    if (existing) return Promise.resolve({ ok: true, snapshot: existing.snapshot })
    const starting = startingThreads.get(threadId)
    if (starting) return starting.promise

    const operation = {
      cancelled: false,
      promise: Promise.resolve({ ok: false } as CopilotStartResult)
    }
    operation.promise = startInternal(threadId, operation).finally(() => {
      if (startingThreads.get(threadId) === operation) {
        startingThreads.delete(threadId)
      }
    })
    startingThreads.set(threadId, operation)
    return operation.promise
  }

  return {
    getSdkStatus: () => sdkManager.getStatus(),
    checkForSdkUpdate: () => sdkManager.checkForUpdate(),
    updateSdk: async () => {
      if (sdkUpdateInProgress) return sdkManager.getStatus()

      const blockers = collectCopilotSdkUpdateBlockers(
        [...sessions.values()].map((active) => active.snapshot),
        startingThreads.keys(),
        (threadId) => {
          const thread = dependencies.resolveThread(threadId)?.thread
          return (
            thread?.customTitle ??
            thread?.latestCopilotTitle ??
            thread?.branchName ??
            `Thread ${threadId}`
          )
        }
      )
      if (blockers.length > 0) {
        return sdkManager.reportUpdateBlocked(blockers)
      }

      sdkUpdateInProgress = true
      try {
        for (const threadId of new Set([...sessions.keys(), ...startingThreads.keys()])) {
          await stopThread(threadId)
        }
        await Promise.all([...clients.values()].map(({ client }) => client.stop()))
        clients.clear()
        return await sdkManager.installLatest()
      } finally {
        sdkUpdateInProgress = false
      }
    },
    start,
    getSession: (threadId) => sessions.get(threadId)?.snapshot ?? null,
    send: async (input) => {
      const startResult = await start(input.threadId)
      if (!startResult.ok) return startResult
      const active = sessions.get(input.threadId)
      if (!active) return { ok: false, error: 'Copilot session did not start.' }

      updateSnapshot(active, {
        phase: 'running',
        agentMode: input.agentMode,
        error: null
      })
      try {
        await active.session.send({
          prompt: input.prompt,
          attachments: input.attachments.map((attachment) =>
            attachment.type === 'file'
              ? {
                  type: 'file' as const,
                  path: attachment.path!,
                  displayName: attachment.displayName
                }
              : {
                  type: 'blob' as const,
                  data: attachment.data!,
                  mimeType: attachment.mimeType!,
                  displayName: attachment.displayName
                }
          ),
          agentMode: input.agentMode
        })
        return { ok: true, snapshot: active.snapshot }
      } catch (error) {
        const message = errorMessage(error)
        updateSnapshot(active, { phase: 'error', error: message })
        return { ok: false, error: message, snapshot: active.snapshot }
      }
    },
    abort: async (threadId) => {
      const active = sessions.get(threadId)
      if (!active) return false
      await active.session.abort()
      return true
    },
    setModel: async (input: CopilotSetModelInput) => {
      const startResult = await start(input.threadId)
      if (!startResult.ok) return startResult
      const active = sessions.get(input.threadId)
      if (!active) return { ok: false, error: 'Copilot session did not start.' }
      try {
        await active.session.setModel(input.model, {
          reasoningEffort: input.reasoningEffort ?? undefined,
          reasoningSummary: input.reasoningEffort ? 'concise' : 'none'
        })
        updateSnapshot(active, {
          model: input.model,
          reasoningEffort: input.reasoningEffort
        })
        return { ok: true, snapshot: active.snapshot }
      } catch (error) {
        return { ok: false, error: errorMessage(error), snapshot: active.snapshot }
      }
    },
    respond: (input) => {
      const active = sessions.get(input.threadId)
      if (!active?.pending || active.pending.interaction.id !== input.interactionId) return false
      active.pending.resolve(input)
      return true
    },
    pickAttachments: async () => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Attach files to Copilot',
          properties: ['openFile', 'multiSelections']
        })
        if (result.canceled) return { ok: false, cancelled: true }
        return {
          ok: true,
          attachments: result.filePaths.map((path) => ({
            id: randomUUID(),
            type: 'file' as const,
            path,
            displayName: basename(path)
          }))
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
    stopThread,
    hasSession: (threadId) => sessions.has(threadId) || startingThreads.has(threadId),
    shutdown: async () => {
      for (const operation of startingThreads.values()) {
        operation.cancelled = true
      }
      await Promise.allSettled([...startingThreads.values()].map((operation) => operation.promise))
      for (const active of sessions.values()) {
        active.pending?.resolve({
          threadId: active.snapshot.threadId,
          interactionId: active.pending.interaction.id,
          action: 'cancel'
        })
        active.unsubscribe()
        await active.session.disconnect()
      }
      sessions.clear()
      await Promise.all([...clients.values()].map(({ client }) => client.stop()))
      clients.clear()
    }
  }

  async function stopThread(threadId: string): Promise<void> {
    const starting = startingThreads.get(threadId)
    if (starting) {
      starting.cancelled = true
      await starting.promise
    }
    const active = sessions.get(threadId)
    if (!active) return
    active.pending?.resolve({
      threadId,
      interactionId: active.pending.interaction.id,
      action: 'cancel'
    })
    active.unsubscribe()
    await active.session.disconnect()
    sessions.delete(threadId)
    broadcastSession({
      ...active.snapshot,
      phase: 'disconnected',
      pendingInteraction: null
    })
  }
}
