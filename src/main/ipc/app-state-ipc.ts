import { app } from 'electron'
import type {
  AppSnapshot,
  BranchStatusRequest,
  BranchStatusSnapshot,
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  CreateThreadInput,
  MutationResult,
  OpenThreadWorkingDirectoryResult,
  OpenThreadWorkspaceInVscodeResult,
  PickRepositoryFaviconResult,
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
} from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { handleIpc } from './typed-ipc'

type AppStateIpcHandlers = {
  beforeQuit: () => void
  getSnapshot: () => AppSnapshot
  refresh: () => AppSnapshot
  addRepository: () => Promise<MutationResult>
  createRepositoryTask: (input: CreateRepositoryTaskInput) => MutationResult
  completeRepositoryTask: (input: CompleteRepositoryTaskInput) => MutationResult
  updateRepositoryTask: (input: UpdateRepositoryTaskInput) => MutationResult
  createThread: (input: CreateThreadInput) => MutationResult
  closeThread: (threadId: string) => Promise<MutationResult>
  updateRepository: (input: UpdateRepositoryInput) => MutationResult
  startThreadRun: (threadId: string) => MutationResult
  stopThreadRun: (threadId: string) => MutationResult
  updateThread: (input: UpdateThreadInput) => MutationResult
  pickRepositoryFavicon: (repositoryId: string) => Promise<PickRepositoryFaviconResult>
  updateSettings: (input: UpdateSettingsInput) => MutationResult
  updateUi: (input: UpdateUiInput) => MutationResult
  updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) => boolean
  updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) => boolean
  updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) => boolean
  getBranchStatus: (input: BranchStatusRequest) => Promise<BranchStatusSnapshot | null>
  getThreadDiffSummary: (input: ThreadDiffQuery) => Promise<ThreadDiffSummaryResult>
  getThreadDiffRangeOptions: (threadId: string) => Promise<ThreadDiffRangeOptionsResult>
  getThreadDiffPatch: (input: ThreadDiffPatchRequest) => Promise<ThreadDiffPatchResult>
  openThreadWorkingDirectory: (threadId: string) => Promise<OpenThreadWorkingDirectoryResult>
  openThreadWorkspaceInVscode: (threadId: string) => Promise<OpenThreadWorkspaceInVscodeResult>
  selectRepository: (repositoryId: string | null) => AppSnapshot
  selectThread: (threadId: string | null) => AppSnapshot
}

export function registerAppStateIpcHandlers(handlers: AppStateIpcHandlers): void {
  app.on('before-quit', handlers.beforeQuit)

  handleIpc(IPC_CHANNELS.appState.getSnapshot, () => handlers.getSnapshot())
  handleIpc(IPC_CHANNELS.appState.refresh, () => handlers.refresh())
  handleIpc(IPC_CHANNELS.appState.addRepository, () => handlers.addRepository())
  handleIpc(
    IPC_CHANNELS.appState.createRepositoryTask,
    (_event, input: CreateRepositoryTaskInput) => handlers.createRepositoryTask(input)
  )
  handleIpc(
    IPC_CHANNELS.appState.completeRepositoryTask,
    (_event, input: CompleteRepositoryTaskInput) => handlers.completeRepositoryTask(input)
  )
  handleIpc(
    IPC_CHANNELS.appState.updateRepositoryTask,
    (_event, input: UpdateRepositoryTaskInput) => handlers.updateRepositoryTask(input)
  )
  handleIpc(IPC_CHANNELS.appState.createThread, (_event, input: CreateThreadInput) =>
    handlers.createThread(input)
  )
  handleIpc(IPC_CHANNELS.appState.closeThread, (_event, threadId: string) =>
    handlers.closeThread(threadId)
  )
  handleIpc(IPC_CHANNELS.appState.updateRepository, (_event, input: UpdateRepositoryInput) =>
    handlers.updateRepository(input)
  )
  handleIpc(IPC_CHANNELS.appState.startThreadRun, (_event, threadId: string) =>
    handlers.startThreadRun(threadId)
  )
  handleIpc(IPC_CHANNELS.appState.stopThreadRun, (_event, threadId: string) =>
    handlers.stopThreadRun(threadId)
  )
  handleIpc(IPC_CHANNELS.appState.updateThread, (_event, input: UpdateThreadInput) =>
    handlers.updateThread(input)
  )
  handleIpc(IPC_CHANNELS.appState.pickRepositoryFavicon, (_event, repositoryId: string) =>
    handlers.pickRepositoryFavicon(repositoryId)
  )
  handleIpc(IPC_CHANNELS.appState.updateSettings, (_event, input: UpdateSettingsInput) =>
    handlers.updateSettings(input)
  )
  handleIpc(IPC_CHANNELS.appState.updateUi, (_event, input: UpdateUiInput) =>
    handlers.updateUi(input)
  )
  handleIpc(
    IPC_CHANNELS.appState.updateThreadCopilotTitle,
    (_event, input: UpdateThreadCopilotTitleInput) => handlers.updateThreadCopilotTitle(input)
  )
  handleIpc(
    IPC_CHANNELS.appState.updateThreadResumeSession,
    (_event, input: UpdateThreadResumeSessionInput) => handlers.updateThreadResumeSession(input)
  )
  handleIpc(
    IPC_CHANNELS.appState.updateThreadLastUserMessage,
    (_event, input: UpdateThreadLastUserMessageInput) => handlers.updateThreadLastUserMessage(input)
  )
  handleIpc(IPC_CHANNELS.appState.getBranchStatus, (_event, input: BranchStatusRequest) =>
    handlers.getBranchStatus(input)
  )
  handleIpc(IPC_CHANNELS.appState.getThreadDiffSummary, (_event, input: ThreadDiffQuery) =>
    handlers.getThreadDiffSummary(input)
  )
  handleIpc(IPC_CHANNELS.appState.getThreadDiffRangeOptions, (_event, threadId: string) =>
    handlers.getThreadDiffRangeOptions(threadId)
  )
  handleIpc(IPC_CHANNELS.appState.getThreadDiffPatch, (_event, input: ThreadDiffPatchRequest) =>
    handlers.getThreadDiffPatch(input)
  )
  handleIpc(IPC_CHANNELS.appState.openThreadWorkingDirectory, (_event, threadId: string) =>
    handlers.openThreadWorkingDirectory(threadId)
  )
  handleIpc(IPC_CHANNELS.appState.openThreadWorkspaceInVscode, (_event, threadId: string) =>
    handlers.openThreadWorkspaceInVscode(threadId)
  )
  handleIpc(IPC_CHANNELS.appState.selectRepository, (_event, repositoryId: string | null) =>
    handlers.selectRepository(repositoryId)
  )
  handleIpc(IPC_CHANNELS.appState.selectThread, (_event, threadId: string | null) =>
    handlers.selectThread(threadId)
  )
}
