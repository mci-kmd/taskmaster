export type ViewMode = 'projects' | 'inbox'

export type ThreadMode = 'active-branch' | 'new-branch' | 'worktree'
export type ThreadAgentInterface = 'cli' | 'custom'
export type TerminalKind = 'agent' | 'shell'
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

export type AgentLaunchMode = 'new' | 'resume'

export interface AgentLaunchRequest {
  mode: AgentLaunchMode
  sessionName: string
  resumeSessionId: string | null
  globalFlags: string[]
}

export interface PersistedProjectTask {
  id: string
  title: string
  description: string
  tags: ProjectTaskTag[]
  createdAt: string
}

export interface TerminalCreateRequest {
  cols: number
  rows: number
  kind?: TerminalKind
  agentLaunch?: AgentLaunchRequest
  cwd?: string
  executionCwd?: string
  backend?: RepositoryBackend
  /** @deprecated Agent arguments are now built by the selected provider. */
  args?: string[]
  threadId?: string
  threadMode?: ThreadMode
  branchName?: string
}

export interface TerminalStatus {
  available: boolean
  label?: string
  commandPath?: string
  defaultCwd: string
  message: string
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

export type TerminalSessionStartSource = 'startup' | 'resume' | 'new'

export interface TerminalSessionStartEvent {
  terminalId: string
  sessionId: string
  source: TerminalSessionStartSource
}

export interface TerminalUserPromptEvent {
  terminalId: string
  sessionId: string
  prompt: string
}

export interface TerminalApi {
  getStatus: (backend?: RepositoryBackend) => Promise<TerminalStatus>
  create: (request: TerminalCreateRequest) => Promise<TerminalLaunchResult>
  kill: (terminalId: string) => Promise<boolean>
  hasClipboardImage: () => Promise<boolean>
  readClipboardText: () => Promise<string>
  input: (terminalId: string, data: string) => void
  resize: (terminalId: string, cols: number, rows: number) => void
  onData: (callback: (payload: TerminalDataEvent) => void) => () => void
  onExit: (callback: (payload: TerminalExitEvent) => void) => () => void
  onSessionStart: (callback: (payload: TerminalSessionStartEvent) => void) => () => void
  onUserPrompt: (callback: (payload: TerminalUserPromptEvent) => void) => () => void
}

export interface PersistedSettings {
  globalFlagsInput: string
  terminalFontFamilyInput: string
  taskTagsInput: string
}

export interface PersistedRepository {
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
  addedAt: string
  tasks: PersistedProjectTask[]
}

export interface PersistedThread {
  /** Older threads belong to the projects view. */
  viewMode?: ViewMode
  settledAt?: string | null
  id: string
  repositoryId: string
  customTitle: string | null
  latestCopilotTitle: string | null
  lastUserMessage: string | null
  mode: ThreadMode
  agentInterface?: ThreadAgentInterface
  branchName: string
  worktreePath: string | null
  ownsBranch?: boolean
  ownsWorktree?: boolean
  sessionName: string
  resumeSessionId: string | null
  createdAt: string
  lastActivityAt: string
  hasLaunched: boolean
}

export interface PersistedAppState {
  version: 15
  settings: PersistedSettings
  repositories: PersistedRepository[]
  threads: PersistedThread[]
  ui: {
    selectedRepositoryId: string | null
    selectedThreadId: string | null
    viewMode?: ViewMode
    modeSelections?: Partial<
      Record<ViewMode, { repositoryId: string | null; threadId: string | null }>
    >
    sidebarWidth?: number
  }
}

export interface AppSettingsSnapshot extends PersistedSettings {
  parsedGlobalFlags: string[]
  parsedTaskTags: ProjectTaskTag[]
  resolvedTerminalFontFamily: string
}

export interface ThreadSnapshot extends PersistedThread {
  cwd: string
  executionCwd: string
  backend: RepositoryBackend
  displayBranchName: string
  /** Fallback label when no live or persisted Copilot title is available. */
  displayTitle: string
  isRunning: boolean
  isRunCommandRunning: boolean
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

export type SidebarContextMenuKind = 'repository' | 'thread'

export type SidebarContextMenuAction =
  | 'new-thread'
  | 'edit'
  | 'convert-to-worktree'
  | 'close-thread'
  | 'settle-thread'
  | 'unsettle-thread'

export interface SidebarContextMenuRequest {
  inboxThread?: boolean
  settled?: boolean
  kind: SidebarContextMenuKind
  itemId: string
  x: number
  y: number
  convertToWorktreeVisible: boolean
  convertToWorktreeEnabled: boolean
  closeThreadEnabled: boolean
}

export interface SidebarContextMenuActionEvent {
  action: SidebarContextMenuAction
  kind: SidebarContextMenuKind
  itemId: string
}

export interface AppSnapshot {
  viewMode?: ViewMode
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
  agentInterface?: ThreadAgentInterface
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

export type CopilotInteraction =
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

export interface CopilotSessionSnapshot {
  threadId: string
  sessionId: string | null
  title: string | null
  phase: 'disconnected' | 'connecting' | 'idle' | 'running' | 'error'
  model: string | null
  reasoningEffort: CopilotReasoningEffort | null
  agentMode: CopilotAgentMode
  models: CopilotModelOption[]
  timeline: CopilotTimelineItem[]
  pendingInteraction: CopilotInteraction | null
  error: string | null
}

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
}

export interface CopilotSetModelInput {
  threadId: string
  model: string
  reasoningEffort: CopilotReasoningEffort | null
}

export interface CopilotInteractionResponse {
  threadId: string
  interactionId: string
  action: 'approve-once' | 'approve-session' | 'reject' | 'accept' | 'decline' | 'cancel'
  value?: string
  values?: Record<string, string | number | boolean | string[]>
  wasFreeform?: boolean
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

export interface CopilotSdkStatusEvent {
  status: CopilotSdkStatus
}

export interface CopilotApi {
  getSdkStatus: () => Promise<CopilotSdkStatus>
  checkForSdkUpdate: () => Promise<CopilotSdkStatus>
  updateSdk: () => Promise<CopilotSdkStatus>
  start: (threadId: string) => Promise<CopilotStartResult>
  getSession: (threadId: string) => Promise<CopilotSessionSnapshot | null>
  listSkills: (threadId: string) => Promise<CopilotSkillsResult>
  send: (input: CopilotSendInput) => Promise<CopilotStartResult>
  abort: (threadId: string) => Promise<boolean>
  setModel: (input: CopilotSetModelInput) => Promise<CopilotStartResult>
  respond: (input: CopilotInteractionResponse) => Promise<boolean>
  pickAttachments: () => Promise<CopilotPickAttachmentsResult>
  getPathForFile: (file: unknown) => string
  onSession: (callback: (payload: CopilotSessionEvent) => void) => () => void
  onSdkStatus: (callback: (payload: CopilotSdkStatusEvent) => void) => () => void
}

export interface UpdateSettingsInput {
  globalFlagsInput: string
  terminalFontFamilyInput: string
  taskTagsInput: string
}

export interface UpdateRepositoryInput {
  icon?: string
  iconColor?: string
  repositoryId: string
  faviconPath: string | null
  runCommand: string | null
  solutionFilePath: string | null
  newWorktreeSetupCommand: string | null
  postWorktreeRemoveCommand: string | null
}

export interface CreateRepositoryTaskInput {
  repositoryId: string
  title: string
  description: string
  tags: ProjectTaskTag[]
}

export interface CompleteRepositoryTaskInput {
  repositoryId: string
  taskId: string
}

export interface UpdateRepositoryTaskInput {
  repositoryId: string
  taskId: string
  title: string
  description: string
  tags: ProjectTaskTag[]
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
  viewMode?: ViewMode
  sidebarWidth?: number
}

export interface UpdateThreadCopilotTitleInput {
  threadId: string
  title: string
}

export interface UpdateThreadResumeSessionInput {
  threadId: string
  sessionId: string
  source: TerminalSessionStartSource
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
