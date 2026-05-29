import type {
  AgentProviderId,
  AppSnapshot,
  BranchStatusRequest,
  BranchStatusSnapshot,
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  CreateThreadInput,
  MutationResult,
  OpenThreadWorkingDirectoryResult,
  OpenThreadSolutionInVisualStudioResult,
  OpenThreadWorkspaceInVscodeResult,
  PickRepositoryFaviconResult,
  PickRepositorySolutionFileResult,
  ThreadDiffFileContentRequest,
  ThreadDiffFileContentResult,
  ThreadDiffFileSaveRequest,
  ThreadDiffFileSaveResult,
  RepositoryBackend,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest,
  ThreadDiffPatchRequest,
  ThreadDiffPatchResult,
  ThreadDiffQuery,
  ThreadDiffRangeOptionsResult,
  ThreadDiffSummaryResult,
  ThreadRunStateEvent,
  TerminalClipboardImageResult,
  TerminalCreateRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalLaunchResult,
  TerminalSessionStartEvent,
  TerminalStatus,
  TerminalUserPromptEvent,
  UpdateRepositoryInput,
  UpdateRepositoryTaskInput,
  UpdateSettingsInput,
  UpdateThreadCopilotTitleInput,
  UpdateThreadInput,
  UpdateThreadLastUserMessageInput,
  UpdateThreadResumeSessionInput,
  UpdateUiInput
} from '../app-types'

export const IPC_CHANNELS = {
  appState: {
    getSnapshot: 'app-state:get-snapshot',
    refresh: 'app-state:refresh',
    addRepository: 'app-state:add-repository',
    updateRepository: 'app-state:update-repository',
    createRepositoryTask: 'app-state:create-repository-task',
    completeRepositoryTask: 'app-state:complete-repository-task',
    updateRepositoryTask: 'app-state:update-repository-task',
    startThreadRun: 'app-state:start-thread-run',
    stopThreadRun: 'app-state:stop-thread-run',
    updateThread: 'app-state:update-thread',
    pickRepositoryFavicon: 'app-state:pick-repository-favicon',
    pickRepositorySolutionFile: 'app-state:pick-repository-solution-file',
    createThread: 'app-state:create-thread',
    closeThread: 'app-state:close-thread',
    updateSettings: 'app-state:update-settings',
    updateUi: 'app-state:update-ui',
    updateThreadCopilotTitle: 'app-state:update-thread-copilot-title',
    updateThreadLastUserMessage: 'app-state:update-thread-last-user-message',
    updateThreadResumeSession: 'app-state:update-thread-resume-session',
    getBranchStatus: 'app-state:get-branch-status',
    getThreadDiffRangeOptions: 'app-state:get-thread-diff-range-options',
    getThreadDiffSummary: 'app-state:get-thread-diff-summary',
    getThreadDiffPatch: 'app-state:get-thread-diff-patch',
    getThreadDiffFileContent: 'app-state:get-thread-diff-file-content',
    saveThreadDiffFileContent: 'app-state:save-thread-diff-file-content',
    openThreadWorkingDirectory: 'app-state:open-thread-working-directory',
    openThreadWorkspaceInVscode: 'app-state:open-thread-workspace-in-vscode',
    openThreadSolutionInVisualStudio: 'app-state:open-thread-solution-in-visual-studio',
    selectRepository: 'app-state:select-repository',
    selectThread: 'app-state:select-thread',
    threadRunState: 'app-state:thread-run-state'
  },
  nativeMenu: {
    showSidebarContextMenu: 'native-menu:show-sidebar-context-menu',
    sidebarContextMenuAction: 'native-menu:sidebar-context-menu-action'
  },
  terminal: {
    status: 'terminal:status',
    create: 'terminal:create',
    kill: 'terminal:kill',
    saveClipboardImage: 'terminal:save-clipboard-image',
    input: 'terminal:input',
    resize: 'terminal:resize',
    data: 'terminal:data',
    exit: 'terminal:exit',
    sessionStart: 'terminal:session-start',
    userPrompt: 'terminal:user-prompt'
  }
} as const

export type IpcInvokeDefinitions = {
  'app-state:get-snapshot': { request: []; response: AppSnapshot }
  'app-state:refresh': { request: []; response: AppSnapshot }
  'app-state:add-repository': { request: []; response: MutationResult }
  'app-state:update-repository': { request: [UpdateRepositoryInput]; response: MutationResult }
  'app-state:create-repository-task': {
    request: [CreateRepositoryTaskInput]
    response: MutationResult
  }
  'app-state:complete-repository-task': {
    request: [CompleteRepositoryTaskInput]
    response: MutationResult
  }
  'app-state:update-repository-task': {
    request: [UpdateRepositoryTaskInput]
    response: MutationResult
  }
  'app-state:start-thread-run': { request: [string]; response: MutationResult }
  'app-state:stop-thread-run': { request: [string]; response: MutationResult }
  'app-state:update-thread': { request: [UpdateThreadInput]; response: MutationResult }
  'app-state:pick-repository-favicon': {
    request: [string]
    response: PickRepositoryFaviconResult
  }
  'app-state:pick-repository-solution-file': {
    request: [string]
    response: PickRepositorySolutionFileResult
  }
  'app-state:create-thread': { request: [CreateThreadInput]; response: MutationResult }
  'app-state:close-thread': { request: [string]; response: MutationResult }
  'app-state:update-settings': { request: [UpdateSettingsInput]; response: MutationResult }
  'app-state:update-ui': { request: [UpdateUiInput]; response: MutationResult }
  'app-state:update-thread-copilot-title': {
    request: [UpdateThreadCopilotTitleInput]
    response: boolean
  }
  'app-state:update-thread-last-user-message': {
    request: [UpdateThreadLastUserMessageInput]
    response: boolean
  }
  'app-state:update-thread-resume-session': {
    request: [UpdateThreadResumeSessionInput]
    response: boolean
  }
  'app-state:get-branch-status': {
    request: [BranchStatusRequest]
    response: BranchStatusSnapshot | null
  }
  'app-state:get-thread-diff-range-options': {
    request: [string]
    response: ThreadDiffRangeOptionsResult
  }
  'app-state:get-thread-diff-summary': {
    request: [ThreadDiffQuery]
    response: ThreadDiffSummaryResult
  }
  'app-state:get-thread-diff-patch': {
    request: [ThreadDiffPatchRequest]
    response: ThreadDiffPatchResult
  }
  'app-state:get-thread-diff-file-content': {
    request: [ThreadDiffFileContentRequest]
    response: ThreadDiffFileContentResult
  }
  'app-state:save-thread-diff-file-content': {
    request: [ThreadDiffFileSaveRequest]
    response: ThreadDiffFileSaveResult
  }
  'app-state:open-thread-working-directory': {
    request: [string]
    response: OpenThreadWorkingDirectoryResult
  }
  'app-state:open-thread-workspace-in-vscode': {
    request: [string]
    response: OpenThreadWorkspaceInVscodeResult
  }
  'app-state:open-thread-solution-in-visual-studio': {
    request: [string]
    response: OpenThreadSolutionInVisualStudioResult
  }
  'app-state:select-repository': { request: [string | null]; response: AppSnapshot }
  'app-state:select-thread': { request: [string | null]; response: AppSnapshot }
  'native-menu:show-sidebar-context-menu': {
    request: [SidebarContextMenuRequest]
    response: boolean
  }
  'terminal:status': {
    request: [AgentProviderId?] | [AgentProviderId | undefined, RepositoryBackend?]
    response: TerminalStatus
  }
  'terminal:create': { request: [TerminalCreateRequest]; response: TerminalLaunchResult }
  'terminal:kill': { request: [string]; response: boolean }
  'terminal:save-clipboard-image': {
    request: [string]
    response: TerminalClipboardImageResult
  }
}

export type IpcSendDefinitions = {
  'terminal:input': { payload: { terminalId: string; data: string } }
  'terminal:resize': { payload: { terminalId: string; cols: number; rows: number } }
}

export type IpcEventDefinitions = {
  'app-state:thread-run-state': { payload: ThreadRunStateEvent }
  'native-menu:sidebar-context-menu-action': { payload: SidebarContextMenuActionEvent }
  'terminal:data': { payload: TerminalDataEvent }
  'terminal:exit': { payload: TerminalExitEvent }
  'terminal:session-start': { payload: TerminalSessionStartEvent }
  'terminal:user-prompt': { payload: TerminalUserPromptEvent }
}

export type IpcInvokeChannel = keyof IpcInvokeDefinitions
export type IpcSendChannel = keyof IpcSendDefinitions
export type IpcEventChannel = keyof IpcEventDefinitions
