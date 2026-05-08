import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppSnapshot,
  BranchStatusRequest,
  BranchStatusSnapshot,
  CreateThreadInput,
  MutationResult,
  OpenThreadWorkingDirectoryResult,
  OpenThreadWorkspaceInVscodeResult,
  PickRepositoryFaviconResult,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest,
  ThreadDiffPatchRequest,
  ThreadDiffPatchResult,
  ThreadDiffQuery,
  ThreadDiffRangeOptionsResult,
  ThreadDiffSummaryResult,
  ThreadRunStateEvent,
  TerminalApi,
  UpdateThreadLastUserMessageInput,
  UpdateThreadResumeSessionInput,
  UpdateRepositoryInput,
  UpdateThreadInput,
  UpdateThreadCopilotTitleInput,
  UpdateSettingsInput,
  UpdateUiInput
} from '../shared/app-types'

declare global {
  interface AppStateApi {
    getSnapshot: () => Promise<AppSnapshot>
    refresh: () => Promise<AppSnapshot>
    addRepository: () => Promise<MutationResult>
    updateRepository: (input: UpdateRepositoryInput) => Promise<MutationResult>
    startThreadRun: (threadId: string) => Promise<MutationResult>
    stopThreadRun: (threadId: string) => Promise<MutationResult>
    updateThread: (input: UpdateThreadInput) => Promise<MutationResult>
    pickRepositoryFavicon: (repositoryId: string) => Promise<PickRepositoryFaviconResult>
    createThread: (input: CreateThreadInput) => Promise<MutationResult>
    closeThread: (threadId: string) => Promise<MutationResult>
    updateSettings: (input: UpdateSettingsInput) => Promise<MutationResult>
    updateUi: (input: UpdateUiInput) => Promise<MutationResult>
    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) => Promise<boolean>
    updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) => Promise<boolean>
    updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) => Promise<boolean>
    getBranchStatus: (input: BranchStatusRequest) => Promise<BranchStatusSnapshot | null>
    getThreadDiffRangeOptions: (threadId: string) => Promise<ThreadDiffRangeOptionsResult>
    getThreadDiffSummary: (input: ThreadDiffQuery) => Promise<ThreadDiffSummaryResult>
    getThreadDiffPatch: (input: ThreadDiffPatchRequest) => Promise<ThreadDiffPatchResult>
    openThreadWorkingDirectory: (threadId: string) => Promise<OpenThreadWorkingDirectoryResult>
    openThreadWorkspaceInVscode: (threadId: string) => Promise<OpenThreadWorkspaceInVscodeResult>
    selectRepository: (repositoryId: string | null) => Promise<AppSnapshot>
    selectThread: (threadId: string | null) => Promise<AppSnapshot>
    showSidebarContextMenu: (input: SidebarContextMenuRequest) => Promise<boolean>
    onThreadRunState: (callback: (payload: ThreadRunStateEvent) => void) => () => void
    onSidebarContextMenuAction: (
      callback: (payload: SidebarContextMenuActionEvent) => void
    ) => () => void
  }

  interface Window {
    electron: ElectronAPI
    api: {
      terminal: TerminalApi
      appState: AppStateApi
    }
  }
}

export {}
