import { clipboard, contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentProviderId,
  BranchStatusRequest,
  CreateThreadInput,
  CreateRepositoryTaskInput,
  CompleteRepositoryTaskInput,
  OpenThreadSolutionInVisualStudioResult,
  OpenThreadWorkingDirectoryResult,
  OpenThreadWorkspaceInVscodeResult,
  PickRepositoryFaviconResult,
  PickRepositorySolutionFileResult,
  RepositoryBackend,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest,
  ThreadDiffFileContentRequest,
  ThreadDiffFileContentResult,
  ThreadDiffFileSaveRequest,
  ThreadDiffFileSaveResult,
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
import {
  IPC_CHANNELS,
  type IpcEventChannel,
  type IpcEventDefinitions,
  type IpcInvokeChannel,
  type IpcInvokeDefinitions,
  type IpcSendChannel,
  type IpcSendDefinitions
} from '../shared/contracts/ipc'

function invokeIpc<Channel extends IpcInvokeChannel>(
  channel: Channel,
  ...request: IpcInvokeDefinitions[Channel]['request']
): Promise<IpcInvokeDefinitions[Channel]['response']> {
  return ipcRenderer.invoke(channel, ...request) as Promise<
    IpcInvokeDefinitions[Channel]['response']
  >
}

function sendIpc<Channel extends IpcSendChannel>(
  channel: Channel,
  payload: IpcSendDefinitions[Channel]['payload']
): void {
  ipcRenderer.send(channel, payload)
}

function onIpc<Channel extends IpcEventChannel>(
  channel: Channel,
  callback: (payload: IpcEventDefinitions[Channel]['payload']) => void
): () => void {
  const listener = (
    _event: Electron.IpcRendererEvent,
    payload: IpcEventDefinitions[Channel]['payload']
  ): void => callback(payload)

  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = {
  appState: {
    getSnapshot: () => invokeIpc(IPC_CHANNELS.appState.getSnapshot),
    refresh: () => invokeIpc(IPC_CHANNELS.appState.refresh),
    addRepository: () => invokeIpc(IPC_CHANNELS.appState.addRepository),
    updateRepository: (input: UpdateRepositoryInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateRepository, input),
    createRepositoryTask: (input: CreateRepositoryTaskInput) =>
      invokeIpc(IPC_CHANNELS.appState.createRepositoryTask, input),
    completeRepositoryTask: (input: CompleteRepositoryTaskInput) =>
      invokeIpc(IPC_CHANNELS.appState.completeRepositoryTask, input),
    updateRepositoryTask: (input: UpdateRepositoryTaskInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateRepositoryTask, input),
    startThreadRun: (threadId: string) => invokeIpc(IPC_CHANNELS.appState.startThreadRun, threadId),
    stopThreadRun: (threadId: string) => invokeIpc(IPC_CHANNELS.appState.stopThreadRun, threadId),
    updateThread: (input: UpdateThreadInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateThread, input),
    pickRepositoryFavicon: (repositoryId: string): Promise<PickRepositoryFaviconResult> =>
      invokeIpc(IPC_CHANNELS.appState.pickRepositoryFavicon, repositoryId),
    pickRepositorySolutionFile: (repositoryId: string): Promise<PickRepositorySolutionFileResult> =>
      invokeIpc(IPC_CHANNELS.appState.pickRepositorySolutionFile, repositoryId),
    createThread: (input: CreateThreadInput) =>
      invokeIpc(IPC_CHANNELS.appState.createThread, input),
    closeThread: (threadId: string) => invokeIpc(IPC_CHANNELS.appState.closeThread, threadId),
    updateSettings: (input: UpdateSettingsInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateSettings, input),
    updateUi: (input: UpdateUiInput) => invokeIpc(IPC_CHANNELS.appState.updateUi, input),
    updateThreadCopilotTitle: (input: UpdateThreadCopilotTitleInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateThreadCopilotTitle, input),
    updateThreadLastUserMessage: (input: UpdateThreadLastUserMessageInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateThreadLastUserMessage, input),
    updateThreadResumeSession: (input: UpdateThreadResumeSessionInput) =>
      invokeIpc(IPC_CHANNELS.appState.updateThreadResumeSession, input),
    getBranchStatus: (input: BranchStatusRequest) =>
      invokeIpc(IPC_CHANNELS.appState.getBranchStatus, input),
    getThreadDiffRangeOptions: (threadId: string): Promise<ThreadDiffRangeOptionsResult> =>
      invokeIpc(IPC_CHANNELS.appState.getThreadDiffRangeOptions, threadId),
    getThreadDiffSummary: (input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> =>
      invokeIpc(IPC_CHANNELS.appState.getThreadDiffSummary, input),
    getThreadDiffPatch: (input: ThreadDiffPatchRequest): Promise<ThreadDiffPatchResult> =>
      invokeIpc(IPC_CHANNELS.appState.getThreadDiffPatch, input),
    getThreadDiffFileContent: (
      input: ThreadDiffFileContentRequest
    ): Promise<ThreadDiffFileContentResult> =>
      invokeIpc(IPC_CHANNELS.appState.getThreadDiffFileContent, input),
    saveThreadDiffFileContent: (
      input: ThreadDiffFileSaveRequest
    ): Promise<ThreadDiffFileSaveResult> =>
      invokeIpc(IPC_CHANNELS.appState.saveThreadDiffFileContent, input),
    openThreadWorkingDirectory: (threadId: string): Promise<OpenThreadWorkingDirectoryResult> =>
      invokeIpc(IPC_CHANNELS.appState.openThreadWorkingDirectory, threadId),
    openThreadWorkspaceInVscode: (threadId: string): Promise<OpenThreadWorkspaceInVscodeResult> =>
      invokeIpc(IPC_CHANNELS.appState.openThreadWorkspaceInVscode, threadId),
    openThreadSolutionInVisualStudio: (
      threadId: string
    ): Promise<OpenThreadSolutionInVisualStudioResult> =>
      invokeIpc(IPC_CHANNELS.appState.openThreadSolutionInVisualStudio, threadId),
    selectRepository: (repositoryId: string | null) =>
      invokeIpc(IPC_CHANNELS.appState.selectRepository, repositoryId),
    selectThread: (threadId: string | null) =>
      invokeIpc(IPC_CHANNELS.appState.selectThread, threadId),
    showSidebarContextMenu: (input: SidebarContextMenuRequest) =>
      invokeIpc(IPC_CHANNELS.nativeMenu.showSidebarContextMenu, input),
    onThreadRunState: (callback: (payload: ThreadRunStateEvent) => void) =>
      onIpc(IPC_CHANNELS.appState.threadRunState, callback),
    onSidebarContextMenuAction: (callback: (payload: SidebarContextMenuActionEvent) => void) =>
      onIpc(IPC_CHANNELS.nativeMenu.sidebarContextMenuAction, callback)
  },
  terminal: {
    getStatus: (providerId?: AgentProviderId, backend?: RepositoryBackend) =>
      invokeIpc(IPC_CHANNELS.terminal.status, providerId, backend),
    create: (request: TerminalCreateRequest) => invokeIpc(IPC_CHANNELS.terminal.create, request),
    kill: (terminalId: string) => invokeIpc(IPC_CHANNELS.terminal.kill, terminalId),
    hasClipboardImage: () => !clipboard.readImage().isEmpty(),
    saveClipboardImage: (terminalId: string) =>
      invokeIpc(IPC_CHANNELS.terminal.saveClipboardImage, terminalId),
    readClipboardText: () => clipboard.readText(),
    input: (terminalId: string, data: string) =>
      sendIpc(IPC_CHANNELS.terminal.input, { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      sendIpc(IPC_CHANNELS.terminal.resize, { terminalId, cols, rows }),
    onData: (callback: (payload: TerminalDataEvent) => void) =>
      onIpc(IPC_CHANNELS.terminal.data, callback),
    onExit: (callback: (payload: TerminalExitEvent) => void) =>
      onIpc(IPC_CHANNELS.terminal.exit, callback),
    onSessionStart: (callback: (payload: TerminalSessionStartEvent) => void) =>
      onIpc(IPC_CHANNELS.terminal.sessionStart, callback),
    onUserPrompt: (callback: (payload: TerminalUserPromptEvent) => void) =>
      onIpc(IPC_CHANNELS.terminal.userPrompt, callback)
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
