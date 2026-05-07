import { clipboard, contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  BranchStatusRequest,
  CreateThreadInput,
  OpenThreadWorkingDirectoryResult,
  PickRepositoryFaviconResult,
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
  UpdateSettingsInput,
  UpdateUiInput
} from '../shared/app-types'

const api = {
  appState: {
    getSnapshot: () => ipcRenderer.invoke('app-state:get-snapshot'),
    refresh: () => ipcRenderer.invoke('app-state:refresh'),
    addRepository: () => ipcRenderer.invoke('app-state:add-repository'),
    updateRepository: (input: UpdateRepositoryInput) =>
      ipcRenderer.invoke('app-state:update-repository', input),
    startThreadRun: (threadId: string) =>
      ipcRenderer.invoke('app-state:start-thread-run', threadId),
    stopThreadRun: (threadId: string) => ipcRenderer.invoke('app-state:stop-thread-run', threadId),
    updateThread: (input: UpdateThreadInput) =>
      ipcRenderer.invoke('app-state:update-thread', input),
    pickRepositoryFavicon: (repositoryId: string): Promise<PickRepositoryFaviconResult> =>
      ipcRenderer.invoke('app-state:pick-repository-favicon', repositoryId),
    createThread: (input: CreateThreadInput) =>
      ipcRenderer.invoke('app-state:create-thread', input),
    closeThread: (threadId: string) => ipcRenderer.invoke('app-state:close-thread', threadId),
    updateSettings: (input: UpdateSettingsInput) =>
      ipcRenderer.invoke('app-state:update-settings', input),
    updateUi: (input: UpdateUiInput) => ipcRenderer.invoke('app-state:update-ui', input),
    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) =>
      ipcRenderer.invoke('app-state:update-thread-copilot-title', input),
    updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) =>
      ipcRenderer.invoke('app-state:update-thread-last-user-message', input),
    updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) =>
      ipcRenderer.invoke('app-state:update-thread-resume-session', input),
    getBranchStatus: (input: BranchStatusRequest) =>
      ipcRenderer.invoke('app-state:get-branch-status', input),
    getThreadDiffRangeOptions: (threadId: string): Promise<ThreadDiffRangeOptionsResult> =>
      ipcRenderer.invoke('app-state:get-thread-diff-range-options', threadId),
    getThreadDiffSummary: (input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> =>
      ipcRenderer.invoke('app-state:get-thread-diff-summary', input),
    getThreadDiffPatch: (input: ThreadDiffPatchRequest): Promise<ThreadDiffPatchResult> =>
      ipcRenderer.invoke('app-state:get-thread-diff-patch', input),
    openThreadWorkingDirectory: (threadId: string): Promise<OpenThreadWorkingDirectoryResult> =>
      ipcRenderer.invoke('app-state:open-thread-working-directory', threadId),
    selectRepository: (repositoryId: string | null) =>
      ipcRenderer.invoke('app-state:select-repository', repositoryId),
    selectThread: (threadId: string | null) =>
      ipcRenderer.invoke('app-state:select-thread', threadId),
    showSidebarContextMenu: (input: SidebarContextMenuRequest) =>
      ipcRenderer.invoke('native-menu:show-sidebar-context-menu', input),
    onThreadRunState: (callback: (payload: ThreadRunStateEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ThreadRunStateEvent): void =>
        callback(payload)
      ipcRenderer.on('app-state:thread-run-state', listener)
      return () => ipcRenderer.off('app-state:thread-run-state', listener)
    },
    onSidebarContextMenuAction: (callback: (payload: SidebarContextMenuActionEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: SidebarContextMenuActionEvent
      ): void => callback(payload)
      ipcRenderer.on('native-menu:sidebar-context-menu-action', listener)
      return () => ipcRenderer.off('native-menu:sidebar-context-menu-action', listener)
    }
  },
  terminal: {
    getStatus: () => ipcRenderer.invoke('terminal:status'),
    create: (request: TerminalCreateRequest) => ipcRenderer.invoke('terminal:create', request),
    kill: (terminalId: string) => ipcRenderer.invoke('terminal:kill', terminalId),
    readClipboardText: () => clipboard.readText(),
    input: (terminalId: string, data: string) =>
      ipcRenderer.send('terminal:input', { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', { terminalId, cols, rows }),
    onData: (callback: (payload: TerminalDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void =>
        callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.off('terminal:data', listener)
    },
    onExit: (callback: (payload: TerminalExitEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void =>
        callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.off('terminal:exit', listener)
    },
    onSessionStart: (callback: (payload: TerminalSessionStartEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalSessionStartEvent
      ): void => callback(payload)
      ipcRenderer.on('terminal:session-start', listener)
      return () => ipcRenderer.off('terminal:session-start', listener)
    },
    onUserPrompt: (callback: (payload: TerminalUserPromptEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalUserPromptEvent
      ): void => callback(payload)
      ipcRenderer.on('terminal:user-prompt', listener)
      return () => ipcRenderer.off('terminal:user-prompt', listener)
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
