import { randomUUID } from 'crypto'
import type {
  AppSnapshot,
  BranchStatusRequest,
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  CreateThreadInput,
  MutationResult,
  PickRepositoryFaviconResult,
  ThreadDiffFileContentRequest,
  ThreadDiffFileContentResult,
  ThreadDiffFileSaveRequest,
  ThreadDiffFileSaveResult,
  ThreadDiffPatchRequest,
  ThreadDiffPatchResult,
  ThreadDiffQuery,
  ThreadDiffRangeOptionsResult,
  ThreadDiffSummaryResult,
  UpdateRepositoryInput,
  UpdateRepositoryTaskInput,
  UpdateSettingsInput,
  UpdateThreadCopilotTitleInput,
  UpdateThreadInput,
  UpdateThreadLastUserMessageInput,
  UpdateThreadResumeSessionInput,
  UpdateUiInput
} from '../shared/app-types'
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../shared/app-types'
import { parseTaskTagsInput } from '../shared/task-tags'
import { normalizeCopilotTitle } from '../shared/thread-title'
import { createProjectTaskService } from './features/project-tasks/project-task-service'
import { createRepositoryService } from './features/repositories/repository-service'
import {
  buildRepositoryFaviconUrl,
  validateRepositoryFaviconAbsolutePath,
  validateRepositoryFaviconInput
} from './features/repositories/repository-favicon-service'
import {
  validateRepositorySolutionFileAbsolutePath,
  validateRepositorySolutionFileInput
} from './features/repositories/repository-solution-file-service'
import {
  createRepositoryGitStateService,
  resolveGitRoot
} from './features/repositories/repository-git'
import {
  validateRepositoryNewWorktreeSetupCommandInput,
  validateRepositoryPostWorktreeRemoveCommandInput,
  validateRepositoryRunCommandInput
} from './features/repositories/repository-values'
import { createSettingsService } from './features/settings/settings-service'
import { parseGlobalFlags } from './features/settings/global-flags'
import {
  clampSidebarWidth,
  normalizeAgentProviderId,
  normalizeTerminalFontFamilyInput,
  resolveTerminalFontFamily
} from './features/settings/settings-values'
import {
  createSnapshotService,
  type BuildSnapshotOptions
} from './features/snapshots/snapshot-service'
import { createAppStateStore } from './features/state-store/app-state-store'
import { createThreadDiffService } from './features/diffs/thread-diff-service'
import { createBranchStatusService } from './features/branch-status/branch-status-service'
import { createThreadCloseService } from './features/threads/thread-close-service'
import { createThreadCreateService } from './features/threads/thread-create-service'
import { createThreadGitContextService } from './features/threads/thread-git-context'
import { getThreadExecutionCwd, getThreadUiCwd } from './features/threads/thread-paths'
import { createThreadRunService } from './features/threads/thread-run-service'
import { createThreadStateService } from './features/threads/thread-state-service'
import { normalizeCustomTitle, normalizeTrackedText } from './features/threads/thread-values'
import { createThreadWorkspaceService } from './features/threads/thread-workspace-service'
import { sanitizeUserFacingMessage } from './features/shared/user-facing-messages'
import { getRunningThreadIds, killSessionsForThread } from './terminal'
import {
  createNativeBackend,
  getBasename,
  isSameRepositoryPath,
  parseWslUncPath,
  toUiPath
} from './backends/repository-backend'
import { registerAppStateIpcHandlers } from './ipc/app-state-ipc'
import { electronUi } from './platform/electron-ui'

const persistedStateStore = createAppStateStore()
const repositoryGitStateService = createRepositoryGitStateService()

const ensureState = (): ReturnType<typeof persistedStateStore.ensureState> =>
  persistedStateStore.ensureState()
const saveState = (): void => persistedStateStore.saveState()
const updateSelection = (repositoryId: string | null, threadId: string | null): void =>
  persistedStateStore.updateSelection(repositoryId, threadId)
const findThread = (threadId: string): ReturnType<typeof persistedStateStore.findThread> =>
  persistedStateStore.findThread(threadId)
const findRepository = (
  repositoryId: string
): ReturnType<typeof persistedStateStore.findRepository> =>
  persistedStateStore.findRepository(repositoryId)
const nowIso = (): string => new Date().toISOString()

let threadRunServiceRef: ReturnType<typeof createThreadRunService> | null = null

const snapshotService = createSnapshotService({
  ensureState,
  getRunningThreadIds,
  getRunningRunThreadIds: () => threadRunServiceRef?.getRunningThreadIds() ?? new Set(),
  getRepositoryGitState: repositoryGitStateService.getRepositoryGitState,
  getThreadUiCwd,
  getThreadExecutionCwd,
  buildRepositoryFaviconUrl,
  parseGlobalFlags,
  parseTaskTagsInput,
  resolveTerminalFontFamily,
  sidebarWidth: {
    default: SIDEBAR_WIDTH_DEFAULT,
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX
  },
  sanitizeUserFacingMessage
})

const buildSnapshot = (options: BuildSnapshotOptions = {}): AppSnapshot =>
  snapshotService.buildSnapshot(options)
const buildSelectionSnapshot = (): AppSnapshot => snapshotService.buildSelectionSnapshot()
const successResult = (): MutationResult => snapshotService.successResult()
const failureResult = (error: string, cancelled = false): MutationResult =>
  snapshotService.failureResult(error, cancelled)

const projectTaskService = createProjectTaskService({
  ensureState,
  findRepository,
  saveState,
  successResult,
  failureResult,
  nowIso,
  createId: randomUUID
})
const settingsService = createSettingsService({
  ensureState,
  saveState,
  successResult,
  normalizeAgentProviderId,
  normalizeTerminalFontFamilyInput,
  clampSidebarWidth
})
const repositoryService = createRepositoryService({
  ensureState,
  findRepository,
  saveState,
  updateSelection,
  successResult,
  failureResult,
  createId: randomUUID,
  nowIso,
  platform: process.platform,
  selectRepositoryDirectory: electronUi.selectRepositoryDirectory,
  pickRepositoryFaviconFile: electronUi.pickRepositoryFaviconFile,
  pickRepositorySolutionFile: electronUi.pickRepositorySolutionFile,
  parseWslUncPath,
  createNativeBackend,
  resolveGitRoot,
  isSameRepositoryPath,
  getBasename,
  toUiPath,
  validateRepositoryFaviconInput,
  validateRepositoryFaviconAbsolutePath,
  validateRepositoryRunCommandInput,
  validateRepositorySolutionFileInput,
  validateRepositorySolutionFileAbsolutePath,
  validateRepositoryNewWorktreeSetupCommandInput,
  validateRepositoryPostWorktreeRemoveCommandInput
})
const threadStateService = createThreadStateService({
  ensureState,
  findThread,
  saveState,
  updateSelection,
  buildSelectionSnapshot,
  successResult,
  failureResult,
  normalizeCustomTitle,
  normalizeTrackedText,
  normalizeCopilotTitle,
  nowIso
})
const threadGitContextService = createThreadGitContextService({
  ensureState,
  findThread,
  findRepository
})
const threadWorkspaceService = createThreadWorkspaceService({
  resolveThreadGitContext: threadGitContextService.resolveThreadGitContext,
  openPath: electronUi.openPath,
  openExternal: electronUi.openExternal,
  getHomePath: electronUi.getHomePath
})
const threadRunService = createThreadRunService({
  findThread,
  resolveThreadGitContext: threadGitContextService.resolveThreadGitContext,
  successResult,
  failureResult,
  broadcastThreadRunState: electronUi.broadcastThreadRunState,
  showThreadRunFailure: electronUi.showThreadRunFailure
})
threadRunServiceRef = threadRunService
const threadCreateService = createThreadCreateService({
  ensureState,
  updateSelection,
  saveState,
  successResult,
  failureResult,
  nowIso,
  createId: randomUUID
})
const threadCloseService = createThreadCloseService({
  ensureState,
  saveState,
  successResult,
  failureResult,
  stopThreadRunSession: threadRunService.stopThreadRunSession,
  killSessionsForThread,
  showMessageBox: electronUi.showMessageBox
})
const branchStatusService = createBranchStatusService({
  resolveBranchStatusContext: threadGitContextService.resolveBranchStatusContext
})
const threadDiffService = createThreadDiffService({
  resolveThreadGitContext: threadGitContextService.resolveThreadGitContext
})

export function initializeAppState(): void {
  ensureState()
  saveState()
}

export function registerAppStateIpc(): void {
  registerAppStateIpcHandlers({
    beforeQuit: () => threadRunService.shutdown(),
    getSnapshot: () => buildSnapshot(),
    refresh: () => buildSnapshot(),
    addRepository: () => repositoryService.addRepository(),
    createRepositoryTask: (input: CreateRepositoryTaskInput) =>
      projectTaskService.createRepositoryTask(input),
    completeRepositoryTask: (input: CompleteRepositoryTaskInput) =>
      projectTaskService.completeRepositoryTask(input),
    updateRepositoryTask: (input: UpdateRepositoryTaskInput) =>
      projectTaskService.updateRepositoryTask(input),
    createThread: (input: CreateThreadInput) => threadCreateService.createThread(input),
    closeThread: (threadId: string) => threadCloseService.closeThread(threadId),
    updateRepository: (input: UpdateRepositoryInput) => repositoryService.updateRepository(input),
    startThreadRun: (threadId: string) => threadRunService.startThreadRun(threadId),
    stopThreadRun: (threadId: string) => threadRunService.stopThreadRun(threadId),
    updateThread: (input: UpdateThreadInput) => threadStateService.updateThread(input),
    pickRepositoryFavicon: (repositoryId: string): Promise<PickRepositoryFaviconResult> =>
      repositoryService.pickRepositoryFavicon(repositoryId),
    pickRepositorySolutionFile: (repositoryId: string) =>
      repositoryService.pickRepositorySolutionFile(repositoryId),
    updateSettings: (input: UpdateSettingsInput) => settingsService.updateSettings(input),
    updateUi: (input: UpdateUiInput) => settingsService.updateUi(input),
    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) =>
      threadStateService.updateThreadCopilotTitle(input),
    updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) =>
      threadStateService.updateThreadResumeSession(input),
    updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) =>
      threadStateService.updateThreadLastUserMessage(input),
    getBranchStatus: (input: BranchStatusRequest) => branchStatusService.getBranchStatus(input),
    getThreadDiffSummary: (input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> =>
      threadDiffService.getThreadDiffSummary(input),
    getThreadDiffRangeOptions: (threadId: string): Promise<ThreadDiffRangeOptionsResult> =>
      threadDiffService.getThreadDiffRangeOptions(threadId),
    getThreadDiffPatch: (input: ThreadDiffPatchRequest): Promise<ThreadDiffPatchResult> =>
      threadDiffService.getThreadDiffPatch(input),
    getThreadDiffFileContent: (
      input: ThreadDiffFileContentRequest
    ): Promise<ThreadDiffFileContentResult> => threadDiffService.getThreadDiffFileContent(input),
    saveThreadDiffFileContent: (
      input: ThreadDiffFileSaveRequest
    ): Promise<ThreadDiffFileSaveResult> => threadDiffService.saveThreadDiffFileContent(input),
    openThreadWorkingDirectory: (threadId: string) =>
      threadWorkspaceService.openThreadWorkingDirectory(threadId),
    openThreadWorkspaceInVscode: (threadId: string) =>
      threadWorkspaceService.openThreadWorkspaceInVscode(threadId),
    openThreadSolutionInVisualStudio: (threadId: string) =>
      threadWorkspaceService.openThreadSolutionInVisualStudio(threadId),
    selectRepository: (repositoryId: string | null) =>
      threadStateService.selectRepository(repositoryId),
    selectThread: (threadId: string | null) => threadStateService.selectThread(threadId)
  })
}

export function markThreadLaunched(threadId: string): void {
  threadStateService.markThreadLaunched(threadId)
}
