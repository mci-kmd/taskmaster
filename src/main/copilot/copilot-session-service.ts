import { expandSkillPrompt, listSessionSkills } from './copilot-skills'
import { withPreviewElementContext } from './preview-element-context'
import { resumeOrCreateSession } from './session-resume'
import {
  describeHistory,
  eventsBefore,
  findTurnEndBoundary,
  latestTurnStart
} from './session-branching'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import type {
  CopilotAttachment,
  CopilotCancelQueuedInput,
  CopilotForkThreadInput,
  CopilotInteraction,
  CopilotInteractionResponse,
  CopilotListModelsResult,
  CopilotMcpAuthInput,
  CopilotMessageActionInput,
  CopilotModelOption,
  CopilotModelSelection,
  CopilotPastedText,
  ModelPerformanceSample,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSendDelivery,
  CopilotSendInput,
  CopilotSkillsResult,
  CopilotSessionSnapshot,
  CopilotSetModelFavoriteInput,
  CopilotSetModelInput,
  CopilotStartResult,
  CopilotRunningSubagent,
  CopilotSubagentUsage,
  CopilotTimelineItem,
  MutationResult,
  PersistedThread,
  PersistedThreadAside,
  ThreadModel
} from '../../shared/app-types'
import { asideParentThreadId, asideSessionKey, isAsideSessionKey } from '../../shared/aside'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { resolveThreadTitle, threadDisplayName } from '../../shared/thread-title'
import { sendIpc } from '../ipc/typed-ipc'
import type {
  CopilotClient,
  CopilotClientOptions,
  CopilotSession,
  AutoModeSwitchRequest,
  AutoModeSwitchResponse,
  ElicitationContext,
  ElicitationResult,
  ExitPlanModeRequest,
  ExitPlanModeResult,
  MessageOptions,
  ModelInfo,
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent,
  Tool
} from '@github/copilot-sdk'
import { CopilotSdkManager } from './copilot-sdk-manager'
import { collectCopilotSdkUpdateBlockers } from './copilot-update-guard'
import type { PromptSummaryRecord } from './prompt-summary-store'
import type { InteractionRecord } from './interaction-record-store'

type ThreadContext = {
  thread: PersistedThread
  cwd: string
  yoloEnabled: boolean
}

export type CopilotGenerateTextInput = {
  cwd: string
  model: string
  reasoningEffort: CopilotReasoningEffort | null
  systemMessage: string
  prompt: string
  timeoutMs?: number
}

const GENERATE_TEXT_TIMEOUT_MS = 120_000

// Newer runtimes no longer default an Entra app, so MCP servers behind Entra (e.g. Azure DevOps)
// can't sign in or renew tokens without one. This is the app the runtime used before, so
// existing sign-ins keep working.
const ENTRA_CLIENT_ID = 'aebc6443-996d-45c2-90f0-388ff96faa56'

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
  mcpAuthRequired: Set<string>
  mcpAuthAttempted: Set<string>
  mcpAuthInFlight: Map<string, Promise<CopilotStartResult>>
  modelChangePending: boolean
  /** The model a pending model change switches to. */
  selectingModel: string | null
  sendRevision: number
  queueRevision: number
  /** The prompt currently being worked on, from the user's message until the agent goes idle. */
  prompt: { startedAt: string; nanoAiu: number | null; subagents: CopilotSubagentUsage[] } | null
  /** Receives usage reported after its prompt finished, e.g. by background sub-agents. */
  lastSummary: PromptSummaryRecord | null
  /** The model allowlist last applied to the runtime, or null while unrestricted. */
  allowedModels: string[] | null
  /** Serializes allowlist updates so they reach the runtime in order. */
  allowedModelsSync: Promise<void>
  unsubscribe: () => void
}

type StartOperation = {
  cancelled: boolean
  promise: Promise<CopilotStartResult>
}

export type ForkedThreadInput = {
  sourceThreadId: string
  sessionId: string
  /** What the fork kept of the conversation; null when unknown, i.e. all of it. */
  history: { lastUserMessage: string | null; messageIds: string[] } | null
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

function toSdkAttachments(attachments: CopilotAttachment[]): MessageOptions['attachments'] {
  return attachments.map((attachment) =>
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
  )
}

/** The pasted texts found in `prompt` in order, trimmed where the prompt was trimmed. */
function pastedTextsIn(prompt: string, pastedTexts: CopilotPastedText[] = []): CopilotPastedText[] {
  const found: CopilotPastedText[] = []
  let index = 0
  for (const pasted of pastedTexts) {
    if (typeof pasted?.name !== 'string' || typeof pasted.text !== 'string') continue
    for (const text of [pasted.text, pasted.text.trim()]) {
      const start = text ? prompt.indexOf(text, index) : -1
      if (start < 0) continue
      found.push({ name: pasted.name, text })
      index = start + text.length
      break
    }
  }
  return found
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
        attachments: attachmentNames(event.data.attachments),
        ...(event.data.delivery === 'steering' ? { steered: true } : {})
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
    case 'skill.invoked':
      return {
        id: `skill:${event.id}`,
        type: 'skill',
        timestamp: event.timestamp,
        name: event.data.name,
        description: event.data.description?.trim() || null,
        invokedBy: event.data.trigger === 'user-invoked' ? 'user' : 'copilot'
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

function summaryItem(record: PromptSummaryRecord): CopilotTimelineItem {
  return {
    id: record.id,
    type: 'summary',
    timestamp: record.timestamp,
    durationMs: record.durationMs,
    nanoAiu: record.nanoAiu,
    subagents: record.subagents ?? []
  }
}

function interactionItem(record: InteractionRecord): CopilotTimelineItem {
  return {
    id: record.id,
    type: 'interaction',
    timestamp: record.timestamp,
    title: record.title,
    prompt: record.prompt,
    answer: record.answer,
    outcome: record.outcome
  }
}

function formatAnswerValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** How a request was answered, in words for the timeline. */
export function describeInteractionResponse(
  interaction: CopilotInteraction,
  response: CopilotInteractionResponse
): Pick<InteractionRecord, 'answer' | 'outcome'> {
  if (response.action === 'approve-session')
    return { answer: 'Allowed for this session', outcome: 'answered' }
  if (response.action === 'approve-once') return { answer: 'Allowed', outcome: 'answered' }
  if (response.action !== 'accept')
    return {
      answer: response.feedback ?? (interaction.kind === 'permission' ? 'Denied' : 'Skipped'),
      outcome: 'declined'
    }
  if (interaction.kind === 'elicitation' && response.values) {
    const entries = Object.entries(response.values)
    const fields = interaction.schema?.properties ?? {}
    const answer =
      entries.length === 1
        ? formatAnswerValue(entries[0][1])
        : entries
            .map(([name, value]) => `${fields[name]?.title ?? name}: ${formatAnswerValue(value)}`)
            .join('\n')
    return { answer: answer || 'Accepted', outcome: 'answered' }
  }
  return { answer: response.value?.trim() || 'Accepted', outcome: 'answered' }
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

function choiceOption(value: string, label?: string): { value: string; label?: string } {
  const trimmed = label?.trim()
  return trimmed && trimmed !== value ? { value, label: trimmed } : { value }
}

function normalizeElicitationSchema(
  context: ElicitationContext
): Extract<CopilotInteraction, { kind: 'elicitation' }>['schema'] {
  if (!context.requestedSchema) return undefined

  return {
    properties: Object.fromEntries(
      Object.entries(context.requestedSchema.properties).map(([name, field]) => {
        let options: { value: string; label?: string }[] | undefined
        if ('enum' in field && Array.isArray(field.enum)) {
          const labels = 'enumNames' in field ? field.enumNames : undefined
          options = field.enum.map((value, index) => choiceOption(value, labels?.[index]))
        } else if ('oneOf' in field && Array.isArray(field.oneOf)) {
          options = field.oneOf.map((option) => choiceOption(option.const, option.title))
        } else if (
          field.type === 'array' &&
          'items' in field &&
          field.items &&
          typeof field.items === 'object'
        ) {
          if ('enum' in field.items && Array.isArray(field.items.enum)) {
            options = field.items.enum.map((value) => choiceOption(value))
          } else if ('anyOf' in field.items && Array.isArray(field.items.anyOf)) {
            options = field.items.anyOf.map((option) => choiceOption(option.const, option.title))
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
    case 'custom-tool':
      return `${request.toolName}\n${formatJson(request.args ?? {})}`
    default:
      return formatJson(request)
  }
}

export function createCopilotSessionService(dependencies: {
  getModelDefaults?: () => CopilotModelSelection | null
  onModelSelected?: (selection: CopilotModelSelection) => void
  getFavoriteModels?: () => string[]
  setFavoriteModels?: (models: string[]) => void
  /** Models the user marked as legacy, which the agent should not pick on its own. */
  getLegacyModels?: () => string[]
  resolveThread: (threadId: string) => ThreadContext | null
  onSessionStarted: (threadId: string, sessionId: string) => void
  onTitleChanged: (threadId: string, title: string) => void
  /** `model` is the model the message was sent to, when known. */
  onUserMessage: (threadId: string, message: string, model: ThreadModel | null) => void
  onActivity?: (threadId: string) => void
  recordPerformanceSample: (sample: ModelPerformanceSample) => void
  getPerformanceSamples: () => ModelPerformanceSample[]
  getPromptSummaries?: (sessionId: string) => PromptSummaryRecord[]
  savePromptSummary?: (record: PromptSummaryRecord) => void
  getInteractions?: (sessionId: string) => InteractionRecord[]
  saveInteraction?: (record: InteractionRecord) => void
  /** Long text pasted into the user message with this content, or null. */
  getPastedTexts?: (content: string) => CopilotPastedText[] | null
  savePastedTexts?: (sessionId: string, content: string, pastedTexts: CopilotPastedText[]) => void
  /** Custom tools registered on every session started for the thread. */
  getSessionTools?: (threadId: string) => Tool[]
  /** The thread's aside, or null when it has none. */
  getAside?: (threadId: string) => PersistedThreadAside | null
  setAside?: (threadId: string, aside: PersistedThreadAside | null) => void
  /** Adds a thread that continues `sessionId`, a fork of the source thread's session, and selects it. */
  createForkedThread?: (input: ForkedThreadInput) => MutationResult
  /** The conversation was cut down to `history`. */
  onHistoryTruncated?: (threadId: string, history: ReturnType<typeof describeHistory>) => void
  /** Asks the user to confirm resetting a conversation. */
  confirmReset?: () => Promise<boolean>
  /**
   * Makes a new thread's checkout before its first prompt is sent. cwdChanged means the thread
   * moved to another directory, so its session restarts there.
   */
  prepareThread?: (
    threadId: string,
    prompt: string
  ) => Promise<{ ok: true; cwdChanged: boolean } | { ok: false; error: string }>
}): {
  getSdkStatus: () => Promise<CopilotSdkStatus>
  updateSdk: () => Promise<CopilotSdkStatus>
  start: (threadId: string) => Promise<CopilotStartResult>
  getSession: (threadId: string) => CopilotSessionSnapshot | null
  getPerformanceSamples: () => ModelPerformanceSample[]
  listSkills: (threadId: string) => Promise<CopilotSkillsResult>
  send: (input: CopilotSendInput) => Promise<CopilotStartResult>
  cancelQueued: (input: CopilotCancelQueuedInput) => Promise<CopilotStartResult>
  abort: (threadId: string) => Promise<boolean>
  setModel: (input: CopilotSetModelInput) => Promise<CopilotStartResult>
  getFavoriteModels: () => string[]
  setModelFavorite: (input: CopilotSetModelFavoriteInput) => string[]
  /** Reapplies the legacy model setting to every connected session. */
  refreshAllowedModels: () => void
  respond: (input: CopilotInteractionResponse) => boolean
  authenticateMcpServer: (input: CopilotMcpAuthInput) => Promise<CopilotStartResult>
  pickAttachments: () => Promise<{
    ok: boolean
    attachments?: CopilotAttachment[]
    cancelled?: boolean
    error?: string
  }>
  stopThread: (threadId: string) => Promise<void>
  /** Cuts the conversation back to the end of a message's turn, once the user confirms. */
  resetToMessage: (input: CopilotMessageActionInput) => Promise<CopilotStartResult>
  /** Opens a new thread continuing a copy of the conversation. */
  forkThread: (input: CopilotForkThreadInput) => Promise<MutationResult>
  /** Discards the thread's aside and starts a new one from the conversation as it is now. */
  resetAside: (threadId: string) => Promise<CopilotStartResult>
  hasSession: (threadId: string) => boolean
  isThreadWorking: (threadId: string) => boolean
  runningThreadNames: () => string[]
  /** User messages in the thread's connected session, oldest first. */
  getUserPrompts: (threadId: string) => string[]
  /** The text of a message in the thread's connected session, or null when it isn't there. */
  getMessageContent: (threadId: string, messageId: string) => string | null
  listModels: () => Promise<CopilotListModelsResult>
  generateText: (input: CopilotGenerateTextInput) => Promise<string>
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
  sdkManager.startUpdateChecks()

  const updateSnapshot = (active: ActiveSession, patch: Partial<CopilotSessionSnapshot>): void => {
    active.snapshot = { ...active.snapshot, ...patch }
    broadcastSession(active.snapshot)
  }

  // Keeps the agent off legacy models, e.g. when it picks a model for a sub-agent. A legacy
  // model the user chose for the session stays allowed.
  const syncAllowedModels = (active: ActiveSession): Promise<void> => {
    const apply = async (): Promise<void> => {
      // Until hydration reads the current model, it could be left out and switched away from.
      if (
        sessions.get(active.snapshot.threadId) !== active ||
        active.snapshot.phase === 'connecting'
      )
        return
      const legacy = new Set(dependencies.getLegacyModels?.() ?? [])
      // Without the catalog there is no list to allow; it syncs again once the catalog loads.
      if (legacy.size && !models.length) return
      const allowed = legacy.size
        ? [
            ...new Set([
              ...models.map((model) => model.id).filter((id) => !legacy.has(id)),
              ...[active.snapshot.model, active.selectingModel].filter((id): id is string =>
                Boolean(id)
              )
            ])
          ]
        : null
      if (
        allowed?.length === 0 ||
        allowed?.join('\n') === active.allowedModels?.join('\n') ||
        (!allowed && !active.allowedModels)
      )
        return
      // Experimental in the SDK; other installed SDK versions may not offer it.
      if (typeof active.session.rpc.model.setAllowedModels !== 'function') return
      await active.session.rpc.model.setAllowedModels({ allowedModels: allowed })
      active.allowedModels = allowed
    }
    active.allowedModelsSync = active.allowedModelsSync
      .then(apply)
      .catch((error) => console.warn('Could not keep Copilot off legacy models:', error))
    return active.allowedModelsSync
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

  // Keeps each answered request in the timeline, since the runtime does not persist them.
  const recordInteraction = (
    active: ActiveSession,
    interaction: CopilotInteraction,
    response: CopilotInteractionResponse
  ): void => {
    // Requests cancelled by stopping the turn were never answered.
    if (response.action === 'cancel' || sessions.get(active.snapshot.threadId) !== active) return
    const anchor = active.snapshot.timeline.findLast(
      (item) => item.type !== 'summary' && item.type !== 'interaction'
    )
    const record: InteractionRecord = {
      sessionId: active.snapshot.sessionId ?? '',
      id: `interaction:${interaction.id}`,
      anchorId: anchor?.id ?? '',
      timestamp: new Date().toISOString(),
      title: interaction.title,
      prompt: interaction.description,
      ...describeInteractionResponse(interaction, response)
    }
    upsertTimeline(active, interactionItem(record))
    if (!record.sessionId || !record.anchorId) return
    try {
      dependencies.saveInteraction?.(record)
    } catch (error) {
      console.error('Could not save interaction:', error)
    }
  }

  const createInteraction = (
    active: ActiveSession,
    interaction: CopilotInteraction
  ): Promise<CopilotInteractionResponse> =>
    new Promise<CopilotInteractionResponse>((resolve) => {
      active.pending.push({ interaction, resolve })
      if (active.pending.length === 1) updateSnapshot(active, { pendingInteraction: interaction })
    }).then((response) => {
      recordInteraction(active, interaction, response)
      return response
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

  const saveSummary = (record: PromptSummaryRecord): void => {
    if (!record.sessionId || !record.anchorId) return
    try {
      dependencies.savePromptSummary?.(record)
    } catch (error) {
      console.error('Could not save prompt summary:', error)
    }
  }

  const completePrompt = (active: ActiveSession, timestamp: string): void => {
    const prompt = active.prompt
    if (active.snapshot.workingSince) updateSnapshot(active, { workingSince: null })
    if (!prompt) return
    active.prompt = null
    const anchor = active.snapshot.timeline.findLast((item) => item.type !== 'summary')
    const durationMs = Date.parse(timestamp) - Date.parse(prompt.startedAt)
    const record: PromptSummaryRecord = {
      sessionId: active.snapshot.sessionId ?? '',
      id: `summary:${randomUUID()}`,
      anchorId: anchor?.id ?? '',
      timestamp,
      durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
      nanoAiu: prompt.nanoAiu,
      subagents: prompt.subagents
    }
    active.lastSummary = record
    upsertTimeline(active, summaryItem(record))
    saveSummary(record)
  }

  const updateLastSummary = (active: ActiveSession, record: PromptSummaryRecord): void => {
    active.lastSummary = record
    upsertTimeline(active, summaryItem(record))
    saveSummary(record)
  }

  const addNanoAiu = (total: number | null, nanoAiu: number | null): number | null =>
    nanoAiu === null ? total : (total ?? 0) + nanoAiu

  const addUsage = (active: ActiveSession, nanoAiu: number): void => {
    if (active.prompt) {
      active.prompt.nanoAiu = addNanoAiu(active.prompt.nanoAiu, nanoAiu)
      return
    }
    if (!active.lastSummary) return
    updateLastSummary(active, {
      ...active.lastSummary,
      nanoAiu: addNanoAiu(active.lastSummary.nanoAiu, nanoAiu)
    })
  }

  const addSubagent = (active: ActiveSession, agent: CopilotSubagentUsage): void => {
    const owner = active.prompt ?? active.lastSummary
    if (!owner || owner.subagents?.some((existing) => existing.id === agent.id)) return
    if (active.prompt) {
      active.prompt.subagents = [...active.prompt.subagents, agent]
      return
    }
    const last = active.lastSummary!
    updateLastSummary(active, { ...last, subagents: [...(last.subagents ?? []), agent] })
  }

  /**
   * Updates a sub-agent in the running prompt or, for background agents outliving it, the last
   * summary. Billed usage is added to the same prompt's total. Returns false for unknown agents.
   */
  const updateSubagent = (
    active: ActiveSession,
    id: string,
    update: (agent: CopilotSubagentUsage) => CopilotSubagentUsage,
    nanoAiu: number | null = null
  ): boolean => {
    const apply = (agents: CopilotSubagentUsage[]): CopilotSubagentUsage[] =>
      agents.map((agent) => (agent.id === id ? update(agent) : agent))
    const prompt = active.prompt
    if (prompt?.subagents.some((agent) => agent.id === id)) {
      prompt.subagents = apply(prompt.subagents)
      prompt.nanoAiu = addNanoAiu(prompt.nanoAiu, nanoAiu)
      return true
    }
    const last = active.lastSummary
    if (!last?.subagents?.some((agent) => agent.id === id)) return false
    updateLastSummary(active, {
      ...last,
      subagents: apply(last.subagents),
      nanoAiu: addNanoAiu(last.nanoAiu, nanoAiu)
    })
    return true
  }

  const setRunningSubagents = (
    active: ActiveSession,
    update: (agents: CopilotRunningSubagent[]) => CopilotRunningSubagent[]
  ): void => {
    const current = active.snapshot.runningSubagents ?? []
    const next = update(current)
    if (next !== current) updateSnapshot(active, { runningSubagents: next })
  }

  const handleSubagentEvent = (active: ActiveSession, event: SessionEvent): boolean => {
    switch (event.type) {
      case 'subagent.started': {
        const id = event.agentId ?? event.data.toolCallId
        addSubagent(active, {
          id,
          model: event.data.model ?? null,
          reasoningEffort: null,
          durationMs: null,
          nanoAiu: null
        })
        const { agentDisplayName, agentName, agentDescription, model } = event.data
        setRunningSubagents(active, (agents) =>
          agents.some((agent) => agent.id === id)
            ? agents
            : [
                ...agents,
                {
                  id,
                  name: agentDisplayName || agentName || 'Sub-agent',
                  description: agentDescription ?? '',
                  model: model ?? null,
                  startedAt: event.timestamp
                }
              ]
        )
        return true
      }
      case 'subagent.configured':
        if (event.agentId) {
          const id = event.agentId
          updateSubagent(active, id, (agent) => ({
            ...agent,
            model: event.data.model || agent.model,
            reasoningEffort: event.data.reasoningEffort ?? agent.reasoningEffort
          }))
          if (event.data.model)
            setRunningSubagents(active, (agents) =>
              agents.some((agent) => agent.id === id && agent.model !== event.data.model)
                ? agents.map((agent) =>
                    agent.id === id ? { ...agent, model: event.data.model } : agent
                  )
                : agents
            )
        }
        return true
      case 'subagent.completed':
      case 'subagent.failed': {
        const id = event.agentId ?? event.data.toolCallId
        const { durationMs, model } = event.data
        updateSubagent(active, id, (agent) => ({
          ...agent,
          model: model ?? agent.model,
          // Teardown repeats completion with the same duration, so it is set rather than added.
          durationMs:
            durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
              ? durationMs
              : agent.durationMs
        }))
        setRunningSubagents(active, (agents) =>
          agents.some((agent) => agent.id === id)
            ? agents.filter((agent) => agent.id !== id)
            : agents
        )
        return true
      }
      default:
        return false
    }
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

  // The runtime owns the queue; mirror it so queued messages can be shown and cancelled.
  const pastedTextsFor = (content: string): CopilotPastedText[] | null => {
    try {
      return dependencies.getPastedTexts?.(content) ?? null
    } catch (error) {
      console.error('Could not load pasted text:', error)
      return null
    }
  }

  const withPastedTexts = (item: CopilotTimelineItem): CopilotTimelineItem => {
    if (item.type !== 'user') return item
    const pastedTexts = pastedTextsFor(item.content)
    return pastedTexts?.length ? { ...item, pastedTexts } : item
  }

  /** Waiting messages show their pasted text as its name, like the sent message's pills. */
  const collapsePastedTexts = (content: string): string =>
    (pastedTextsFor(content) ?? []).reduce(
      (text, pasted) => text.replace(pasted.text, () => `[📎 ${pasted.name}]`),
      content
    )

  /** Saved before sending, so the message shows its pills as soon as it arrives. */
  const rememberPastedTexts = (active: ActiveSession, input: CopilotSendInput): void => {
    const pastedTexts = pastedTextsIn(input.prompt, input.pastedTexts)
    if (!pastedTexts.length) return
    try {
      dependencies.savePastedTexts?.(active.session.sessionId, input.prompt, pastedTexts)
    } catch (error) {
      console.error('Could not save pasted text:', error)
    }
  }

  const refreshQueue = (active: ActiveSession): void => {
    const revision = ++active.queueRevision
    void Promise.resolve()
      .then(() => active.session.rpc.queue.pendingItems())
      .then(
        (result) => {
          if (
            revision !== active.queueRevision ||
            sessions.get(active.snapshot.threadId) !== active
          )
            return
          const queuedMessages = result.items
            .filter((item) => item.kind === 'message')
            .map((item) => ({ id: item.id, text: collapsePastedTexts(item.displayText) }))
          const steeringMessages = result.steeringMessages
            .slice(result.inFlightSteeringCount ?? 0)
            .map(collapsePastedTexts)
          if (
            JSON.stringify([queuedMessages, steeringMessages]) ===
            JSON.stringify([active.snapshot.queuedMessages, active.snapshot.steeringMessages])
          )
            return
          updateSnapshot(active, { queuedMessages, steeringMessages })
        },
        (error) => console.warn('Could not load queued Copilot messages:', error)
      )
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
        allowSessionApproval: request.kind !== 'shell' || Boolean(request.canOfferSessionApproval),
        replyMode: 'feedback'
      }
      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      if (response.action === 'approve-session') return { kind: 'approve-for-session' }
      if (response.action === 'approve-once') {
        return { kind: 'approve-once', approvedInteractively: true }
      }
      return response.feedback
        ? { kind: 'reject', feedback: response.feedback }
        : { kind: 'reject' }
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
        allowFreeform: request.allowFreeform ?? true,
        // Freeform questions already have their own answer field.
        ...(request.allowFreeform === false ? { replyMode: 'steer' as const } : {})
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
        // Copilot's own questions (ask_user) treat choices as suggestions; MCP servers may not.
        allowFreeform: !context.elicitationSource,
        schema: normalizeElicitationSchema(context),
        replyMode: 'steer'
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
        allowFreeform: false,
        replyMode: 'feedback'
      }
      const response = await createInteraction(active, interaction)
      clearInteraction(active, interaction.id)
      return response.action === 'accept'
        ? { approved: true, selectedAction: response.value }
        : { approved: false, ...(response.feedback ? { feedback: response.feedback } : {}) }
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

  const signInToMcpServer = (
    active: ActiveSession,
    serverName: string
  ): Promise<CopilotStartResult> => {
    if (sessions.get(active.snapshot.threadId) !== active)
      return Promise.resolve({ ok: false, error: 'Connect to Copilot before signing in.' })
    if (!active.mcpAuthRequired.has(serverName))
      return Promise.resolve({ ok: true, snapshot: active.snapshot })
    const pending = active.mcpAuthInFlight.get(serverName)
    if (pending) return pending

    const request = (async (): Promise<CopilotStartResult> => {
      try {
        const { authorizationUrl } = await active.session.rpc.mcp.oauth.login({
          serverName,
          clientName: 'Taskmaster',
          callbackSuccessMessage: 'Sign-in complete. You can return to Taskmaster.'
        })
        if (sessions.get(active.snapshot.threadId) !== active)
          return { ok: false, error: 'Session closed before sign-in completed.' }
        if (!active.mcpAuthRequired.has(serverName)) return { ok: true, snapshot: active.snapshot }
        if (!authorizationUrl) {
          setMcpServerNeedsAuth(active, serverName, false)
          return { ok: true, snapshot: active.snapshot }
        }
        const { protocol } = new URL(authorizationUrl)
        if (protocol !== 'https:' && protocol !== 'http:')
          throw new Error(`Unsupported sign-in address for ${serverName}.`)
        await shell.openExternal(authorizationUrl)
        if (sessions.get(active.snapshot.threadId) !== active)
          return { ok: false, error: 'Session closed before sign-in completed.' }
        if (active.mcpAuthRequired.has(serverName)) {
          updateSnapshot(active, {
            mcpServersNeedingAuth: active.snapshot.mcpServersNeedingAuth.includes(serverName)
              ? active.snapshot.mcpServersNeedingAuth
              : [...active.snapshot.mcpServersNeedingAuth, serverName],
            mcpServersSigningIn: active.snapshot.mcpServersSigningIn.includes(serverName)
              ? active.snapshot.mcpServersSigningIn
              : [...active.snapshot.mcpServersSigningIn, serverName]
          })
        }
        return { ok: true, snapshot: active.snapshot }
      } catch (error) {
        if (
          sessions.get(active.snapshot.threadId) === active &&
          active.mcpAuthRequired.has(serverName)
        ) {
          updateSnapshot(active, {
            mcpServersNeedingAuth: active.snapshot.mcpServersNeedingAuth.includes(serverName)
              ? active.snapshot.mcpServersNeedingAuth
              : [...active.snapshot.mcpServersNeedingAuth, serverName],
            mcpServersSigningIn: active.snapshot.mcpServersSigningIn.filter(
              (name) => name !== serverName
            )
          })
        }
        return { ok: false, error: errorMessage(error), snapshot: active.snapshot }
      }
    })()
    active.mcpAuthInFlight.set(serverName, request)
    void request.then(() => {
      if (active.mcpAuthInFlight.get(serverName) === request)
        active.mcpAuthInFlight.delete(serverName)
    })
    return request
  }

  const autoSignInToMcpServer = (active: ActiveSession, serverName: string): void => {
    if (active.mcpAuthAttempted.has(serverName)) return
    active.mcpAuthAttempted.add(serverName)
    void signInToMcpServer(active, serverName).then((result) => {
      if (!result.ok) console.warn(`Could not sign in to MCP server ${serverName}:`, result.error)
    })
  }

  const setMcpServerNeedsAuth = (
    active: ActiveSession,
    serverName: string,
    needsAuth: boolean
  ): void => {
    if (needsAuth) {
      active.mcpAuthRequired.add(serverName)
      autoSignInToMcpServer(active, serverName)
      return
    }
    active.mcpAuthRequired.delete(serverName)
    active.mcpAuthAttempted.delete(serverName)
    if (
      active.snapshot.mcpServersNeedingAuth.includes(serverName) ||
      active.snapshot.mcpServersSigningIn.includes(serverName)
    ) {
      updateSnapshot(active, {
        mcpServersNeedingAuth: active.snapshot.mcpServersNeedingAuth.filter(
          (name) => name !== serverName
        ),
        mcpServersSigningIn: active.snapshot.mcpServersSigningIn.filter(
          (name) => name !== serverName
        )
      })
    }
  }

  const handleEvent = (active: ActiveSession, event: SessionEvent): void => {
    if (event.type === 'assistant.usage') {
      const reportedNanoAiu = event.data.copilotUsage?.totalNanoAiu
      const nanoAiu =
        reportedNanoAiu !== undefined && Number.isFinite(reportedNanoAiu) && reportedNanoAiu >= 0
          ? reportedNanoAiu
          : null
      if (nanoAiu !== null) {
        const { model, reasoningEffort } = event.data
        const counted =
          event.agentId !== undefined &&
          updateSubagent(
            active,
            event.agentId,
            (agent) => ({
              ...agent,
              model: agent.model ?? (model || null),
              reasoningEffort: agent.reasoningEffort ?? reasoningEffort ?? null,
              nanoAiu: (agent.nanoAiu ?? 0) + nanoAiu
            }),
            nanoAiu
          )
        if (!counted) addUsage(active, nanoAiu)
      }
      const { model, outputTokens, duration, timeToFirstTokenMs } = event.data
      const measured =
        outputTokens !== undefined &&
        Number.isFinite(outputTokens) &&
        outputTokens > 0 &&
        duration !== undefined &&
        Number.isFinite(duration) &&
        duration > 0
      // Billed calls are kept even without timing so credit usage stays complete.
      if (model && (measured || nanoAiu !== null)) {
        try {
          dependencies.recordPerformanceSample({
            id: event.id,
            model,
            timestamp: event.timestamp,
            outputTokens: measured ? outputTokens : 0,
            durationMs: measured ? duration : 0,
            timeToFirstTokenMs:
              timeToFirstTokenMs !== undefined &&
              Number.isFinite(timeToFirstTokenMs) &&
              timeToFirstTokenMs >= 0
                ? timeToFirstTokenMs
                : null,
            nanoAiu
          })
        } catch (error) {
          console.error('Could not save model performance:', error)
        }
      }
      return
    }

    if (handleSubagentEvent(active, event)) return
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

    const eventItem = timelineItemFromEvent(event)
    const item = eventItem && withPastedTexts(eventItem)
    // A new (non-steering) prompt ends the previous one, e.g. when a queued message starts.
    if (item?.type === 'user' && !item.steered) {
      completePrompt(active, event.timestamp)
      active.prompt = { startedAt: event.timestamp, nanoAiu: null, subagents: [] }
      updateSnapshot(active, { workingSince: event.timestamp })
    }
    if (item) upsertTimeline(active, item)

    switch (event.type) {
      case 'user.message':
        if (item && !isAsideSessionKey(active.snapshot.threadId)) {
          const model = active.snapshot.model
          const name = active.snapshot.models.find((option) => option.id === model)?.name
          dependencies.onUserMessage(
            active.snapshot.threadId,
            event.data.content,
            model ? { id: model, name: name ?? model } : null
          )
        }
        break
      case 'session.title_changed':
        if (!isAsideSessionKey(active.snapshot.threadId))
          dependencies.onTitleChanged(active.snapshot.threadId, event.data.title)
        updateSnapshot(active, { title: event.data.title })
        break
      case 'session.model_change':
        updateSnapshot(active, {
          model: event.data.newModel,
          reasoningEffort: (event.data.reasoningEffort as CopilotReasoningEffort | null) ?? null
        })
        void syncAllowedModels(active)
        break
      case 'assistant.turn_start':
        active.prompt ??= { startedAt: event.timestamp, nanoAiu: null, subagents: [] }
        updateSnapshot(active, {
          phase: 'running',
          error: null,
          workingSince: active.snapshot.workingSince ?? active.prompt.startedAt
        })
        break
      case 'session.mode_changed':
        if (['interactive', 'plan', 'autopilot'].includes(event.data.newMode)) {
          updateSnapshot(active, {
            agentMode: event.data.newMode as CopilotSessionSnapshot['agentMode']
          })
        }
        break
      // session.idle is deferred while background work (e.g. an async dev server shell)
      // is in flight; assistant.idle marks the end of the agent's turn regardless.
      case 'assistant.idle':
        if (active.snapshot.phase === 'running' && !isAsideSessionKey(active.snapshot.threadId))
          dependencies.onActivity?.(active.snapshot.threadId)
        completePrompt(active, event.timestamp)
        updateSnapshot(active, { phase: 'idle', error: null })
        refreshQueue(active)
        break
      case 'session.idle':
        if (active.snapshot.phase === 'running' && !isAsideSessionKey(active.snapshot.threadId))
          dependencies.onActivity?.(active.snapshot.threadId)
        finishActivity(active)
        cancelInteractions(active)
        completePrompt(active, event.timestamp)
        updateSnapshot(active, { phase: 'idle', error: null, runningSubagents: [] })
        refreshQueue(active)
        break
      case 'pending_messages.modified':
        refreshQueue(active)
        break
      case 'session.error':
        finishActivity(active)
        cancelInteractions(active)
        completePrompt(active, event.timestamp)
        updateSnapshot(active, {
          phase: 'error',
          error: event.data.message,
          runningSubagents: []
        })
        break
      case 'session.mcp_servers_loaded':
        for (const name of active.mcpAuthRequired) {
          if (!event.data.servers.some((server) => server.name === name))
            setMcpServerNeedsAuth(active, name, false)
        }
        for (const server of event.data.servers)
          setMcpServerNeedsAuth(active, server.name, server.status === 'needs-auth')
        break
      case 'session.mcp_server_status_changed':
        setMcpServerNeedsAuth(active, event.data.serverName, event.data.status === 'needs-auth')
        break
      case 'session.mcp_server_removed':
        setMcpServerNeedsAuth(active, event.data.serverName, false)
        break
      case 'mcp.oauth_required':
        setMcpServerNeedsAuth(active, event.data.serverName, true)
        break
    }
  }

  const mapCatalog = (catalog: ModelInfo[]): CopilotModelOption[] => {
    const seen = new Set<string>()
    return catalog.flatMap((model) => {
      if (seen.has(model.id)) return []
      seen.add(model.id)
      return [mapModel(model)]
    })
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
        models = mapCatalog(catalog)
        for (const active of sessions.values()) {
          updateSnapshot(active, { models })
          void syncAllowedModels(active)
        }
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
      // `entra` is missing from the bundled SDK's types but honored by newer runtimes.
      const clientOptions: CopilotClientOptions & { entra: { clientId: string } } = {
        mode: 'copilot-cli',
        useLoggedInUser: true,
        logLevel: 'warning',
        env: runtimeEnv,
        entra: { clientId: ENTRA_CLIENT_ID },
        clientInfo: {
          applicationName: 'Taskmaster',
          applicationVersion: app.getVersion(),
          integrationName: 'copilot-sdk',
          integrationVersion: loaded.version
        }
      }
      const nextClient = new loaded.module.CopilotClient(clientOptions)

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

  /** Copies a session, up to but excluding `toEventId`, into a new one and returns its id. */
  const forkSession = async (
    sdkClient: CopilotClient,
    sessionId: string,
    toEventId: string | null
  ): Promise<string> => {
    const result = await sdkClient.rpc.sessions.fork(
      toEventId ? { sessionId, toEventId } : { sessionId }
    )
    return result.sessionId
  }

  /** The timeline of a session's history, leaving out events up to and including `baseEventId`. */
  const buildTimeline = (
    history: SessionEvent[],
    sessionId: string,
    baseEventId: string | null
  ): CopilotTimelineItem[] => {
    const baseIndex = baseEventId ? history.findIndex((event) => event.id === baseEventId) : -1
    const timeline: CopilotTimelineItem[] = []
    // Long sessions have thousands of events; index items by id instead of scanning.
    const timelineIndex = new Map<string, number>()
    for (const event of history.slice(baseIndex + 1)) {
      if (event.agentId) continue
      const eventItem = timelineItemFromEvent(event)
      if (!eventItem) continue
      const item = withPastedTexts(eventItem)
      const index = timelineIndex.get(item.id)
      if (index !== undefined) {
        timeline[index] = mergeTimelineItem(timeline[index], item)
      } else {
        timelineIndex.set(item.id, timeline.length)
        timeline.push(item)
      }
    }
    let interactions: InteractionRecord[] = []
    try {
      interactions = dependencies.getInteractions?.(sessionId) ?? []
    } catch (error) {
      console.error('Could not load interactions:', error)
    }
    // Before summaries, which may be anchored to an interaction.
    for (const record of interactions) {
      let index = timeline.findIndex((existingItem) => existingItem.id === record.anchorId)
      if (index < 0 || timeline.some((existingItem) => existingItem.id === record.id)) continue
      while (timeline[index + 1]?.type === 'interaction') index++
      timeline.splice(index + 1, 0, interactionItem(record))
    }
    let summaries: PromptSummaryRecord[] = []
    try {
      summaries = dependencies.getPromptSummaries?.(sessionId) ?? []
    } catch (error) {
      console.error('Could not load prompt summaries:', error)
    }
    for (const record of summaries) {
      let index = timeline.findIndex((existingItem) => existingItem.id === record.anchorId)
      if (index < 0 || timeline.some((existingItem) => existingItem.id === record.id)) continue
      while (timeline[index + 1]?.type === 'summary') index++
      timeline.splice(index + 1, 0, summaryItem(record))
    }
    return timeline
  }

  const startInternal = async (
    threadId: string,
    operation: StartOperation
  ): Promise<CopilotStartResult> => {
    const existing = sessions.get(threadId)
    if (existing) return { ok: true, snapshot: existing.snapshot }

    // An aside runs in its thread's context, on a fork of its thread's session.
    const parentThreadId = asideParentThreadId(threadId)
    const context = dependencies.resolveThread(parentThreadId ?? threadId)
    if (!context) return { ok: false, error: 'Thread not found.' }
    let aside = parentThreadId ? (dependencies.getAside?.(parentThreadId) ?? null) : null
    let resumedAside = false

    const snapshot: CopilotSessionSnapshot = {
      threadId,
      sessionId: parentThreadId ? (aside?.sessionId ?? null) : context.thread.resumeSessionId,
      title: parentThreadId ? null : context.thread.latestCopilotTitle,
      phase: 'connecting',
      model: null,
      reasoningEffort: null,
      nextModelSelection: null,
      agentMode: 'interactive',
      models,
      timeline: [],
      pendingInteraction: null,
      mcpServersNeedingAuth: [],
      mcpServersSigningIn: [],
      queuedMessages: [],
      steeringMessages: [],
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
        askUserVariant: 'elicitation',
        // Keep MCP sign-ins in the OS keychain so they survive session restarts.
        mcpOAuthTokenStorage: 'persistent'
      }
      const tools = parentThreadId ? undefined : dependencies.getSessionTools?.(threadId)
      if (tools?.length) config.tools = tools
      const placeholder: ActiveSession = {
        session: null as unknown as CopilotSession,
        snapshot,
        pending: [],
        mcpAuthRequired: new Set(),
        mcpAuthAttempted: new Set(),
        mcpAuthInFlight: new Map(),
        modelChangePending: false,
        selectingModel: null,
        sendRevision: 0,
        queueRevision: 0,
        prompt: null,
        lastSummary: null,
        allowedModels: null,
        allowedModelsSync: Promise.resolve(),
        unsubscribe: () => undefined
      }
      config.onPermissionRequest = permissionHandler(placeholder, context.yoloEnabled)
      config.onUserInputRequest = userInputHandler(placeholder)
      config.onElicitationRequest = elicitationHandler(placeholder)
      config.onExitPlanModeRequest = exitPlanModeHandler(placeholder)
      config.onAutoModeSwitchRequest = autoModeSwitchHandler(placeholder)

      if (parentThreadId && !aside) {
        const parentSessionId =
          sessions.get(parentThreadId)?.session.sessionId ?? context.thread.resumeSessionId
        if (parentSessionId) {
          const parent = sessions.get(parentThreadId)
          // Leave out a turn still in progress.
          const toEventId =
            parent?.snapshot.phase === 'running'
              ? latestTurnStart(await parent.session.getEvents())
              : null
          aside = {
            sessionId: await forkSession(sdkClient, parentSessionId, toEventId),
            createdAt: new Date().toISOString()
          }
          dependencies.setAside?.(parentThreadId, aside)
        }
      }
      if (operation.cancelled) return { ok: false, error: 'Copilot session start was cancelled.' }
      resumedAside = Boolean(aside)
      const session = await resumeOrCreateSession(
        sdkClient,
        parentThreadId
          ? { ...context.thread, id: threadId, resumeSessionId: aside?.sessionId ?? null }
          : context.thread,
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
      if (!parentThreadId) dependencies.onSessionStarted(threadId, session.sessionId)
      else if (aside?.sessionId !== session.sessionId) {
        aside = { sessionId: session.sessionId, createdAt: new Date().toISOString() }
        dependencies.setAside?.(parentThreadId, aside)
      }

      const [history, currentModel, currentMode] = await Promise.all([
        session.getEvents(),
        session.rpc.model.getCurrent(),
        session.rpc.mode.get()
      ])
      if (parentThreadId && aside && aside.baseEventId === undefined) {
        // A new aside: what it inherited from the thread stays out of its timeline.
        aside = { ...aside, baseEventId: history.at(-1)?.id ?? null }
        dependencies.setAside?.(parentThreadId, aside)
      }
      const timeline = buildTimeline(history, session.sessionId, aside?.baseEventId ?? null)
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
      void syncAllowedModels(placeholder)
      // Status events may have fired before this listener was attached.
      void session.rpc.mcp
        .list()
        .then(({ servers }) => {
          if (sessions.get(threadId) !== placeholder) return
          for (const server of servers)
            setMcpServerNeedsAuth(placeholder, server.name, server.status === 'needs-auth')
        })
        .catch((error) => console.warn('Could not load MCP server status:', error))
      return { ok: true, snapshot: placeholder.snapshot }
    } catch (error) {
      const active = sessions.get(threadId)
      if (active) {
        cancelInteractions(active)
        active.unsubscribe()
        await active.session.disconnect().catch(() => undefined)
        sessions.delete(threadId)
      }
      // Its session is gone; the next start forks a new one.
      if (parentThreadId && resumedAside && !active && /not found/i.test(errorMessage(error)))
        dependencies.setAside?.(parentThreadId, null)
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
    active.selectingModel = selection.model
    const selectionRevision = ++modelSelectionRevision
    try {
      const selected = active.snapshot.models.find((model) => model.id === selection.model)
      const effort = selection.reasoningEffort ?? selected?.defaultReasoningEffort ?? undefined
      await syncAllowedModels(active)
      if (sessions.get(active.snapshot.threadId) !== active)
        return { ok: false, error: 'Session closed before model settings were applied.' }
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
      active.selectingModel = null
      void syncAllowedModels(active)
    }
  }

  /** Sets up a new thread's checkout, restarting its session when it moved elsewhere. */
  const prepareThread = async (threadId: string, prompt: string): Promise<CopilotStartResult> => {
    if (!dependencies.prepareThread) return { ok: true }
    const result = await dependencies.prepareThread(threadId, prompt)
    const previous = sessions.get(threadId)
    if (!result.ok) return { ok: false, error: result.error, snapshot: previous?.snapshot }
    if (!result.cwdChanged) return { ok: true }
    // Keep the model picked before the first prompt.
    const selection: CopilotModelSelection | null = previous?.snapshot.model
      ? { model: previous.snapshot.model, reasoningEffort: previous.snapshot.reasoningEffort }
      : null
    const previousSessionId = previous?.session.sessionId ?? null
    await stopThread(threadId)
    if (previousSessionId)
      void ensureClient()
        .then((sdkClient) => sdkClient.deleteSession(previousSessionId))
        .catch(() => undefined)
    const started = await start(threadId)
    if (!started.ok || !selection) return started
    const active = sessions.get(threadId)
    if (
      !active ||
      (active.snapshot.model === selection.model &&
        (!selection.reasoningEffort ||
          active.snapshot.reasoningEffort === selection.reasoningEffort))
    )
      return started
    // A model that didn't carry over shows in the picker; it doesn't hold up the prompt.
    await applyModelSelection(active, selection)
    return started
  }

  const sendWhileRunning = async (
    active: ActiveSession,
    input: CopilotSendInput & { delivery: CopilotSendDelivery }
  ): Promise<CopilotStartResult> => {
    if (!input.prompt.trim() && !input.attachments.length)
      return { ok: false, error: 'Enter a message or attach a file.' }
    // Stopping the turn clears the runtime queue, so it also cancels this message.
    const sendRevision = active.sendRevision
    try {
      const expanded = withPreviewElementContext(
        await expandSkillPrompt(active.session, input.prompt),
        input.prompt,
        input.attachments
      )
      if (active.sendRevision !== sendRevision || sessions.get(input.threadId) !== active)
        return { ok: false, error: 'Message cancelled.', snapshot: active.snapshot }
      rememberPastedTexts(active, input)
      await active.session.send({
        ...expanded,
        attachments: toSdkAttachments(input.attachments),
        // Steering joins the current turn, so it keeps that turn's mode.
        ...(input.delivery === 'queue'
          ? { mode: 'enqueue' as const, agentMode: input.agentMode }
          : { mode: 'immediate' as const })
      })
      refreshQueue(active)
      return { ok: true, snapshot: active.snapshot }
    } catch (error) {
      return { ok: false, error: errorMessage(error), snapshot: active.snapshot }
    }
  }

  const replyToInteraction = async (
    active: ActiveSession,
    input: CopilotSendInput & { replyToInteractionId: string }
  ): Promise<CopilotStartResult> => {
    const pending = active.pending[0]
    const replyMode = pending?.interaction.replyMode
    if (!pending || pending.interaction.id !== input.replyToInteractionId || !replyMode)
      return {
        ok: false,
        error: 'Copilot is no longer waiting for that request.',
        snapshot: active.snapshot
      }
    const reply = input.prompt.trim()
    const decline = (feedback?: string): void => {
      if (active.pending[0] !== pending) return
      clearInteraction(active, pending.interaction.id)
      pending.resolve({
        threadId: active.snapshot.threadId,
        interactionId: pending.interaction.id,
        action: pending.interaction.kind === 'permission' ? 'reject' : 'decline',
        ...(feedback ? { feedback } : {})
      })
    }
    if (replyMode === 'feedback') {
      if (!reply) return { ok: false, error: 'Enter a reply.', snapshot: active.snapshot }
      if (input.attachments.length)
        return {
          ok: false,
          error: 'Attachments can’t be sent with this reply. Remove them and try again.',
          snapshot: active.snapshot
        }
      // The runtime has no user message for feedback; the timeline shows it as the answer.
      decline(reply)
      return { ok: true, snapshot: active.snapshot }
    }
    if (active.snapshot.phase !== 'running')
      return {
        ok: false,
        error: 'Copilot is not running, so this reply cannot be sent.',
        snapshot: active.snapshot
      }
    // Steer first so the reply is waiting when Copilot learns the request was declined.
    const result = await sendWhileRunning(active, { ...input, delivery: 'steer' })
    if (result.ok) decline()
    return { ...result, snapshot: active.snapshot }
  }

  return {
    getSdkStatus: () => sdkManager.getStatus(),
    updateSdk: async () => {
      if (sdkUpdateInProgress) return sdkManager.getStatus()

      const blockers = collectCopilotSdkUpdateBlockers(
        [...sessions.values()].map((active) => active.snapshot),
        startingThreads.keys(),
        (threadId) => sessionDisplayName(threadId, null) ?? `Thread ${threadId}`
      )
      if (blockers.length > 0) {
        return sdkManager.reportUpdateBlocked(blockers)
      }

      sdkUpdateInProgress = true
      try {
        for (const threadId of new Set([...sessions.keys(), ...startingThreads.keys()])) {
          await stopSession(threadId)
        }
        await stopClient()
        return await sdkManager.installLatest()
      } finally {
        sdkUpdateInProgress = false
      }
    },
    start: async (threadId) => {
      if (sessions.get(threadId)?.snapshot.phase === 'error') await stopSession(threadId)
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
      if (!isAsideSessionKey(input.threadId)) {
        const prepared = await prepareThread(input.threadId, input.prompt)
        if (!prepared.ok) return prepared
      }
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
      if (input.replyToInteractionId)
        return replyToInteraction(active, {
          ...input,
          replyToInteractionId: input.replyToInteractionId
        })
      if (input.delivery && active.snapshot.phase === 'running' && !active.pending.length)
        return sendWhileRunning(active, { ...input, delivery: input.delivery })
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
        error: null,
        workingSince: new Date().toISOString()
      })
      try {
        const expanded = withPreviewElementContext(
          await expandSkillPrompt(active.session, input.prompt),
          input.prompt,
          input.attachments
        )
        if (active.sendRevision !== sendRevision || sessions.get(input.threadId) !== active) {
          return { ok: false, error: 'Message cancelled.', snapshot: active.snapshot }
        }
        rememberPastedTexts(active, input)
        await active.session.send({
          ...expanded,
          attachments: toSdkAttachments(input.attachments),
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
        updateSnapshot(active, { phase: 'error', error: message, workingSince: null })
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
      completePrompt(active, new Date().toISOString())
      updateSnapshot(active, { phase: 'idle', error: null })
      refreshQueue(active)
      return true
    },
    cancelQueued: async ({ threadId, queuedId }: CopilotCancelQueuedInput) => {
      const active = sessions.get(threadId)
      if (!active) return { ok: false, error: 'Connect to Copilot to change queued messages.' }
      try {
        const { removed } = await active.session.rpc.queue.removeAt({ id: queuedId })
        if (removed && sessions.get(threadId) === active)
          updateSnapshot(active, {
            queuedMessages: active.snapshot.queuedMessages.filter((item) => item.id !== queuedId)
          })
        refreshQueue(active)
        return removed
          ? { ok: true, snapshot: active.snapshot }
          : {
              ok: false,
              error: 'That message has already been sent to Copilot.',
              snapshot: active.snapshot
            }
      } catch (error) {
        return { ok: false, error: errorMessage(error), snapshot: active.snapshot }
      }
    },
    getFavoriteModels: () => [...(dependencies.getFavoriteModels?.() ?? [])],
    setModelFavorite: ({ model, favorite }) => {
      const current = dependencies.getFavoriteModels?.() ?? []
      if (typeof model !== 'string' || !model || current.includes(model) === favorite)
        return [...current]
      const models = favorite ? [...current, model] : current.filter((id) => id !== model)
      dependencies.setFavoriteModels?.(models)
      for (const window of BrowserWindow.getAllWindows())
        sendIpc(window.webContents, IPC_CHANNELS.copilot.favoriteModels, { models })
      return [...models]
    },
    refreshAllowedModels: () => {
      for (const active of sessions.values()) void syncAllowedModels(active)
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
    authenticateMcpServer: async ({ threadId, serverName }) => {
      const active = sessions.get(threadId)
      if (!active) return { ok: false, error: 'Connect to Copilot before signing in.' }
      return signInToMcpServer(active, serverName)
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
    resetToMessage,
    forkThread,
    resetAside,
    hasSession: (threadId) =>
      [threadId, asideSessionKey(threadId)].some(
        (key) => sessions.has(key) || startingThreads.has(key)
      ),
    isThreadWorking: (threadId) => {
      if (startingThreads.has(threadId)) return true
      const phase = sessions.get(threadId)?.snapshot.phase
      return phase === 'running' || phase === 'connecting'
    },
    runningThreadNames: () =>
      [...sessions.values()]
        .filter((active) => active.snapshot.phase === 'running')
        .map(
          (active) =>
            sessionDisplayName(active.snapshot.threadId, active.snapshot.title) ??
            active.snapshot.title ??
            'Untitled thread'
        ),
    getUserPrompts: (threadId) =>
      (sessions.get(threadId)?.snapshot.timeline ?? []).flatMap((item) =>
        item.type === 'user' ? [item.content] : []
      ),
    getMessageContent: (threadId, messageId) => {
      const item = sessions.get(threadId)?.snapshot.timeline.find((entry) => entry.id === messageId)
      return item && (item.type === 'assistant' || item.type === 'user') ? item.content : null
    },
    listModels: async () => {
      try {
        const sdkClient = await ensureClient()
        if (models.length) return { models }
        const catalog = mapCatalog(await sdkClient.listModels())
        if (client === sdkClient) models = catalog
        return { models: catalog }
      } catch (error) {
        return { models, error: errorMessage(error) }
      }
    },
    generateText: async (input) => {
      const sdkClient = await ensureClient()
      // A throwaway, tool-less session: it only reads the prompt and replies.
      const session = await sdkClient.createSession({
        workingDirectory: input.cwd,
        model: input.model,
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        enableConfigDiscovery: false,
        availableTools: [],
        streaming: false,
        systemMessage: { mode: 'replace', content: input.systemMessage },
        onPermissionRequest: async () => ({ kind: 'reject' })
      })
      try {
        const reply = await session.sendAndWait(
          { prompt: input.prompt },
          input.timeoutMs ?? GENERATE_TEXT_TIMEOUT_MS
        )
        const content = reply?.data.content?.trim()
        if (!content) throw new Error('Copilot returned an empty response.')
        return content
      } finally {
        await session.disconnect().catch(() => undefined)
        await sdkClient.deleteSession(session.sessionId).catch(() => undefined)
      }
    },
    shutdown: async () => {
      sdkManager.stopUpdateChecks()
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

  async function resetToMessage(input: CopilotMessageActionInput): Promise<CopilotStartResult> {
    if (isAsideSessionKey(input.threadId))
      return { ok: false, error: 'An aside cannot be reset to a message.' }
    const active = sessions.get(input.threadId)
    if (!active) return { ok: false, error: 'Connect to Copilot to reset the conversation.' }
    const busy = (): string | null =>
      active.snapshot.phase !== 'idle' ||
      active.pending.length ||
      active.snapshot.queuedMessages.length ||
      active.modelChangePending
        ? 'Wait for Copilot to finish before resetting the conversation.'
        : null
    const busyError = busy()
    if (busyError) return { ok: false, error: busyError, snapshot: active.snapshot }
    try {
      const boundary = findTurnEndBoundary(await active.session.getEvents(), input.messageId)
      if (!boundary) throw new Error('That message is no longer in the conversation.')
      if (!boundary.eventId) throw new Error('That message is already the latest one.')
      const revision = active.sendRevision
      const confirmed = (await dependencies.confirmReset?.()) ?? true
      if (!confirmed) return { ok: false, cancelled: true, snapshot: active.snapshot }
      if (sessions.get(input.threadId) !== active)
        throw new Error('The Copilot session closed before the conversation was reset.')
      const stillBusy = busy()
      if (stillBusy || active.sendRevision !== revision)
        throw new Error(stillBusy ?? 'The conversation changed. Try again.')
      await active.session.rpc.history.truncate({ eventId: boundary.eventId })
      const history = await active.session.getEvents()
      active.prompt = null
      active.lastSummary = null
      updateSnapshot(active, {
        timeline: buildTimeline(history, active.session.sessionId, null),
        error: null
      })
      dependencies.onHistoryTruncated?.(input.threadId, describeHistory(history))
      return { ok: true, snapshot: active.snapshot }
    } catch (error) {
      return { ok: false, error: errorMessage(error), snapshot: active.snapshot }
    }
  }

  async function forkThread(input: CopilotForkThreadInput): Promise<MutationResult> {
    if (isAsideSessionKey(input.threadId)) return { ok: false, error: 'An aside cannot be forked.' }
    try {
      const active = sessions.get(input.threadId)
      const sessionId =
        active?.session.sessionId ??
        dependencies.resolveThread(input.threadId)?.thread.resumeSessionId
      if (!sessionId) throw new Error('This thread has no Copilot conversation to fork yet.')
      const events = active ? await active.session.getEvents() : null
      let boundary: string | null = null
      if (input.messageId) {
        if (!events) throw new Error('Connect to Copilot to fork from a message.')
        const found = findTurnEndBoundary(events, input.messageId)
        if (!found) throw new Error('That message is no longer in the conversation.')
        if (!found.eventId && active?.snapshot.phase === 'running')
          throw new Error('Wait for Copilot to finish this turn before forking from it.')
        boundary = found.eventId
      } else if (events && active?.snapshot.phase === 'running') {
        boundary = latestTurnStart(events)
      }
      const forkedSessionId = await forkSession(await ensureClient(), sessionId, boundary)
      const result = dependencies.createForkedThread?.({
        sourceThreadId: input.threadId,
        sessionId: forkedSessionId,
        history: events ? describeHistory(eventsBefore(events, boundary)) : null
      })
      return result ?? { ok: false, error: 'Forking threads is not supported.' }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async function resetAside(threadId: string): Promise<CopilotStartResult> {
    if (isAsideSessionKey(threadId)) return { ok: false, error: 'Expected a thread id.' }
    const key = asideSessionKey(threadId)
    await stopSession(key)
    const previous = dependencies.getAside?.(threadId)
    dependencies.setAside?.(threadId, null)
    if (previous) {
      try {
        await (await ensureClient()).deleteSession(previous.sessionId)
      } catch (error) {
        console.warn('Could not delete the previous aside session:', error)
      }
    }
    return start(key)
  }

  /** The name of the thread a session belongs to, or null when the thread is gone. */
  function sessionDisplayName(key: string, title: string | null): string | null {
    const parentThreadId = asideParentThreadId(key)
    const thread = dependencies.resolveThread(parentThreadId ?? key)?.thread
    if (!thread) return null
    if (parentThreadId) return `${threadDisplayName(thread)} (aside)`
    return resolveThreadTitle(thread, title) ?? threadDisplayName(thread)
  }

  /** Stops a thread's session and its aside's. */
  async function stopThread(threadId: string): Promise<void> {
    await stopSession(threadId)
    if (!isAsideSessionKey(threadId)) await stopSession(asideSessionKey(threadId))
  }

  async function stopSession(threadId: string): Promise<void> {
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
      pendingInteraction: null,
      queuedMessages: [],
      steeringMessages: []
    })
    try {
      await active.session.disconnect()
    } catch {
      await discardClient()
    }
  }
}
