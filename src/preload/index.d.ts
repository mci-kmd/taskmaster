import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppSnapshot,
  BranchStatusRequest,
  BranchStatusSnapshot,
  CreateThreadInput,
  MutationResult,
  OpenThreadWorkingDirectoryResult,
  PickRepositoryFaviconResult,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest,
  TerminalApi,
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
    updateThread: (input: UpdateThreadInput) => Promise<MutationResult>
    pickRepositoryFavicon: (repositoryId: string) => Promise<PickRepositoryFaviconResult>
    createThread: (input: CreateThreadInput) => Promise<MutationResult>
    closeThread: (threadId: string) => Promise<MutationResult>
    updateSettings: (input: UpdateSettingsInput) => Promise<MutationResult>
    updateUi: (input: UpdateUiInput) => Promise<MutationResult>
    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) => Promise<boolean>
    getBranchStatus: (input: BranchStatusRequest) => Promise<BranchStatusSnapshot | null>
    openThreadWorkingDirectory: (threadId: string) => Promise<OpenThreadWorkingDirectoryResult>
    selectRepository: (repositoryId: string | null) => Promise<AppSnapshot>
    selectThread: (threadId: string | null) => Promise<AppSnapshot>
    showSidebarContextMenu: (input: SidebarContextMenuRequest) => Promise<boolean>
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
