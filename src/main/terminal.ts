import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { dirname, isAbsolute, join, resolve } from 'path'
import {
  app,
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import * as pty from 'node-pty'
import type {
  TerminalCreateRequest,
  TerminalKind,
  TerminalSessionStartEvent,
  TerminalStatus,
  TerminalUserPromptEvent
} from '../shared/app-types'

type TerminalSession = {
  id: string
  cwd: string
  ownerId: number
  ptyProcess: pty.IPty
  kind: TerminalKind
  threadId?: string
  launchConfirmationTimer: NodeJS.Timeout | null
  hookPollTimer: NodeJS.Timeout | null
  sessionStartReader: HookFileReaderState | null
  userPromptReader: HookFileReaderState | null
}

type TerminalCommand = {
  file: string
  args: string[]
  displayCommand: string
}

type TerminalHooks = {
  onThreadStart?: (threadId: string) => void
}

type HookFileReaderState = {
  filePath: string
  offset: number
  remainder: string
}

type HookSessionStartPayload = Omit<TerminalSessionStartEvent, 'terminalId'> & {
  cwd: string
  timestamp: number
  initialPrompt?: string
}

type HookUserPromptPayload = Omit<TerminalUserPromptEvent, 'terminalId'> & {
  cwd: string
  timestamp: number
}

const sessions = new Map<string, TerminalSession>()
const ownerCleanupHooks = new Set<number>()
let terminalHooks: TerminalHooks = {}
const LAUNCH_CONFIRMATION_MS = 1_500
const HOOK_POLL_MS = 250
const TASKMASTER_HOOKS_FILENAME = 'taskmaster-session-hooks.json'
const TASKMASTER_HOOK_EVENTS_DIRNAME = 'taskmaster-hook-events'
const TASKMASTER_HOOK_RELATIVE_PATH = join('.github', 'hooks', TASKMASTER_HOOKS_FILENAME)
const TASKMASTER_HOOK_EXCLUDE_ENTRY = '.github/hooks/taskmaster-session-hooks.json'
const TASKMASTER_SESSION_START_FILE_ENV = 'TASKMASTER_COPILOT_SESSION_START_FILE'
const TASKMASTER_USER_PROMPT_FILE_ENV = 'TASKMASTER_COPILOT_USER_PROMPT_FILE'
const TASKMASTER_SESSION_START_HOOK_COMMAND =
  '$file=$env:TASKMASTER_COPILOT_SESSION_START_FILE; if (![string]::IsNullOrWhiteSpace($file)) { $payload=[Console]::In.ReadToEnd(); if (-not [string]::IsNullOrWhiteSpace($payload)) { Add-Content -LiteralPath $file -Value $payload } }'
const TASKMASTER_USER_PROMPT_HOOK_COMMAND =
  '$file=$env:TASKMASTER_COPILOT_USER_PROMPT_FILE; if (![string]::IsNullOrWhiteSpace($file)) { $payload=[Console]::In.ReadToEnd(); if (-not [string]::IsNullOrWhiteSpace($payload)) { Add-Content -LiteralPath $file -Value $payload } }'

function getDefaultCwd(): string {
  return app.isPackaged ? app.getPath('home') : process.cwd()
}

function normalizeCwd(cwd?: string): string {
  if (!cwd) {
    return getDefaultCwd()
  }

  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return getDefaultCwd()
  }

  return cwd
}

function getTaskmasterHookEventsDir(): string {
  return join(app.getPath('userData'), TASKMASTER_HOOK_EVENTS_DIRNAME)
}

function resolveGitPath(cwd: string, gitPath: string): string {
  const resolvedPath = runGit(cwd, ['rev-parse', '--git-path', gitPath])
  return isAbsolute(resolvedPath) ? resolvedPath : resolve(cwd, resolvedPath)
}

function ensureTaskmasterHookIgnored(cwd: string): void {
  const excludePath = resolveGitPath(cwd, 'info/exclude')
  mkdirSync(dirname(excludePath), { recursive: true })

  const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  const lines = current.split(/\r?\n/u).map((line) => line.trim())
  if (lines.includes(TASKMASTER_HOOK_EXCLUDE_ENTRY)) {
    return
  }

  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  writeFileSync(excludePath, `${current}${prefix}${TASKMASTER_HOOK_EXCLUDE_ENTRY}\n`)
}

function ensureTaskmasterHookConfig(cwd: string): void {
  const hookPath = join(cwd, TASKMASTER_HOOK_RELATIVE_PATH)
  mkdirSync(dirname(hookPath), { recursive: true })

  const hookConfig = {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: 'command',
          powershell: TASKMASTER_SESSION_START_HOOK_COMMAND,
          timeoutSec: 5
        }
      ],
      userPromptSubmitted: [
        {
          type: 'command',
          powershell: TASKMASTER_USER_PROMPT_HOOK_COMMAND,
          timeoutSec: 5
        }
      ]
    }
  }

  writeFileSync(hookPath, `${JSON.stringify(hookConfig, null, 2)}\n`)
  ensureTaskmasterHookIgnored(cwd)
}

function createHookFileReader(filePath: string): HookFileReaderState {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '')
  return {
    filePath,
    offset: 0,
    remainder: ''
  }
}

function readHookFile<T>(reader: HookFileReaderState, onPayload: (payload: T) => void): void {
  if (!existsSync(reader.filePath)) {
    return
  }

  const buffer = readFileSync(reader.filePath)
  if (buffer.length < reader.offset) {
    reader.offset = 0
    reader.remainder = ''
  }
  if (buffer.length === reader.offset) {
    return
  }

  const chunk = buffer.subarray(reader.offset).toString('utf8')
  reader.offset = buffer.length

  const text = reader.remainder + chunk
  const lines = text.split(/\r?\n/u)
  reader.remainder = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      onPayload(JSON.parse(trimmed) as T)
    } catch {
      // Ignore malformed hook lines.
    }
  }
}

function emitSessionStart(session: TerminalSession, payload: HookSessionStartPayload): void {
  const ownerContents = webContents.fromId(session.ownerId)
  if (!ownerContents || ownerContents.isDestroyed()) {
    return
  }

  ownerContents.send('terminal:session-start', {
    terminalId: session.id,
    sessionId: payload.sessionId,
    source: payload.source
  } satisfies TerminalSessionStartEvent)
}

function emitUserPrompt(session: TerminalSession, payload: HookUserPromptPayload): void {
  const ownerContents = webContents.fromId(session.ownerId)
  if (!ownerContents || ownerContents.isDestroyed()) {
    return
  }

  ownerContents.send('terminal:user-prompt', {
    terminalId: session.id,
    sessionId: payload.sessionId,
    prompt: payload.prompt
  } satisfies TerminalUserPromptEvent)
}

function startHookPolling(session: TerminalSession): void {
  if (!session.sessionStartReader && !session.userPromptReader) {
    return
  }

  session.hookPollTimer = setInterval(() => {
    if (session.sessionStartReader) {
      readHookFile<HookSessionStartPayload>(session.sessionStartReader, (payload) =>
        emitSessionStart(session, payload)
      )
    }
    if (session.userPromptReader) {
      readHookFile<HookUserPromptPayload>(session.userPromptReader, (payload) =>
        emitUserPrompt(session, payload)
      )
    }
  }, HOOK_POLL_MS)
}

function stopHookPolling(session: TerminalSession): void {
  if (session.hookPollTimer) {
    clearInterval(session.hookPollTimer)
    session.hookPollTimer = null
  }

  for (const reader of [session.sessionStartReader, session.userPromptReader]) {
    if (!reader) {
      continue
    }
    try {
      rmSync(reader.filePath, { force: true })
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function resolveCopilotPath(): string | null {
  const result = spawnSync('where.exe', ['copilot'], {
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    return null
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  )
}

function resolveCommandOnPath(commandName: string): string | null {
  const result = spawnSync('where.exe', [commandName], {
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    return null
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  )
}

function getCopilotStatus(): TerminalStatus {
  const commandPath = resolveCopilotPath()
  const defaultCwd = getDefaultCwd()

  if (!commandPath) {
    return {
      available: false,
      defaultCwd,
      message: 'Copilot CLI was not found on PATH. Install it and run `copilot login` first.'
    }
  }

  return {
    available: true,
    commandPath,
    defaultCwd,
    message:
      'Copilot CLI found. If interactive startup fails, run `copilot login` in a shell first.'
  }
}

function quoteCmdArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function buildCopilotCommand(commandPath: string, args: string[] = []): TerminalCommand {
  const displayCommand = ['copilot', ...args].join(' ').trim()

  if (/\.(cmd|bat)$/i.test(commandPath)) {
    const command = [quoteCmdArgument(commandPath), ...args.map(quoteCmdArgument)].join(' ')
    return {
      file: process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', command],
      displayCommand
    }
  }

  return {
    file: commandPath,
    args,
    displayCommand
  }
}

function buildShellCommand(): TerminalCommand {
  const pwshPath = resolveCommandOnPath('pwsh')
  if (pwshPath) {
    return {
      file: pwshPath,
      args: ['-NoLogo'],
      displayCommand: 'pwsh -NoLogo'
    }
  }

  const powershellPath = resolveCommandOnPath('powershell')
  if (powershellPath) {
    return {
      file: powershellPath,
      args: ['-NoLogo'],
      displayCommand: 'powershell -NoLogo'
    }
  }

  const cmdPath = process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe'
  return {
    file: cmdPath,
    args: [],
    displayCommand: 'cmd'
  }
}

export function buildScriptCommand(script: string): {
  file: string
  args: string[]
  displayCommand: string
} {
  const shellCommand = buildShellCommand()
  const shellPath = shellCommand.file.toLowerCase()
  if (shellPath.endsWith('pwsh.exe') || shellPath.endsWith('powershell.exe')) {
    return {
      file: shellCommand.file,
      args: [...shellCommand.args, '-NoProfile', '-NonInteractive', '-Command', script],
      displayCommand: `${shellCommand.displayCommand} -Command <script>`
    }
  }

  return {
    file: shellCommand.file,
    args: ['/d', '/s', '/c', script],
    displayCommand: `${shellCommand.displayCommand} /d /s /c <script>`
  }
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`
    throw new Error(message)
  }

  return result.stdout.trim()
}

function tryGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  }
}

function getCurrentBranchLabel(repoPath: string): string {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branchResult.ok) {
    return 'Unavailable'
  }

  if (branchResult.stdout === 'HEAD') {
    const headResult = tryGit(repoPath, ['rev-parse', '--short', 'HEAD'])
    return headResult.ok ? `HEAD (${headResult.stdout})` : 'HEAD'
  }

  return branchResult.stdout
}

function hasUncommittedChanges(repoPath: string): boolean {
  const result = tryGit(repoPath, ['status', '--porcelain', '--untracked-files=no'])
  return result.ok && result.stdout.length > 0
}

function ensureThreadBranch(
  cwd: string,
  request: TerminalCreateRequest
): { ok: true } | { ok: false; error: string } {
  if (!request.threadId || !request.branchName || request.threadMode === 'worktree') {
    return { ok: true }
  }

  const currentBranch = getCurrentBranchLabel(cwd)
  if (currentBranch === request.branchName) {
    return { ok: true }
  }

  if (hasUncommittedChanges(cwd)) {
    return {
      ok: false,
      error: `Thread targets "${request.branchName}" but the repo is still on "${currentBranch}" with uncommitted changes. Make sure the working branch is clean before starting this thread.`
    }
  }

  try {
    runGit(cwd, ['checkout', request.branchName])
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : `Failed to switch from "${currentBranch}" to "${request.branchName}".`
    }
  }

  return { ok: true }
}

function clearLaunchConfirmation(session: TerminalSession): void {
  if (!session.launchConfirmationTimer) {
    return
  }

  clearTimeout(session.launchConfirmationTimer)
  session.launchConfirmationTimer = null
}

function attachOwnerCleanup(ownerContents: WebContents): void {
  if (ownerCleanupHooks.has(ownerContents.id)) {
    return
  }

  ownerCleanupHooks.add(ownerContents.id)
  ownerContents.once('destroyed', () => {
    ownerCleanupHooks.delete(ownerContents.id)

    for (const session of sessions.values()) {
      if (session.ownerId !== ownerContents.id) {
        continue
      }

      clearLaunchConfirmation(session)
      stopHookPolling(session)
      sessions.delete(session.id)
      session.ptyProcess.kill()
    }
  })
}

function finalizeSession(session: TerminalSession, exitCode: number): void {
  clearLaunchConfirmation(session)
  stopHookPolling(session)

  if (!sessions.delete(session.id)) {
    return
  }

  const ownerContents = webContents.fromId(session.ownerId)
  if (!ownerContents || ownerContents.isDestroyed()) {
    return
  }

  ownerContents.send('terminal:exit', {
    terminalId: session.id,
    exitCode
  })
}

function getOwnedSession(
  event: IpcMainInvokeEvent | IpcMainEvent,
  terminalId: string
): TerminalSession | null {
  const session = sessions.get(terminalId)
  if (!session || session.ownerId !== event.sender.id) {
    return null
  }

  return session
}

function createSession(
  event: IpcMainInvokeEvent,
  request: TerminalCreateRequest
):
  | { ok: true; terminalId: string; cwd: string; launchedCommand: string }
  | { ok: false; error: string } {
  const kind = request.kind ?? 'copilot'
  const status = kind === 'copilot' ? getCopilotStatus() : null
  if (kind === 'copilot' && (!status?.available || !status.commandPath)) {
    return { ok: false, error: status?.message ?? 'Copilot CLI unavailable.' }
  }

  attachOwnerCleanup(event.sender)

  const cwd = normalizeCwd(request.cwd)
  const branchCheck = ensureThreadBranch(cwd, request)
  if (!branchCheck.ok) {
    return branchCheck
  }
  const command =
    kind === 'copilot' && status?.commandPath
      ? buildCopilotCommand(status.commandPath, request.args)
      : buildShellCommand()
  const terminalId = randomUUID()
  if (kind === 'copilot') {
    ensureTaskmasterHookConfig(cwd)
  }
  const hookEventsDir = kind === 'copilot' ? getTaskmasterHookEventsDir() : null
  const sessionStartReader =
    kind === 'copilot' && request.threadId && hookEventsDir
      ? createHookFileReader(join(hookEventsDir, `${terminalId}-session-start.jsonl`))
      : null
  const userPromptReader =
    kind === 'copilot' && request.threadId && hookEventsDir
      ? createHookFileReader(join(hookEventsDir, `${terminalId}-user-prompt.jsonl`))
      : null

  const ptyProcess = pty.spawn(command.file, command.args, {
    name: 'xterm-256color',
    cols: Math.max(request.cols, 40),
    rows: Math.max(request.rows, 12),
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      ...(sessionStartReader
        ? {
            [TASKMASTER_SESSION_START_FILE_ENV]: sessionStartReader.filePath
          }
        : {}),
      ...(userPromptReader
        ? {
            [TASKMASTER_USER_PROMPT_FILE_ENV]: userPromptReader.filePath
          }
        : {})
    },
    useConpty: true
  })

  const session: TerminalSession = {
    id: terminalId,
    cwd,
    ownerId: event.sender.id,
    ptyProcess,
    kind,
    threadId: request.threadId,
    launchConfirmationTimer: null,
    hookPollTimer: null,
    sessionStartReader,
    userPromptReader
  }

  sessions.set(terminalId, session)
  startHookPolling(session)
  if (kind === 'copilot' && request.threadId) {
    session.launchConfirmationTimer = setTimeout(() => {
      if (!sessions.has(session.id) || !session.threadId) {
        return
      }

      session.launchConfirmationTimer = null
      terminalHooks.onThreadStart?.(session.threadId)
    }, LAUNCH_CONFIRMATION_MS)
  }

  ptyProcess.onData((data) => {
    if (event.sender.isDestroyed()) {
      return
    }

    event.sender.send('terminal:data', {
      terminalId,
      data
    })
  })

  ptyProcess.onExit(({ exitCode }) => {
    finalizeSession(session, exitCode)
  })

  return {
    ok: true,
    terminalId,
    cwd,
    launchedCommand: command.displayCommand
  }
}

export function getRunningThreadIds(): Set<string> {
  return new Set(
    [...sessions.values()]
      .filter((session) => session.kind === 'copilot')
      .map((session) => session.threadId)
      .filter((threadId): threadId is string => Boolean(threadId))
  )
}

export function killSessionsForThread(threadId: string): void {
  for (const session of sessions.values()) {
    if (session.threadId !== threadId) {
      continue
    }

    clearLaunchConfirmation(session)
    sessions.delete(session.id)
    session.ptyProcess.kill()
  }
}

export function registerTerminalIpc(hooks: TerminalHooks = {}): void {
  terminalHooks = hooks

  ipcMain.handle('terminal:status', () => getCopilotStatus())

  ipcMain.handle('terminal:create', (event, request: TerminalCreateRequest) => {
    return createSession(event, request)
  })

  ipcMain.handle('terminal:kill', (event, terminalId: string) => {
    const session = getOwnedSession(event, terminalId)
    if (!session) {
      return false
    }

    session.ptyProcess.kill()
    return true
  })

  ipcMain.on('terminal:input', (event, payload: { terminalId: string; data: string }) => {
    const session = getOwnedSession(event, payload.terminalId)
    if (!session) {
      return
    }

    session.ptyProcess.write(payload.data)
  })

  ipcMain.on(
    'terminal:resize',
    (event, payload: { terminalId: string; cols: number; rows: number }) => {
      const session = getOwnedSession(event, payload.terminalId)
      if (!session) {
        return
      }

      session.ptyProcess.resize(Math.max(payload.cols, 40), Math.max(payload.rows, 12))
    }
  )

  app.on('before-quit', () => {
    for (const session of sessions.values()) {
      clearLaunchConfirmation(session)
      session.ptyProcess.kill()
    }

    sessions.clear()
  })
}
