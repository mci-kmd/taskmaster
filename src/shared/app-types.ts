export type ThreadMode = 'active-branch' | 'new-branch' | 'worktree'

export interface TerminalCreateRequest {
  cols: number
  rows: number
  cwd?: string
  args?: string[]
  threadId?: string
}

export interface TerminalStatus {
  available: boolean
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

export interface TerminalApi {
  getStatus: () => Promise<TerminalStatus>
  create: (request: TerminalCreateRequest) => Promise<TerminalLaunchResult>
  kill: (terminalId: string) => Promise<boolean>
  input: (terminalId: string, data: string) => void
  resize: (terminalId: string, cols: number, rows: number) => void
  onData: (callback: (payload: TerminalDataEvent) => void) => () => void
  onExit: (callback: (payload: TerminalExitEvent) => void) => () => void
}

export interface PersistedSettings {
  globalFlagsInput: string
}

export interface PersistedRepository {
  id: string
  name: string
  path: string
  addedAt: string
}

export interface PersistedThread {
  id: string
  repositoryId: string
  customTitle: string | null
  mode: ThreadMode
  branchName: string
  worktreePath: string | null
  sessionName: string
  createdAt: string
  lastActivityAt: string
  hasLaunched: boolean
}

export interface PersistedAppState {
  version: 2
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
}

export interface ThreadSnapshot extends PersistedThread {
  cwd: string
  displayBranchName: string
  /** Custom label fallback for display; combine with runtime title in the UI. */
  displayTitle: string
  isRunning: boolean
}

export interface RepositorySnapshot extends PersistedRepository {
  currentBranch: string
  /** Resolved primary branch (origin/HEAD → main → master) or null if none found. */
  primaryBranch: string | null
  lastActivityAt: string
  threads: ThreadSnapshot[]
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

export interface CreateThreadInput {
  repositoryId: string
  mode: ThreadMode
  title?: string
  branchName?: string
  /** When true, base the new branch / worktree on the repo's current HEAD instead of its primary branch. */
  useCurrentBranch?: boolean
}

export interface UpdateSettingsInput {
  globalFlagsInput: string
}

export interface UpdateUiInput {
  sidebarWidth?: number
}

export const SIDEBAR_WIDTH_DEFAULT = 268
export const SIDEBAR_WIDTH_MIN = 220
export const SIDEBAR_WIDTH_MAX = 560
