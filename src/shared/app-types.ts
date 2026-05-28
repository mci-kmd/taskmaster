export type ThreadMode = 'active-branch' | 'new-branch' | 'worktree'
export type AgentProviderId = 'copilot' | 'codex'
export type TerminalKind = 'agent' | 'shell'
export type ProjectTaskTag = string

export interface RepositoryBranchOption {
  value: string
  kind: 'local' | 'remote'
  label: string
}

export interface RepositoryWorktreeOption {
  branchName: string
  path: string
}

export type RepositoryBackend =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string; windowsPath: string; linuxPath: string }

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
  agentProviderId?: AgentProviderId
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
  providerId?: AgentProviderId
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

export type TerminalClipboardImageResult = { ok: true; path: string } | { ok: false; error: string }

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
  providerId?: AgentProviderId
  sessionId: string
  source: TerminalSessionStartSource
}

export interface TerminalUserPromptEvent {
  terminalId: string
  providerId?: AgentProviderId
  sessionId: string
  prompt: string
}

export interface TerminalApi {
  getStatus: (providerId?: AgentProviderId, backend?: RepositoryBackend) => Promise<TerminalStatus>
  create: (request: TerminalCreateRequest) => Promise<TerminalLaunchResult>
  kill: (terminalId: string) => Promise<boolean>
  hasClipboardImage: () => boolean
  saveClipboardImage: (terminalId: string) => Promise<TerminalClipboardImageResult>
  readClipboardText: () => string
  input: (terminalId: string, data: string) => void
  resize: (terminalId: string, cols: number, rows: number) => void
  onData: (callback: (payload: TerminalDataEvent) => void) => () => void
  onExit: (callback: (payload: TerminalExitEvent) => void) => () => void
  onSessionStart: (callback: (payload: TerminalSessionStartEvent) => void) => () => void
  onUserPrompt: (callback: (payload: TerminalUserPromptEvent) => void) => () => void
}

export interface PersistedSettings {
  agentProviderId: AgentProviderId
  globalFlagsInput: string
  terminalFontFamilyInput: string
  taskTagsInput: string
}

export interface PersistedRepository {
  id: string
  name: string
  path: string
  backend: RepositoryBackend
  faviconPath: string | null
  runCommand: string | null
  newWorktreeSetupCommand: string | null
  postWorktreeRemoveCommand: string | null
  addedAt: string
  tasks: PersistedProjectTask[]
}

export interface PersistedThread {
  id: string
  repositoryId: string
  customTitle: string | null
  latestCopilotTitle: string | null
  lastUserMessage: string | null
  mode: ThreadMode
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
  version: 12
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
  /** Resolved primary branch (origin/HEAD → main → master) or null if none found. */
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

export type SidebarContextMenuAction = 'new-thread' | 'edit' | 'close-thread'

export interface SidebarContextMenuRequest {
  kind: SidebarContextMenuKind
  itemId: string
  x: number
  y: number
  closeThreadEnabled: boolean
}

export interface SidebarContextMenuActionEvent {
  action: SidebarContextMenuAction
  kind: SidebarContextMenuKind
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

export interface CreateThreadInput {
  repositoryId: string
  mode: ThreadMode
  title?: string
  branchName?: string
  /** When true, base the new branch / worktree on the repo's current HEAD instead of its primary branch. */
  useCurrentBranch?: boolean
}

export interface UpdateSettingsInput {
  agentProviderId: AgentProviderId
  globalFlagsInput: string
  terminalFontFamilyInput: string
  taskTagsInput: string
}

export interface UpdateRepositoryInput {
  repositoryId: string
  faviconPath: string | null
  runCommand: string | null
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
  customTitle: string | null
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

export const SIDEBAR_WIDTH_DEFAULT = 268
export const SIDEBAR_WIDTH_MIN = 220
export const SIDEBAR_WIDTH_MAX = 560
