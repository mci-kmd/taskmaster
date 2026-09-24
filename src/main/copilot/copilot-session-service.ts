import { expandSkillPrompt, listSessionSkills } from './copilot-skills'
import { resumeOrCreateSession } from './session-resume'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import type {
  CopilotAttachment,
  CopilotInteraction,
  CopilotInteractionResponse,
  CopilotModelOption,
  CopilotModelSelection,
  ModelPerformanceSample,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSendInput,
  CopilotSkillsResult,
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
import { collectCopilotSdkUpdateBlockers } from './copilot-update-guard'

type ThreadContext = {
  thread: PersistedThread
  cwd: string
  yoloEnabled: boolean
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
  pending: PendingInteraction[]
  modelChangePending: boolean
  sendRevision: number
  unsubscribe: () => void
}

type StartOperation = {
  cancelled: boolean
  promise: Promise<CopilotStartResult>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildCopilotRuntimeEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...environment }
  if (env.COPILOT_CLI !== '1') return env

  for (const key of Object.keys(env)) {
    if (
      key === 'COPILOT_CLI' ||
      key === 'COPILOT_AGENT_SESSION_ID' ||
      key === 'COPILOT_CLI_BINARY_VERSION' ||
      key === 'COPILOT_CLI_RESOLVED_DIST_DIR' ||
      key === 'COPILOT_LOADER_PID' ||
      key === 'GCM_INTERACTIVE' ||
      key === 'GIT_TERMINAL_PROMPT' ||
      key === 'TASKMASTER_COPILOT_SESSION_START_FILE' ||
      key === 'TASKMASTER_COPILOT_USER_PROMPT_FILE' ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key) ||
      (key === 'GIT_ASKPASS' && !env[key])
    ) {
      delete env[key]
    }
  }

  return env
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

const previewableImage = /\.(png|jpe?g|gif|webp|bmp)$/i

async function imagePreview(path: string): Promise<string | undefined> {
  if (!previewableImage.test(path)) return undefined
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(path, { width: 160, height: 160 })
    if (!thumbnail.isEmpty()) return thumbnail.toDataURL()
  } catch {
    // Thumbnails are unavailable on some platforms; fall back to decoding the image.
  }
  try {
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return undefined
    return image.resize({ width: Math.min(160, image.getSize().width) }).toDataURL()
  } catch {
    return undefined
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
      if (event.data.isAutopilotContinuation || (event.data.source && event.data.source !== 'user'))
        return null
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

function mergeTimelineItem(
  previous: CopilotTimelineItem,
  next: CopilotTimelineItem
): CopilotTimelineItem {
  if (previous.type === 'tool' && next.type === 'tool') {
    return {
      ...next,
      title: next.title === 'Tool' ? previous.title : next.title,
      detail: next.detail || previous.detail
    }
  }
  return next
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
  getModelDefaults?: () => CopilotModelSelection | null
  onModelSelected?: (selection: CopilotModelSelection) => void
  resolveThread: (threadId: string) => ThreadContext | null
  onSessionStarted: (threadId: string, sessionId: string) => void
  onTitleChanged: (threadId: string, title: string) => void
  onUserMessage: (threadId: string, message: string) => void
  onActivity?: (threadId: string) => void
  recordPerformanceSample: (sample: ModelPerformanceSample) => void
  getPerformanceSamples: () => ModelPerformanceSample[]
}): {
  getSdkStatus: () => Promise<CopilotSdkStatus>
  checkForSdkUpdate: () => Promise<CopilotSdkStatus>
  updateSdk: () => Promise<CopilotSdkStatus>
  start: (threadId: string) => Promise<CopilotStartResult>
  getSession: (threadId: string) => CopilotSessionSnapshot | null
  getPerformanceSamples: () => ModelPerformanceSample[]
  listSkills: (threadId: string) => Promise<CopilotSkillsResult>
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
  runningThreadNames: () => string[]
  shutdown: () => Promise<void>
} {
  const sdkManager = new CopilotSdkManager()
  const sessions = new Map<string, ActiveSession>()
  const startingThreads = new Map<string, StartOperation>()
  let client: CopilotClient | null = null
  let clientVersion: string | null = null
  let clientPromise: Promise<CopilotClient> | null = null
  let models: CopilotModelOption[] = []
  let modelCatalogClient: CopilotClient | null = null
  let sdkUpdateInProgress = false
  let modelSelectionRevision = 0
  let rememberedModelSelectionRevision = 0

  const stopClient = async (): Promise<void> => {
    const stoppingClient = client
    client = null
    clientVersion = null
    models = []
    modelCatalogClient = null
    if (stoppingClient) await stoppingClient.stop()
  }

  const discardClient = async (): Promise<void> => {
    for (const active of sessions.values()) {
      cancelInteractions(active)
      active.unsubscribe()
      broadcastSession({ ...active.snapshot, phase: 'disconnected' })
    }
    sessions.clear()
    const staleClient = client
    client = null
    clientVersion = null
    models = []
    modelCatalogClient = null
    if (staleClient) await staleClient.forceStop().catch(() => undefined)
  }

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
      timeline[index] = mergeTimelineItem(timeline[index], item)
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
      active.pending.push({ interaction, resolve })
      if (active.pending.length === 1) updateSnapshot(active, { pendingInteraction: interaction })
    })

  const clearInteraction = (active: ActiveSession, interactionId: string): void => {
    if (!active.pending.some((pending) => pending.interaction.id === interactionId)) return
    active.pending = active.pending.filter((pending) => pending.interaction.id !== interactionId)
    updateSnapshot(active, { pendingInteraction: active.pending[0]?.interaction ?? null })
  }

  const cancelInteractions = (active: ActiveSession): void => {
    const pending = active.pending.splice(0)
    for (const item of pending)
      item.resolve({
        threadId: active.snapshot.threadId,
        interactionId: item.interaction.id,
        action: 'cancel'
      })
    updateSnapshot(active, { pendingInteraction: null })
  }

  const finishActivity = (active: ActiveSession): void => {
    updateSnapshot(active, {
      timeline: active.snapshot.timeline.map((item) => {
        if (item.type === 'tool' && item.status === 'running')
          return { ...item, status: 'cancelled' }
        if ('streaming' in item && item.streaming) return { ...item, streaming: false }
        return item
      })
    })
  }

  const permissionHandler = (active: ActiveSession, approveAll: boolean) => {
    return async (request: PermissionRequest): Promise<PermissionRequestResult> => {
      if (approveAll && request.managedApprovalRequired !== true) {
        return { kind: 'approve-once' }
      }

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
    if (event.type === 'assistant.usage') {
      const { model, outputTokens, duration, timeToFirstTokenMs } = event.data
      if (
        model &&
        outputTokens !== undefined &&
        Number.isFinite(outputTokens) &&
        outputTokens > 0 &&
        duration !== undefined &&
        Number.isFinite(duration) &&
        duration > 0
      ) {
        try {
          dependencies.recordPerformanceSample({
            id: event.id,
            model,
            timestamp: event.timestamp,
            outputTokens,
            durationMs: duration,
            timeToFirstTokenMs:
              timeToFirstTokenMs !== undefined &&
              Number.isFinite(timeToFirstTokenMs) &&
              timeToFirstTokenMs >= 0
                ? timeToFirstTokenMs
                : null
          })
        } catch (error) {
          console.error('Could not save model performance:', error)
        }
      }
      return
    }

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
        if (item) dependencies.onUserMessage(active.snapshot.threadId, event.data.content)
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
      case 'assistant.turn_start':
        updateSnapshot(active, { phase: 'running', error: null })
        break
      case 'session.mode_changed':
        if (['interactive', 'plan', 'autopilot'].includes(event.data.newMode)) {
          updateSnapshot(active, {
            agentMode: event.data.newMode as CopilotSessionSnapshot['agentMode']
          })
        }
        break
      case 'session.idle':
        if (active.snapshot.phase === 'running') dependencies.onActivity?.(active.snapshot.threadId)
        finishActivity(active)
        cancelInteractions(active)
        updateSnapshot(active, { phase: 'idle', error: null })
        break
      case 'session.error':
        finishActivity(active)
        cancelInteractions(active)
        updateSnapshot(active, { phase: 'error', error: event.data.message })
        break
    }
  }

  const discoverModels = (sdkClient: CopilotClient): void => {
    if (modelCatalogClient === sdkClient) return
    modelCatalogClient = sdkClient
    // The catalog can take seconds to arrive. Resume the conversation using its
    // current model while the optional picker metadata loads in the background.
    void sdkClient
      .listModels()
      .then((catalog) => {
        if (client !== sdkClient) return
        models = catalog.map(mapModel)
        for (const active of sessions.values()) updateSnapshot(active, { models })
      })
      .catch((error) => {
        if (client !== sdkClient) return
        modelCatalogClient = null
        console.warn('Could not load Copilot model options:', error)
      })
  }

  const ensureClient = async (): Promise<CopilotClient> => {
    if (clientPromise) return clientPromise

    clientPromise = (async () => {
      const loaded = await sdkManager.loadSdk()
      if (client && clientVersion === loaded.version) {
        try {
          await client.ping()
          discoverModels(client)
          return client
        } catch {
          await discardClient()
        }
      }
      await stopClient()
      const runtimeEnv = buildCopilotRuntimeEnv(process.env)
      if (loaded.runtimePath) runtimeEnv.COPILOT_CLI_PATH = loaded.runtimePath
      const nextClient = new loaded.module.CopilotClient({
        mode: 'copilot-cli',
        useLoggedInUser: true,
        logLevel: 'warning',
        env: runtimeEnv,
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
        client = nextClient
        clientVersion = loaded.version
        models = []
        discoverModels(nextClient)
        return nextClient
      } catch (error) {
        await nextClient.forceStop().catch(() => undefined)
        client = null
        clientVersion = null
        models = []
        throw error
      }
    })()

    try {
      return await clientPromise
    } finally {
      clientPromise = null
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

    const snapshot: CopilotSessionSnapshot = {
      threadId,
      sessionId: context.thread.resumeSessionId,
      title: context.thread.latestCopilotTitle,
      phase: 'connecting',
      model: null,
      reasoningEffort: null,
      nextModelSelection: null,
      agentMode: 'interactive',
      models,
      timeline: [],
      pendingInteraction: null,
      error: null
    }
    broadcastSession(snapshot)

    try {
      const sdkClient = await ensureClient()
      const config: SessionConfig = {
        workingDirectory: context.cwd,
        enableConfigDiscovery: true,
        enableSkills: true,
        streaming: true,
        enableFileChangeTracking: true,
        askUserVariant: 'elicitation'
      }
      const placeholder: ActiveSession = {
        session: null as unknown as CopilotSession,
        snapshot,
        pending: [],
        modelChangePending: false,
        sendRevision: 0,
        unsubscribe: () => undefined
      }
      config.onPermissionRequest = permissionHandler(placeholder, context.yoloEnabled)
      config.onUserInputRequest = userInputHandler(placeholder)
      config.onElicitationRequest = elicitationHandler(placeholder)
      config.onExitPlanModeRequest = exitPlanModeHandler(placeholder)
      config.onAutoModeSwitchRequest = autoModeSwitchHandler(placeholder)

      const session = await resumeOrCreateSession(
        sdkClient,
        context.thread,
        config,
        () => operation.cancelled,
        dependencies.getModelDefaults?.() ?? undefined
      )
      if (operation.cancelled) {
        await session.disconnect()
        return { ok: false, error: 'Copilot session start was cancelled.' }
      }
      placeholder.session = session
      placeholder.snapshot = {
        ...placeholder.snapshot,
        sessionId: session.sessionId,
        models,
        phase: 'connecting'
      }
      const bufferedEvents: SessionEvent[] = []
      let hydrated = false
      placeholder.unsubscribe = session.on((event) => {
        if (hydrated) handleEvent(placeholder, event)
        else bufferedEvents.push(event)
      })
      sessions.set(threadId, placeholder)
      dependencies.onSessionStarted(threadId, session.sessionId)

      const [history, currentModel, currentMode] = await Promise.all([
        session.getEvents(),
        session.rpc.model.getCurrent(),
        session.rpc.mode.get()
      ])
      const timeline: CopilotTimelineItem[] = []
      for (const event of history) {
        if (event.agentId) continue
        const item = timelineItemFromEvent(event)
        if (!item) continue
        const index = timeline.findIndex((existingItem) => existingItem.id === item.id)
        if (index >= 0) {
          timeline[index] = mergeTimelineItem(timeline[index], item)
        } else {
          timeline.push(item)
        }
      }
      placeholder.snapshot = {
        ...placeholder.snapshot,
        phase: 'idle',
        agentMode: ['interactive', 'plan', 'autopilot'].includes(currentMode)
          ? (currentMode as CopilotSessionSnapshot['agentMode'])
          : 'interactive',
        model: currentModel.modelId ?? null,
        reasoningEffort:
          (currentModel.reasoningEffort as CopilotReasoningEffort | undefined) ?? null,
        timeline
      }
      if (operation.cancelled) {
        cancelInteractions(placeholder)
        placeholder.unsubscribe()
        await session.disconnect()
        sessions.delete(threadId)
        broadcastSession({ ...placeholder.snapshot, phase: 'disconnected' })
        return { ok: false, error: 'Copilot session start was cancelled.' }
      }
      hydrated = true
      const historyIds = new Set(history.map((event) => event.id))
      const completedItems = new Set(
        timeline
          .filter(
            (item) =>
              item.type === 'assistant' ||
              item.type === 'reasoning' ||
              (item.type === 'tool' && item.status !== 'running')
          )
          .map((item) => item.id)
      )
      for (const event of bufferedEvents) {
        if (historyIds.has(event.id)) continue
        // A persisted final message already contains its transient streaming deltas.
        const streamedItemId =
          event.type === 'assistant.message_delta'
            ? `assistant:${event.data.messageId}`
            : event.type === 'assistant.reasoning_delta'
              ? `reasoning:${event.data.reasoningId}`
              : event.type === 'tool.execution_partial_result'
                ? `tool:${event.data.toolCallId}`
                : null
        if (streamedItemId && completedItems.has(streamedItemId)) continue
        handleEvent(placeholder, event)
      }
      broadcastSession(placeholder.snapshot)
      return { ok: true, snapshot: placeholder.snapshot }
    } catch (error) {
      const active = sessions.get(threadId)
      if (active) {
        cancelInteractions(active)
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
    const starting = startingThreads.get(threadId)
    if (starting) return starting.promise
    const existing = sessions.get(threadId)
    if (existing) {
      if (client) discoverModels(client)
      return Promise.resolve({ ok: true, snapshot: existing.snapshot })
    }

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

  const applyModelSelection = async (
    active: ActiveSession,
    selection: CopilotModelSelection
  ): Promise<CopilotStartResult> => {
    active.modelChangePending = true
    const selectionRevision = ++modelSelectionRevision
    try {
      const selected = active.snapshot.models.find((model) => model.id === selection.model)
      const effort = selection.reasoningEffort ?? selected?.defaultReasoningEffort ?? undefined
      await active.session.setModel(selection.model, {
        reasoningEffort: effort,
        reasoningSummary: effort ? 'concise' : 'none'
      })
      // The runtime may normalize the model/effort or defer a change. Display what
      // actually took effect, rather than presenting the requested settings as fact.
      const current = await active.session.rpc.model.getCurrent()
      if (sessions.get(active.snapshot.threadId) !== active)
        return { ok: false, error: 'Session closed before model settings were applied.' }
      updateSnapshot(active, {
        model: current.modelId ?? null,
        reasoningEffort: (current.reasoningEffort as CopilotReasoningEffort | undefined) ?? null,
        nextModelSelection: null
      })
      if (current.modelId !== selection.model || (effort && current.reasoningEffort !== effort)) {
        return {
          ok: false,
          error:
            'Copilot has not applied the requested model settings. The controls show the settings currently in use.',
          snapshot: active.snapshot
        }
      }
      if (selectionRevision > rememberedModelSelectionRevision) {
        dependencies.onModelSelected?.({
          model: current.modelId,
          reasoningEffort: active.snapshot.reasoningEffort
        })
        rememberedModelSelectionRevision = selectionRevision
      }
      return { ok: true, snapshot: active.snapshot }
    } catch (error) {
      return { ok: false, error: errorMessage(error), snapshot: active.snapshot }
    } finally {
      active.modelChangePending = false
    }
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
        await stopClient()
        return await sdkManager.installLatest()
      } finally {
        sdkUpdateInProgress = false
      }
    },
    start: async (threadId) => {
      if (sessions.get(threadId)?.snapshot.phase === 'error') await stopThread(threadId)
      return start(threadId)
    },
    getSession: (threadId) => sessions.get(threadId)?.snapshot ?? null,
    getPerformanceSamples: dependencies.getPerformanceSamples,
    listSkills: async (threadId) => {
      const active = sessions.get(threadId)
      if (!active) return { skills: [], error: 'Connect to Copilot to browse skills.' }
      try {
        return { skills: await listSessionSkills(active.session) }
      } catch (error) {
        return { skills: [], error: errorMessage(error) }
      }
    },
    send: async (input) => {
      const startResult = await start(input.threadId)
      if (!startResult.ok) return startResult
      const active = sessions.get(input.threadId)
      if (!active) return { ok: false, error: 'Copilot session did not start.' }

      if (active.modelChangePending)
        return {
          ok: false,
          error: 'Wait for the model settings to finish updating.',
          snapshot: active.snapshot
        }
      if (active.snapshot.phase !== 'idle' || active.pending.length) {
        return {
          ok: false,
          error: 'Wait for Copilot to finish or stop the current response.',
          snapshot: active.snapshot
        }
      }
      if (!input.prompt.trim() && !input.attachments.length)
        return { ok: false, error: 'Enter a message or attach a file.' }
      const sendRevision = ++active.sendRevision
      if (active.snapshot.nextModelSelection) {
        const applied = await applyModelSelection(active, active.snapshot.nextModelSelection)
        if (!applied.ok) return applied
        if (
          active.sendRevision !== sendRevision ||
          sessions.get(input.threadId) !== active ||
          active.snapshot.phase !== 'idle'
        )
          return { ok: false, error: 'Message cancelled.', snapshot: active.snapshot }
      }
      updateSnapshot(active, {
        phase: 'running',
        agentMode: input.agentMode,
        error: null
      })
      try {
        const expanded = await expandSkillPrompt(active.session, input.prompt)
        if (active.sendRevision !== sendRevision || sessions.get(input.threadId) !== active) {
          return { ok: false, error: 'Message cancelled.', snapshot: active.snapshot }
        }
        await active.session.send({
          ...expanded,
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
        if (active.sendRevision !== sendRevision || sessions.get(input.threadId) !== active) {
          return { ok: false, error: message, snapshot: active.snapshot }
        }
        finishActivity(active)
        cancelInteractions(active)
        updateSnapshot(active, { phase: 'error', error: message })
        return { ok: false, error: message, snapshot: active.snapshot }
      }
    },
    abort: async (threadId) => {
      const active = sessions.get(threadId)
      if (!active) return false
      active.sendRevision++
      cancelInteractions(active)
      await active.session.abort()
      finishActivity(active)
      updateSnapshot(active, { phase: 'idle', error: null })
      return true
    },
    setModel: async (input: CopilotSetModelInput) => {
      const startResult = await start(input.threadId)
      if (!startResult.ok) return startResult
      const active = sessions.get(input.threadId)
      if (!active) return { ok: false, error: 'Copilot session did not start.' }
      if (active.modelChangePending)
        return {
          ok: false,
          error: 'Wait for the model settings to finish updating.',
          snapshot: active.snapshot
        }
      if (active.snapshot.phase === 'running') {
        updateSnapshot(active, {
          nextModelSelection: { model: input.model, reasoningEffort: input.reasoningEffort }
        })
        return { ok: true, snapshot: active.snapshot }
      }
      if (active.snapshot.phase !== 'idle' || active.pending.length) {
        return {
          ok: false,
          error: 'Connect to Copilot before changing the model.',
          snapshot: active.snapshot
        }
      }
      return applyModelSelection(active, input)
    },
    respond: (input) => {
      const active = sessions.get(input.threadId)
      const pending = active?.pending[0]
      if (!active || !pending || pending.interaction.id !== input.interactionId) return false
      if (pending.interaction.kind === 'permission') {
        if (!['approve-once', 'approve-session', 'reject', 'cancel'].includes(input.action))
          return false
        if (input.action === 'approve-session' && !pending.interaction.allowSessionApproval)
          return false
      } else if (!['accept', 'decline', 'cancel'].includes(input.action)) return false
      clearInteraction(active, input.interactionId)
      pending.resolve(input)
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
          attachments: await Promise.all(
            result.filePaths.map(async (path) => ({
              id: randomUUID(),
              type: 'file' as const,
              path,
              displayName: basename(path),
              previewUrl: await imagePreview(path)
            }))
          )
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
    stopThread,
    hasSession: (threadId) => sessions.has(threadId) || startingThreads.has(threadId),
    runningThreadNames: () =>
      [...sessions.values()]
        .filter((active) => active.snapshot.phase === 'running')
        .map((active) => {
          const thread = dependencies.resolveThread(active.snapshot.threadId)?.thread
          return (
            thread?.customTitle ??
            active.snapshot.title ??
            thread?.latestCopilotTitle ??
            thread?.branchName ??
            'Untitled thread'
          )
        }),
    shutdown: async () => {
      for (const operation of startingThreads.values()) {
        operation.cancelled = true
      }
      await Promise.allSettled([...startingThreads.values()].map((operation) => operation.promise))
      for (const active of sessions.values()) {
        cancelInteractions(active)
        active.unsubscribe()
        await active.session.disconnect()
      }
      sessions.clear()
      await stopClient()
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
    cancelInteractions(active)
    finishActivity(active)
    active.unsubscribe()
    sessions.delete(threadId)
    broadcastSession({
      ...active.snapshot,
      phase: 'disconnected',
      pendingInteraction: null
    })
    try {
      await active.session.disconnect()
    } catch {
      await discardClient()
    }
  }
}
