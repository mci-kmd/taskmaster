import type {
  AppSnapshot,
  BranchStatusRequest,
  BranchStatusSnapshot,
  CopilotCancelQueuedInput,
  CopilotInteractionResponse,
  CopilotMcpAuthInput,
  ModelPerformanceSample,
  ModelPerformanceSampleEvent,
  CopilotPickAttachmentsResult,
  CopilotSdkStatus,
  CopilotSdkStatusEvent,
  CopilotSendInput,
  CopilotSkillsResult,
  CopilotSessionEvent,
  CopilotSessionSnapshot,
  CopilotSetModelInput,
  CopilotStartResult,
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  CreateThreadInput,
  MutationResult,
  OpenThreadWorkingDirectoryResult,
  OpenThreadSolutionInVisualStudioResult,
  OpenThreadWorkspaceInVscodeResult,
  PickRepositoryFaviconResult,
  PickRepositorySolutionFileResult,
  ReorderRepositoryTasksInput,
  ThreadDiffFileContentRequest,
  ThreadDiffFileContentResult,
  ThreadDiffFileSaveRequest,
  ThreadDiffFileSaveResult,
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
  TerminalLaunchResult,
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
    reorderRepositoryTasks: 'app-state:reorder-repository-tasks',
    startThreadRun: 'app-state:start-thread-run',
    stopThreadRun: 'app-state:stop-thread-run',
    updateThread: 'app-state:update-thread',
    pickRepositoryFavicon: 'app-state:pick-repository-favicon',
    pickRepositorySolutionFile: 'app-state:pick-repository-solution-file',
    createThread: 'app-state:create-thread',
    convertThreadToWorktree: 'app-state:convert-thread-to-worktree',
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
    create: 'terminal:create',
    kill: 'terminal:kill',
    readClipboardText: 'terminal:read-clipboard-text',
    input: 'terminal:input',
    resize: 'terminal:resize',
    data: 'terminal:data',
    exit: 'terminal:exit'
  },
  copilot: {
    getSdkStatus: 'copilot:get-sdk-status',
    checkForSdkUpdate: 'copilot:check-for-sdk-update',
    updateSdk: 'copilot:update-sdk',
    start: 'copilot:start',
    getSession: 'copilot:get-session',
    getPerformanceSamples: 'copilot:get-performance-samples',
    performanceSample: 'copilot:performance-sample',
    listSkills: 'copilot:list-skills',
    send: 'copilot:send',
    cancelQueued: 'copilot:cancel-queued',
    abort: 'copilot:abort',
    setModel: 'copilot:set-model',
    respond: 'copilot:respond',
    authenticateMcpServer: 'copilot:authenticate-mcp-server',
    pickAttachments: 'copilot:pick-attachments',
    session: 'copilot:session',
    sdkStatus: 'copilot:sdk-status'
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
  'app-state:reorder-repository-tasks': {
    request: [ReorderRepositoryTasksInput]
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
  'app-state:convert-thread-to-worktree': { request: [string]; response: MutationResult }
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
  'terminal:create': { request: [TerminalCreateRequest]; response: TerminalLaunchResult }
  'terminal:kill': { request: [string]; response: boolean }
  'terminal:read-clipboard-text': { request: []; response: string }
  'copilot:get-sdk-status': { request: []; response: CopilotSdkStatus }
  'copilot:check-for-sdk-update': { request: []; response: CopilotSdkStatus }
  'copilot:update-sdk': { request: []; response: CopilotSdkStatus }
  'copilot:start': { request: [string]; response: CopilotStartResult }
  'copilot:get-session': { request: [string]; response: CopilotSessionSnapshot | null }
  'copilot:get-performance-samples': { request: []; response: ModelPerformanceSample[] }
  'copilot:list-skills': { request: [string]; response: CopilotSkillsResult }
  'copilot:send': { request: [CopilotSendInput]; response: CopilotStartResult }
  'copilot:cancel-queued': { request: [CopilotCancelQueuedInput]; response: CopilotStartResult }
  'copilot:abort': { request: [string]; response: boolean }
  'copilot:set-model': { request: [CopilotSetModelInput]; response: CopilotStartResult }
  'copilot:respond': { request: [CopilotInteractionResponse]; response: boolean }
  'copilot:authenticate-mcp-server': {
    request: [CopilotMcpAuthInput]
    response: CopilotStartResult
  }
  'copilot:pick-attachments': { request: []; response: CopilotPickAttachmentsResult }
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
  'copilot:session': { payload: CopilotSessionEvent }
  'copilot:performance-sample': { payload: ModelPerformanceSampleEvent }
  'copilot:sdk-status': { payload: CopilotSdkStatusEvent }
}

export type IpcInvokeChannel = keyof IpcInvokeDefinitions
export type IpcSendChannel = keyof IpcSendDefinitions
export type IpcEventChannel = keyof IpcEventDefinitions
