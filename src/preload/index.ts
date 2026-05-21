import { clipboard, contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentProviderId,
  BranchStatusRequest,
  CreateThreadInput,
  CreateRepositoryTaskInput,
  CompleteRepositoryTaskInput,
  OpenThreadWorkingDirectoryResult,
  OpenThreadWorkspaceInVscodeResult,
  PickRepositoryFaviconResult,
  RepositoryBackend,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest,
  ThreadDiffPatchRequest,
  ThreadDiffPatchResult,
  ThreadDiffQuery,
  ThreadDiffRangeOptionsResult,
  ThreadDiffSummaryResult,
  ThreadRunStateEvent,
  TerminalCreateRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionStartEvent,
  TerminalUserPromptEvent,
  UpdateThreadLastUserMessageInput,
  UpdateRepositoryInput,
  UpdateThreadInput,
  UpdateThreadCopilotTitleInput,
  UpdateThreadResumeSessionInput,
  UpdateRepositoryTaskInput,
  UpdateSettingsInput,
  UpdateUiInput
} from '../shared/app-types'
import { IPC_CHANNELS } from '../shared/contracts/ipc'

const api = {
  appState: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.appState.getSnapshot),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.appState.refresh),
    addRepository: () => ipcRenderer.invoke(IPC_CHANNELS.appState.addRepository),
    updateRepository: (input: UpdateRepositoryInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateRepository, input),
    createRepositoryTask: (input: CreateRepositoryTaskInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.createRepositoryTask, input),
    completeRepositoryTask: (input: CompleteRepositoryTaskInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.completeRepositoryTask, input),
    updateRepositoryTask: (input: UpdateRepositoryTaskInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateRepositoryTask, input),
    startThreadRun: (threadId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.startThreadRun, threadId),
    stopThreadRun: (threadId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.stopThreadRun, threadId),
    updateThread: (input: UpdateThreadInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateThread, input),
    pickRepositoryFavicon: (repositoryId: string): Promise<PickRepositoryFaviconResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.pickRepositoryFavicon, repositoryId),
    createThread: (input: CreateThreadInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.createThread, input),
    closeThread: (threadId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.closeThread, threadId),
    updateSettings: (input: UpdateSettingsInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateSettings, input),
    updateUi: (input: UpdateUiInput) => ipcRenderer.invoke(IPC_CHANNELS.appState.updateUi, input),
    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateThreadCopilotTitle, input),
    updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateThreadLastUserMessage, input),
    updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.updateThreadResumeSession, input),
    getBranchStatus: (input: BranchStatusRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.getBranchStatus, input),
    getThreadDiffRangeOptions: (threadId: string): Promise<ThreadDiffRangeOptionsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.getThreadDiffRangeOptions, threadId),
    getThreadDiffSummary: (input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.getThreadDiffSummary, input),
    getThreadDiffPatch: (input: ThreadDiffPatchRequest): Promise<ThreadDiffPatchResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.getThreadDiffPatch, input),
    openThreadWorkingDirectory: (threadId: string): Promise<OpenThreadWorkingDirectoryResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.openThreadWorkingDirectory, threadId),
    openThreadWorkspaceInVscode: (threadId: string): Promise<OpenThreadWorkspaceInVscodeResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.openThreadWorkspaceInVscode, threadId),
    selectRepository: (repositoryId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.selectRepository, repositoryId),
    selectThread: (threadId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.appState.selectThread, threadId),
    showSidebarContextMenu: (input: SidebarContextMenuRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.nativeMenu.showSidebarContextMenu, input),
    onThreadRunState: (callback: (payload: ThreadRunStateEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ThreadRunStateEvent): void =>
        callback(payload)
      ipcRenderer.on(IPC_CHANNELS.appState.threadRunState, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.appState.threadRunState, listener)
    },
    onSidebarContextMenuAction: (callback: (payload: SidebarContextMenuActionEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: SidebarContextMenuActionEvent
      ): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.nativeMenu.sidebarContextMenuAction, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.nativeMenu.sidebarContextMenuAction, listener)
    }
  },
  terminal: {
    getStatus: (providerId?: AgentProviderId, backend?: RepositoryBackend) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminal.status, providerId, backend),
    create: (request: TerminalCreateRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminal.create, request),
    kill: (terminalId: string) => ipcRenderer.invoke(IPC_CHANNELS.terminal.kill, terminalId),
    hasClipboardImage: () => !clipboard.readImage().isEmpty(),
    saveClipboardImage: (terminalId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminal.saveClipboardImage, terminalId),
    readClipboardText: () => clipboard.readText(),
    input: (terminalId: string, data: string) =>
      ipcRenderer.send(IPC_CHANNELS.terminal.input, { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC_CHANNELS.terminal.resize, { terminalId, cols, rows }),
    onData: (callback: (payload: TerminalDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void =>
        callback(payload)
      ipcRenderer.on(IPC_CHANNELS.terminal.data, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.terminal.data, listener)
    },
    onExit: (callback: (payload: TerminalExitEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void =>
        callback(payload)
      ipcRenderer.on(IPC_CHANNELS.terminal.exit, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.terminal.exit, listener)
    },
    onSessionStart: (callback: (payload: TerminalSessionStartEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalSessionStartEvent
      ): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.terminal.sessionStart, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.terminal.sessionStart, listener)
    },
    onUserPrompt: (callback: (payload: TerminalUserPromptEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalUserPromptEvent
      ): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.terminal.userPrompt, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.terminal.userPrompt, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = window as Window &
    typeof globalThis & {
      electron: typeof electronAPI
      api: typeof api
    }

  globalWindow.electron = electronAPI
  globalWindow.api = api
}
