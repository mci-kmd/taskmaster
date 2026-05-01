import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppSnapshot,
  CreateThreadInput,
  MutationResult,
  TerminalApi,
  UpdateSettingsInput,
  UpdateUiInput
} from '../shared/app-types'

declare global {
  interface AppStateApi {
    getSnapshot: () => Promise<AppSnapshot>
    refresh: () => Promise<AppSnapshot>
    addRepository: () => Promise<MutationResult>
    createThread: (input: CreateThreadInput) => Promise<MutationResult>
    closeThread: (threadId: string) => Promise<MutationResult>
    updateSettings: (input: UpdateSettingsInput) => Promise<MutationResult>
    updateUi: (input: UpdateUiInput) => Promise<MutationResult>
    selectRepository: (repositoryId: string | null) => Promise<AppSnapshot>
    selectThread: (threadId: string | null) => Promise<AppSnapshot>
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
