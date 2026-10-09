export type ThreadMode = 'active-branch' | 'new-branch' | 'worktree'
export type TerminalKind = 'shell'
export type ProjectTaskTag = string
export type CopilotReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CopilotAgentMode = 'interactive' | 'plan' | 'autopilot'

export interface RepositoryBranchOption {
  value: string
  kind: 'local' | 'remote'
  label: string
}

export interface RepositoryWorktreeOption {
  branchName: string
  path: string
}

export type RepositoryBackend = { kind: 'native' }

export interface PersistedProjectTask {
  id: string
  /** Per-project number shown to the user and agent as `#N`. Backfilled for legacy tasks. */
  number: number
  title: string
  description: string
  tags: ProjectTaskTag[]
  /** Canonical URL of the linked GitHub issue, if any. */
  githubIssueUrl?: string
  createdAt: string
}

export interface PersistedCompletedProjectTask extends PersistedProjectTask {
  completedAt: string
}

export interface TerminalCreateRequest {
  cols: number
  rows: number
  kind?: TerminalKind
  cwd?: string
  executionCwd?: string
  backend?: RepositoryBackend
  threadId?: string
  threadMode?: ThreadMode
  branchName?: string
}

export interface TerminalLaunchSuccess {
  ok: true
  terminalId: string
  cwd: string
  launchedCommand: string
}

export interface TerminalLaunchFailure {
  ok: false
  error: string
}

export type TerminalLaunchResult = TerminalLaunchSuccess | TerminalLaunchFailure

export interface TerminalDataEvent {
  terminalId: string
  data: string
}

export interface TerminalExitEvent {
  terminalId: string
  exitCode: number
}

export interface TerminalApi {
  create: (request: TerminalCreateRequest) => Promise<TerminalLaunchResult>
  kill: (terminalId: string) => Promise<boolean>
  readClipboardText: () => Promise<string>
  input: (terminalId: string, data: string) => void
  resize: (terminalId: string, cols: number, rows: number) => void
  onData: (callback: (payload: TerminalDataEvent) => void) => () => void
  onExit: (callback: (payload: TerminalExitEvent) => void) => () => void
}

export interface PersistedSettings {
  yoloEnabled: boolean
  terminalFontFamilyInput: string
  taskTagsInput: string
  lastCopilotModelSelection?: CopilotModelSelection
  /** Model ids starred in the model picker, in the order they were starred. */
  favoriteCopilotModels?: string[]
  /** Model ids tucked under a Legacy row in their family in the model picker. */
  legacyCopilotModels?: string[]
}

export type CopilotModelSelection = {
  model: string
  reasoningEffort: CopilotReasoningEffort | null
}

/** 'general' is the built-in project for non-repository work, rooted in the user's home directory. */
export type ProjectKind = 'repository' | 'general'

export interface PersistedRepository {
  /** Absent for regular git repositories. */
  kind?: ProjectKind
  icon?: string
  iconColor?: string
  id: string
  name: string
  path: string
  backend: RepositoryBackend
  faviconPath: string | null
  runCommand: string | null
  solutionFilePath: string | null
  newWorktreeSetupCommand: string | null
  postWorktreeRemoveCommand: string | null
  /** Opt-in address served by the run command; may contain the run command's branch tokens. */
  previewUrl?: string
  /** Project-specific task tags, offered in addition to the global settings tags. */
  taskTagsInput?: string
  /** Model that writes AI commit messages. Absent means DEFAULT_COMMIT_MESSAGE_MODEL. */
  commitMessageModel?: CopilotModelSelection
  /** Push to the remote after an AI commit. Absent means off. */
  autoPushAfterCommit?: boolean
  /** Listed first in project pickers. Absent means not a favorite. */
  favorite?: boolean
  addedAt: string
  tasks: PersistedProjectTask[]
  /** Completed tasks, most recently completed first. Absent until a task is completed. */
  completedTasks?: PersistedCompletedProjectTask[]
}

export interface PersistedThread {
  settledAt?: string | null
  id: string
  repositoryId: string
  /** Set by the user; replaces any generated title. */
  customTitle: string | null
  /** Written by the project's commit message model from the conversation. */
  generatedTitle?: string | null
  latestCopilotTitle: string | null
  lastUserMessage: string | null
  mode: ThreadMode
  branchName: string
  worktreePath: string | null
  ownsBranch?: boolean
  ownsWorktree?: boolean
  resumeSessionId: string | null
  createdAt: string
  lastActivityAt: string
}

export interface PersistedAppState {
  version: 17
  settings: PersistedSettings
  repositories: PersistedRepository[]
  threads: PersistedThread[]
  ui: {
    selectedRepositoryId: string | null
    selectedThreadId: string | null
    sidebarWidth?: number
  }
}

export interface AppSettingsSnapshot extends PersistedSettings {
  parsedTaskTags: ProjectTaskTag[]
  resolvedTerminalFontFamily: string
}

export interface ThreadSnapshot extends PersistedThread {
  projectKind: ProjectKind
  cwd: string
  executionCwd: string
  backend: RepositoryBackend
  displayBranchName: string
  /** Fallback label when no live or persisted Copilot title is available. */
  displayTitle: string
  isRunCommandRunning: boolean
  /** The phase of this thread's in-progress AI commit, or null when not committing. */
  commitPhase: ThreadCommitPhase | null
  /** The project's preview URL with this thread's branch tokens applied, or null when not opted in. */
  previewUrl: string | null
  /** Whether the AI commit action also pushes to the remote. */
  commitAutoPush: boolean
}

export interface RepositorySnapshot extends PersistedRepository {
  currentBranch: string
  faviconUrl: string | null
  /** Resolved primary branch from remote default-branch metadata, or null if none found. */
  primaryBranch: string | null
  branchOptions: RepositoryBranchOption[]
  worktreeOptions: RepositoryWorktreeOption[]
  lastActivityAt: string
  threads: ThreadSnapshot[]
}

export type ProjectTaskSnapshot = PersistedProjectTask
export type CompletedProjectTaskSnapshot = PersistedCompletedProjectTask

export interface BranchStatusSnapshot {
  ahead: number
  behind: number
  staged: number
  modified: number
  deleted: number
  untracked: number
  conflicted: number
}

export interface BranchStatusRequest {
  repositoryId?: string | null
  threadId?: string | null
}

export type ThreadDiffMode = 'working-tree' | 'range'
export const THREAD_DIFF_WORKTREE_REF = '__taskmaster_worktree__'

export type ThreadDiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

export interface ThreadDiffQuery {
  threadId: string
  mode: ThreadDiffMode
  baseRef?: string | null
  headRef?: string | null
}

export interface ThreadDiffFileSummary {
  path: string
  previousPath: string | null
  projectRootPath: string | null
  previousProjectRootPath: string | null
  status: ThreadDiffFileStatus
  additions: number | null
  deletions: number | null
  isBinary: boolean
}

export interface ThreadDiffSummary {
  mode: ThreadDiffMode
  baseRef: string | null
  headRef: string | null
  files: ThreadDiffFileSummary[]
}

export type ThreadDiffSummaryResult =
  | {
      ok: true
      summary: ThreadDiffSummary
    }
  | {
      ok: false
      error: string
    }

export interface ThreadDiffRangeOption {
  value: string
  label: string
  description: string | null
}

export interface ThreadDiffRangeOptions {
  baseOptions: ThreadDiffRangeOption[]
  headOptions: ThreadDiffRangeOption[]
  defaultBaseRef: string
  defaultHeadRef: string
}

export type ThreadDiffRangeOptionsResult =
  | {
      ok: true
      options: ThreadDiffRangeOptions
    }
  | {
      ok: false
      error: string
    }

export interface ThreadDiffPatchRequest extends ThreadDiffQuery {
  path: string
  previousPath?: string | null
  status: ThreadDiffFileStatus
}

export type ThreadDiffPatchResult =
  | {
      ok: true
      patch: string
      isBinary: boolean
    }
  | {
      ok: false
      error: string
    }

export interface ThreadDiffFileContentRequest extends ThreadDiffQuery {
  path: string
  previousPath?: string | null
  status: ThreadDiffFileStatus
}

export type ThreadDiffFileContentResult =
  | {
      ok: true
      content: string
      revisionToken: string
    }
  | {
      ok: false
      error: string
    }

export interface ThreadDiffFileSaveRequest extends ThreadDiffQuery {
  path: string
  previousPath?: string | null
  status: ThreadDiffFileStatus
  content: string
  expectedRevisionToken: string
}

export type ThreadDiffFileSaveResult =
  | {
      ok: true
      revisionToken: string
    }
  | {
      ok: false
      error: string
    }

export type SidebarContextMenuAction =
  | 'edit'
  | 'regenerate-title'
  | 'convert-to-worktree'
  | 'close-thread'
  | 'settle-thread'
  | 'unsettle-thread'

export interface SidebarContextMenuRequest {
  settled?: boolean
  kind: 'thread'
  itemId: string
  x: number
  y: number
  convertToWorktreeVisible: boolean
  convertToWorktreeEnabled: boolean
  closeThreadEnabled: boolean
  /** False while a title is being written. */
  regenerateTitleEnabled?: boolean
}

export interface SidebarContextMenuActionEvent {
  action: SidebarContextMenuAction
  kind: 'thread'
  itemId: string
}

export interface AppSnapshot {
  repositories: RepositorySnapshot[]
  settings: AppSettingsSnapshot
  selectedRepositoryId: string | null
  selectedThreadId: string | null
  sidebarWidth: number
}

export interface MutationResult {
  ok: boolean
  snapshot?: AppSnapshot
  error?: string
  cancelled?: boolean
}

export type OpenThreadLocationResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

export type OpenThreadWorkingDirectoryResult = OpenThreadLocationResult

export type OpenThreadWorkspaceInVscodeResult = OpenThreadLocationResult

export type OpenThreadSolutionInVisualStudioResult = OpenThreadLocationResult

export interface CreateThreadInput {
  repositoryId: string
  mode: ThreadMode
  title?: string
  branchName?: string
  /** When true, base the new branch / worktree on the repo's current HEAD instead of its primary branch. */
  useCurrentBranch?: boolean
}

export interface CopilotModelOption {
  id: string
  name: string
  supportsVision: boolean
  supportedReasoningEfforts: CopilotReasoningEffort[]
  defaultReasoningEffort: CopilotReasoningEffort | null
}

export interface CopilotAttachment {
  id: string
  type: 'file' | 'blob'
  displayName: string
  path?: string
  data?: string
  mimeType?: string
  /** Small image data URL shown in the composer; never sent to Copilot. */
  previewUrl?: string
  /** Set when this attachment is a screenshot of an element picked in the preview. */
  element?: PreviewElementReference
}

export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PreviewElementReference {
  pageUrl: string
  pageTitle: string
  selector: string
  tagName: string
  role: string | null
  accessibleName: string | null
  text: string
  html: string
  /** Innermost first, e.g. ['SaveButton', 'ProfileForm']. Best effort, dev builds only. */
  components: string[]
  sourceFile: string | null
  rect: PreviewRect
  viewport: { width: number; height: number }
}

export interface PreviewCaptureRequest {
  webContentsId: number
  rect: PreviewRect
  viewport: { width: number; height: number }
}

export interface PreviewCaptureResult {
  ok: boolean
  data?: string
  mimeType?: string
  thumbnailUrl?: string
  error?: string
}

export interface PreviewApi {
  captureElement: (request: PreviewCaptureRequest) => Promise<PreviewCaptureResult>
}

export type CopilotTimelineItem =
  | {
      id: string
      type: 'user' | 'assistant' | 'reasoning'
      content: string
      timestamp: string
      streaming?: boolean
      model?: string
      attachments?: string[]
      /** A user message sent into a turn that was already running. */
      steered?: boolean
    }
  | {
      id: string
      type: 'tool'
      title: string
      detail: string
      timestamp: string
      status: 'running' | 'complete' | 'failed' | 'cancelled'
    }
  | {
      id: string
      type: 'notice'
      content: string
      timestamp: string
      tone: 'info' | 'warning' | 'error'
    }
  | {
      id: string
      /** Shown when a prompt finishes: how long it ran and what it cost. */
      type: 'summary'
      timestamp: string
      durationMs: number
      /** Billed usage in nano AI credits, including sub-agents; null when none was reported. */
      nanoAiu: number | null
      /** Sub-agents started during the prompt. */
      subagents: CopilotSubagentUsage[]
    }
  | {
      id: string
      /** A skill whose instructions were loaded into the conversation. */
      type: 'skill'
      timestamp: string
      name: string
      description: string | null
      /** Whether the user asked for the skill (e.g. with /name) or Copilot chose it. */
      invokedBy: 'user' | 'copilot'
    }
  | {
      id: string
      /** A question, permission prompt or plan approval Copilot showed, and how it was answered. */
      type: 'interaction'
      timestamp: string
      title: string
      prompt: string
      answer: string
      outcome: CopilotInteractionOutcome
    }

/** `declined` covers denials, skipped questions and rejected plans. */
export type CopilotInteractionOutcome = 'answered' | 'declined'

export interface CopilotSubagentUsage {
  /** Sub-agent instance id. */
  id: string
  model: string | null
  reasoningEffort: string | null
  /** Null while running or when the runtime did not report it. */
  durationMs: number | null
  /** Billed usage in nano AI credits; null when none was reported. */
  nanoAiu: number | null
}

export type CopilotInteractionReplyMode = 'feedback' | 'steer'

export type CopilotInteraction = (
  | {
      id: string
      kind: 'permission'
      title: string
      description: string
      allowSessionApproval: boolean
    }
  | {
      id: string
      kind: 'user-input'
      title: string
      description: string
      choices: string[]
      allowFreeform: boolean
    }
  | {
      id: string
      kind: 'elicitation'
      title: string
      description: string
      mode: 'form' | 'url'
      url?: string
      /** Choice fields are only suggestions, so the user may answer in their own words. */
      allowFreeform?: boolean
      schema?: {
        properties: Record<
          string,
          {
            type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
            title?: string
            description?: string
            default?: string | number | boolean | string[]
            options?: string[]
          }
        >
        required: string[]
      }
    }
) & {
  /**
   * Set when the user may skip the form and reply from the composer instead.
   * `feedback` declines the request with the reply as feedback; `steer` declines it and
   * sends the reply as a steering message.
   */
  replyMode?: CopilotInteractionReplyMode
}

export interface CopilotSessionSnapshot {
  threadId: string
  sessionId: string | null
  title: string | null
  phase: 'disconnected' | 'connecting' | 'idle' | 'running' | 'error'
  model: string | null
  reasoningEffort: CopilotReasoningEffort | null
  nextModelSelection: CopilotModelSelection | null
  agentMode: CopilotAgentMode
  models: CopilotModelOption[]
  timeline: CopilotTimelineItem[]
  pendingInteraction: CopilotInteraction | null
  /** Servers needing browser sign-in or manual retry, excluding silent automatic sign-ins. */
  mcpServersNeedingAuth: string[]
  mcpServersSigningIn: string[]
  /** Messages waiting to start their own turn, in the order they will run. */
  queuedMessages: CopilotQueuedMessage[]
  /** Steering messages not yet picked up by the running turn. */
  steeringMessages: string[]
  error: string | null
}

export interface CopilotQueuedMessage {
  id: string
  text: string
}

/** How a message sent while Copilot is working is delivered. */
export type CopilotSendDelivery = 'steer' | 'queue'

export interface CopilotSdkStatus {
  bundledVersion: string
  installedVersion: string
  latestVersion: string | null
  source: 'bundled' | 'managed'
  updateAvailable: boolean
  updateState: 'idle' | 'checking' | 'installing' | 'error'
  updateError: string | null
  authenticated: boolean | null
  authLabel: string | null
  runtimeVersion: string | null
  blockingThreads: CopilotSdkUpdateBlocker[]
}

export interface CopilotSdkUpdateBlocker {
  threadId: string
  title: string
}

export interface CopilotStartResult {
  ok: boolean
  snapshot?: CopilotSessionSnapshot
  error?: string
}

export interface CopilotSkill {
  name: string
  commandName: string
  description: string
  source: string
  argumentHint?: string
}

export interface CopilotSkillsResult {
  skills: CopilotSkill[]
  error?: string
}

export interface CopilotSendInput {
  threadId: string
  prompt: string
  attachments: CopilotAttachment[]
  agentMode: CopilotAgentMode
  /** Used only while a turn is running; idle sessions always start a new turn. */
  delivery?: CopilotSendDelivery
  /** Replies to this pending interaction instead of answering its form. */
  replyToInteractionId?: string
}

export interface CopilotCancelQueuedInput {
  threadId: string
  queuedId: string
}

export interface CopilotSetModelInput {
  threadId: string
  model: string
  reasoningEffort: CopilotReasoningEffort | null
}

export interface CopilotMcpAuthInput {
  threadId: string
  serverName: string
}

export interface CopilotInteractionResponse {
  threadId: string
  interactionId: string
  action: 'approve-once' | 'approve-session' | 'reject' | 'accept' | 'decline' | 'cancel'
  value?: string
  values?: Record<string, string | number | boolean | string[]>
  wasFreeform?: boolean
  /** The user's own words when declining or rejecting the request. */
  feedback?: string
}

export interface CopilotPickAttachmentsResult {
  ok: boolean
  attachments?: CopilotAttachment[]
  cancelled?: boolean
  error?: string
}

export interface CopilotSessionEvent {
  snapshot: CopilotSessionSnapshot
}

export interface ModelPerformanceSample {
  id: string
  model: string
  timestamp: string
  outputTokens: number
  durationMs: number
  timeToFirstTokenMs: number | null
  /** Billed usage for the call; absent on samples recorded before usage was tracked. */
  nanoAiu?: number | null
}

export interface UsdDkkRate {
  dkkPerUsd: number
  /** `live` once the startup lookup succeeded; otherwise the built-in fallback rate. */
  source: 'live' | 'fallback'
  /** When the live rate was published by the provider (ISO), if known. */
  updatedAt: string | null
}

export interface ModelPerformanceSampleEvent {
  sample: ModelPerformanceSample
}

export interface CopilotSdkStatusEvent {
  status: CopilotSdkStatus
}

export interface CopilotSetModelFavoriteInput {
  model: string
  favorite: boolean
}

export interface CopilotFavoriteModelsEvent {
  models: string[]
}

export interface CopilotListModelsResult {
  models: CopilotModelOption[]
  error?: string
}

export interface CopilotApi {
  getSdkStatus: () => Promise<CopilotSdkStatus>
  updateSdk: () => Promise<CopilotSdkStatus>
  start: (threadId: string) => Promise<CopilotStartResult>
  getSession: (threadId: string) => Promise<CopilotSessionSnapshot | null>
  getPerformanceSamples: () => Promise<ModelPerformanceSample[]>
  getUsdDkkRate: () => Promise<UsdDkkRate>
  onPerformanceSample: (callback: (payload: ModelPerformanceSampleEvent) => void) => () => void
  listSkills: (threadId: string) => Promise<CopilotSkillsResult>
  send: (input: CopilotSendInput) => Promise<CopilotStartResult>
  cancelQueued: (input: CopilotCancelQueuedInput) => Promise<CopilotStartResult>
  abort: (threadId: string) => Promise<boolean>
  setModel: (input: CopilotSetModelInput) => Promise<CopilotStartResult>
  getFavoriteModels: () => Promise<string[]>
  setModelFavorite: (input: CopilotSetModelFavoriteInput) => Promise<string[]>
  onFavoriteModels: (callback: (payload: CopilotFavoriteModelsEvent) => void) => () => void
  respond: (input: CopilotInteractionResponse) => Promise<boolean>
  authenticateMcpServer: (input: CopilotMcpAuthInput) => Promise<CopilotStartResult>
  pickAttachments: () => Promise<CopilotPickAttachmentsResult>
  listModels: () => Promise<CopilotListModelsResult>
  getPathForFile: (file: unknown) => string
  onSession: (callback: (payload: CopilotSessionEvent) => void) => () => void
  onSdkStatus: (callback: (payload: CopilotSdkStatusEvent) => void) => () => void
}

export interface UpdateSettingsInput {
  yoloEnabled: boolean
  terminalFontFamilyInput: string
  taskTagsInput: string
  /** Left unchanged when omitted. */
  legacyCopilotModels?: string[]
}

export interface UpdateRepositoryInput {
  /** Only honored for the general project. */
  name?: string
  icon?: string
  iconColor?: string
  repositoryId: string
  faviconPath: string | null
  runCommand: string | null
  solutionFilePath: string | null
  newWorktreeSetupCommand: string | null
  postWorktreeRemoveCommand: string | null
  previewUrl?: string | null
  taskTagsInput?: string
  /** Null restores the default commit message model. */
  commitMessageModel?: CopilotModelSelection | null
  autoPushAfterCommit?: boolean
}

export interface SetRepositoryFavoriteInput {
  repositoryId: string
  favorite: boolean
}

export type ThreadCommitPhase = 'generating' | 'hook' | 'committing' | 'pushing'

export interface ThreadCommitProgressEvent {
  threadId: string
  phase: ThreadCommitPhase
}

export interface ThreadCommitResult {
  ok: boolean
  error?: string
  /** True once the commit exists, even if a later push failed. */
  committed?: boolean
  pushed?: boolean
  message?: string
}

export interface CreateRepositoryTaskInput {
  repositoryId: string
  title: string
  description: string
  tags: ProjectTaskTag[]
  /** GitHub issue URL or `owner/repo#123`; empty or omitted for none. */
  githubIssue?: string
}

export interface CompleteRepositoryTaskInput {
  repositoryId: string
  taskId: string
}

export interface ReopenRepositoryTaskInput {
  repositoryId: string
  taskId: string
}

export interface ReorderRepositoryTasksInput {
  repositoryId: string
  taskIds: string[]
}

export interface UpdateRepositoryTaskInput {
  repositoryId: string
  taskId: string
  title: string
  description: string
  tags: ProjectTaskTag[]
  /** GitHub issue URL or `owner/repo#123`; "" clears the link, omitted keeps it. */
  githubIssue?: string
}

export interface ThreadRunStateEvent {
  threadId: string
}

export interface UpdateThreadInput {
  threadId: string
  customTitle?: string | null
  settled?: boolean
}

export interface UpdateUiInput {
  sidebarWidth?: number
}

export interface UpdateThreadCopilotTitleInput {
  threadId: string
  title: string
}

export interface UpdateThreadResumeSessionInput {
  threadId: string
  sessionId: string
  source: 'resume' | 'new'
}

export interface UpdateThreadLastUserMessageInput {
  threadId: string
  message: string | null
}

export type PickRepositoryFaviconResult =
  | {
      ok: true
      path: string
    }
  | {
      ok: false
      cancelled: true
    }
  | {
      ok: false
      error: string
    }

export type PickRepositorySolutionFileResult = PickRepositoryFaviconResult

export const SIDEBAR_WIDTH_DEFAULT = 268
export const SIDEBAR_WIDTH_MIN = 220
export const SIDEBAR_WIDTH_MAX = 560
