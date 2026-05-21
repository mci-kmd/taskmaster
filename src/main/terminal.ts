import { randomUUID } from 'crypto'
import {
  accessSync,
  mkdirSync,
  constants as fsConstants,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { spawnSync } from 'child_process'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path'
import {
  app,
  clipboard,
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import * as pty from 'node-pty'
import type {
  AgentProviderId,
  RepositoryBackend,
  TerminalCreateRequest,
  TerminalKind,
  TerminalClipboardImageResult,
  TerminalSessionStartEvent,
  TerminalStatus,
  TerminalUserPromptEvent
} from '../shared/app-types'
import { getAgentProviderDescriptor } from '../shared/agent-providers'
import { IPC_CHANNELS } from '../shared/contracts/ipc'
import {
  buildBackendCommand,
  buildNativeCommand,
  createNativeBackend,
  normalizeRepositoryBackend,
  spawnSyncBackendCommand,
  toUiPath
} from './backends/repository-backend'
import { handleIpc } from './ipc/typed-ipc'
import { runGit, tryGit } from './backends/git-client'
import { getLlmCliProviderSpec } from './providers/cli-provider-specs'
import {
  createCliAgentProviders,
  type AgentLaunchContext,
  type AgentProvider,
  type CodexSessionReaderState,
  type HookFileReaderState
} from './providers/cli-agent-providers'

type TerminalSession = {
  id: string
  cwd: string
  ownerId: number
  ptyProcess: pty.IPty
  kind: TerminalKind
  backend: RepositoryBackend
  agentProviderId?: AgentProviderId
  threadId?: string
  launchConfirmationTimer: NodeJS.Timeout | null
  hookPollTimer: NodeJS.Timeout | null
  sessionStartReader: HookFileReaderState | null
  userPromptReader: HookFileReaderState | null
  codexSessionReader: CodexSessionReaderState | null
}

type TerminalCommand = {
  file: string
  args: string[]
  displayCommand: string
}

type TerminalHooks = {
  onThreadStart?: (threadId: string) => void
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

type CodexSessionMetaPayload = {
  id?: unknown
  cwd?: unknown
}

type CodexTranscriptEntry = {
  type?: unknown
  payload?: unknown
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

function getCodexSessionsDir(): string {
  return join(process.env.CODEX_HOME || join(app.getPath('home'), '.codex'), 'sessions')
}

function parseCodexTranscriptEntry(line: string): CodexTranscriptEntry | null {
  try {
    return JSON.parse(line) as CodexTranscriptEntry
  } catch {
    return null
  }
}

function getCodexSessionMeta(
  filePath: string
): (CodexSessionMetaPayload & { filePath: string }) | null {
  try {
    const firstLine = readFileSync(filePath, 'utf8').split(/\r?\n/u)[0]?.trim()
    if (!firstLine) {
      return null
    }

    const entry = parseCodexTranscriptEntry(firstLine)
    if (!entry || entry.type !== 'session_meta' || typeof entry.payload !== 'object') {
      return null
    }

    return {
      ...(entry.payload as CodexSessionMetaPayload),
      filePath
    }
  } catch {
    return null
  }
}

function listCodexSessionFiles(dir = getCodexSessionsDir()): string[] {
  if (!existsSync(dir)) {
    return []
  }

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(dir, entry)
    let stats
    try {
      stats = statSync(entryPath)
    } catch {
      continue
    }

    if (stats.isDirectory()) {
      files.push(...listCodexSessionFiles(entryPath))
    } else if (stats.isFile() && entryPath.endsWith('.jsonl')) {
      files.push(entryPath)
    }
  }

  return files
}

function findCodexSessionFile(reader: CodexSessionReaderState): string | null {
  const candidates = listCodexSessionFiles()
    .map((filePath) => {
      const meta = getCodexSessionMeta(filePath)
      if (!meta || typeof meta.id !== 'string' || typeof meta.cwd !== 'string') {
        return null
      }
      if (meta.cwd !== reader.cwd) {
        return null
      }
      if (reader.resumeSessionId && meta.id !== reader.resumeSessionId) {
        return null
      }

      let stats
      try {
        stats = statSync(filePath)
      } catch {
        return null
      }
      const isRecentEnough =
        reader.resumeSessionId !== null || stats.mtimeMs >= reader.launchStartedAt - 2_000
      return isRecentEnough ? { filePath, id: meta.id, mtimeMs: stats.mtimeMs } : null
    })
    .filter(
      (candidate): candidate is { filePath: string; id: string; mtimeMs: number } =>
        candidate !== null
    )
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  const match = candidates[0]
  if (!match) {
    return null
  }

  reader.sessionId = match.id
  return match.filePath
}

function getCodexUserPrompt(entry: CodexTranscriptEntry): string | null {
  if (typeof entry.payload !== 'object' || entry.payload === null) {
    return null
  }

  const payload = entry.payload as {
    type?: unknown
    message?: unknown
  }

  if (entry.type === 'event_msg' && payload.type === 'user_message') {
    return typeof payload.message === 'string' ? payload.message : null
  }

  return null
}

function readCodexSessionFile(reader: CodexSessionReaderState, session: TerminalSession): void {
  if (!reader.filePath) {
    reader.filePath = findCodexSessionFile(reader)
    if (!reader.filePath || !reader.sessionId) {
      return
    }

    let stats
    try {
      stats = statSync(reader.filePath)
    } catch {
      reader.filePath = null
      return
    }
    reader.offset = reader.mode === 'resume' ? stats.size : 0
  }

  if (!reader.emittedSessionStart && reader.sessionId) {
    reader.emittedSessionStart = true
    emitSessionStart(session, {
      providerId: 'codex',
      cwd: reader.cwd,
      sessionId: reader.sessionId,
      source: reader.mode,
      timestamp: Date.now()
    })
  }

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
    if (!trimmed || !reader.sessionId) {
      continue
    }

    const entry = parseCodexTranscriptEntry(trimmed)
    if (!entry) {
      continue
    }

    const prompt = getCodexUserPrompt(entry)
    if (!prompt) {
      continue
    }

    emitUserPrompt(session, {
      providerId: 'codex',
      cwd: reader.cwd,
      sessionId: reader.sessionId,
      prompt,
      timestamp: Date.now()
    })
  }
}

function emitSessionStart(session: TerminalSession, payload: HookSessionStartPayload): void {
  const ownerContents = webContents.fromId(session.ownerId)
  if (!ownerContents || ownerContents.isDestroyed()) {
    return
  }

  ownerContents.send(IPC_CHANNELS.terminal.sessionStart, {
    terminalId: session.id,
    providerId: session.agentProviderId,
    sessionId: payload.sessionId,
    source: payload.source
  } satisfies TerminalSessionStartEvent)
}

function emitUserPrompt(session: TerminalSession, payload: HookUserPromptPayload): void {
  const ownerContents = webContents.fromId(session.ownerId)
  if (!ownerContents || ownerContents.isDestroyed()) {
    return
  }

  ownerContents.send(IPC_CHANNELS.terminal.userPrompt, {
    terminalId: session.id,
    providerId: session.agentProviderId,
    sessionId: payload.sessionId,
    prompt: payload.prompt
  } satisfies TerminalUserPromptEvent)
}

function startHookPolling(session: TerminalSession): void {
  if (!session.sessionStartReader && !session.userPromptReader && !session.codexSessionReader) {
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
    if (session.codexSessionReader) {
      readCodexSessionFile(session.codexSessionReader, session)
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

export function resolveCommandOnPath(commandName: string): string | null {
  if (commandName.includes('/') || commandName.includes('\\')) {
    return isExecutableFile(commandName) ? commandName : null
  }

  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', [commandName], {
      encoding: 'utf8',
      windowsHide: true
    })

    if (result.status !== 0) {
      return null
    }

    const matches = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (matches.length === 0) {
      return null
    }

    const executableMatch = matches.find((match) => /\.(exe|cmd|bat|com)$/i.test(match))
    return executableMatch ?? matches[0] ?? null
  }

  const fallbackPathEntries =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

  for (const pathEntry of [
    ...new Set([...(process.env.PATH ?? '').split(delimiter), ...fallbackPathEntries])
  ]) {
    if (!pathEntry) {
      continue
    }

    const candidate = join(pathEntry, commandName)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }

  return null
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false
    }
    if (process.platform === 'win32') {
      return true
    }
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function getAgentStatus(provider: AgentProvider, backend?: RepositoryBackend): TerminalStatus {
  return provider.getStatus(backend)
}

function getAgentProvider(providerId?: AgentProviderId): AgentProvider {
  return agentProviders[getLlmCliProviderSpec(providerId).id]
}

function resolveCommandOnWslPath(commandName: string, backend: RepositoryBackend): string | null {
  if (backend.kind !== 'wsl') {
    return null
  }

  const result = spawnSyncBackendCommand(
    backend,
    buildNativeCommand('/bin/bash', [
      '-c',
      `type -P -a -- ${shellQuote(commandName)} | grep -v '^/mnt/' | head -n 1`
    ])
  )
  return result.ok && result.stdout ? result.stdout.split(/\r?\n/)[0] : null
}

function resolveProviderCommand(commandName: string, backend?: RepositoryBackend): string | null {
  const normalizedBackend = normalizeRepositoryBackend(backend)
  return normalizedBackend.kind === 'wsl'
    ? resolveCommandOnWslPath(commandName, normalizedBackend)
    : resolveCommandOnPath(commandName)
}

function createAgentStatus(
  providerId: AgentProviderId,
  commandPath: string | null,
  backend: RepositoryBackend,
  messages: {
    unavailable: string
    available: string
  }
): TerminalStatus {
  const descriptor = getAgentProviderDescriptor(providerId)
  const defaultCwd = getDefaultCwd()

  if (!commandPath) {
    return {
      available: false,
      providerId,
      label: descriptor.label,
      defaultCwd,
      message:
        backend.kind === 'wsl'
          ? `${messages.unavailable} Checked inside WSL distro "${backend.distro}".`
          : messages.unavailable
    }
  }

  return {
    available: true,
    providerId,
    label: descriptor.label,
    commandPath,
    defaultCwd,
    message:
      backend.kind === 'wsl'
        ? `${messages.available} Resolved inside WSL distro "${backend.distro}".`
        : messages.available
  }
}

export function quoteCmdArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function buildCommand(
  commandPath: string,
  displayName: string,
  args: string[] = []
): TerminalCommand {
  const displayCommand = [displayName, ...args].join(' ').trim()

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)) {
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

function createCodexSessionReader(context: AgentLaunchContext): CodexSessionReaderState | null {
  return context.backend.kind === 'native' && context.threadId && context.launch
    ? {
        cwd: context.cwd,
        launchStartedAt: Date.now(),
        mode: context.launch.mode,
        resumeSessionId: context.launch.resumeSessionId,
        sessionId: null,
        filePath: null,
        offset: 0,
        remainder: '',
        emittedSessionStart: false
      }
    : null
}

const agentProviders = createCliAgentProviders({
  createStatus: (providerId, backend, spec) =>
    createAgentStatus(
      providerId,
      resolveProviderCommand(spec.cliName, backend),
      backend,
      spec.statusMessages
    ),
  buildCommand,
  ensureTaskmasterHookConfig,
  getTaskmasterHookEventsDir,
  createHookFileReader,
  createCodexSessionReader,
  hookFiles: {
    sessionStartEnvName: TASKMASTER_SESSION_START_FILE_ENV,
    userPromptEnvName: TASKMASTER_USER_PROMPT_FILE_ENV
  }
})

function buildShellCommand(backend: RepositoryBackend = createNativeBackend()): TerminalCommand {
  if (backend.kind === 'wsl') {
    return {
      file: '/bin/sh',
      args: [],
      displayCommand: 'sh'
    }
  }

  if (process.platform !== 'win32') {
    const configuredShell = process.env.SHELL
    if (configuredShell && isExecutableFile(configuredShell)) {
      return {
        file: configuredShell,
        args: [],
        displayCommand: basename(configuredShell)
      }
    }

    return {
      file: '/bin/sh',
      args: [],
      displayCommand: 'sh'
    }
  }

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

export function buildScriptCommand(
  script: string,
  backend: RepositoryBackend = createNativeBackend()
): {
  file: string
  args: string[]
  displayCommand: string
} {
  if (backend.kind === 'wsl') {
    return {
      file: '/bin/sh',
      args: ['-lc', script],
      displayCommand: 'sh -lc <script>'
    }
  }

  if (process.platform !== 'win32') {
    const shellPath =
      process.env.SHELL && isExecutableFile(process.env.SHELL) ? process.env.SHELL : '/bin/sh'
    return {
      file: shellPath,
      args: ['-lc', script],
      displayCommand: `${basename(shellPath)} -lc <script>`
    }
  }

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

function getCurrentBranchLabel(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
  if (!branchResult.ok) {
    return 'Unavailable'
  }

  if (branchResult.stdout === 'HEAD') {
    const headResult = tryGit(repoPath, ['rev-parse', '--short', 'HEAD'], backend)
    return headResult.ok ? `HEAD (${headResult.stdout})` : 'HEAD'
  }

  return branchResult.stdout
}

function hasUncommittedChanges(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  const result = tryGit(repoPath, ['status', '--porcelain', '--untracked-files=no'], backend)
  return result.ok && result.stdout.length > 0
}

function ensureThreadBranch(
  cwd: string,
  request: TerminalCreateRequest,
  backend: RepositoryBackend
): { ok: true } | { ok: false; error: string } {
  if (!request.threadId || !request.branchName || request.threadMode === 'worktree') {
    return { ok: true }
  }

  const currentBranch = getCurrentBranchLabel(cwd, backend)
  if (currentBranch === request.branchName) {
    return { ok: true }
  }

  if (hasUncommittedChanges(cwd, backend)) {
    return {
      ok: false,
      error: `Thread targets "${request.branchName}" but the repo is still on "${currentBranch}" with uncommitted changes. Make sure the working branch is clean before starting this thread.`
    }
  }

  try {
    runGit(cwd, ['checkout', request.branchName], backend)
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

  ownerContents.send(IPC_CHANNELS.terminal.exit, {
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
  const kind = request.kind ?? 'agent'
  const backend = normalizeRepositoryBackend(request.backend)
  const provider = kind === 'agent' ? getAgentProvider(request.agentProviderId) : null
  const status = provider ? getAgentStatus(provider, backend) : null
  if (provider && (!status?.available || !status.commandPath)) {
    const descriptor = getAgentProviderDescriptor(provider.id)
    return { ok: false, error: status?.message ?? `${descriptor.label} CLI unavailable.` }
  }

  attachOwnerCleanup(event.sender)

  const cwd =
    backend.kind === 'wsl'
      ? (request.executionCwd ?? request.cwd ?? '/')
      : normalizeCwd(request.cwd)
  const branchCheck = ensureThreadBranch(cwd, request, backend)
  if (!branchCheck.ok) {
    return branchCheck
  }
  const terminalId = randomUUID()
  const launchPreparation =
    provider && status?.commandPath
      ? provider.prepareLaunch(status.commandPath, {
          cwd,
          backend,
          terminalId,
          threadId: request.threadId,
          launch: request.agentLaunch,
          rawArgs: request.args
        })
      : {
          command: buildShellCommand(backend),
          env: {},
          sessionStartReader: null,
          userPromptReader: null,
          codexSessionReader: null
        }

  const ptyCommand =
    backend.kind === 'wsl'
      ? buildBackendCommand(backend, launchPreparation.command, cwd)
      : launchPreparation.command

  const ptyProcess = pty.spawn(ptyCommand.file, ptyCommand.args, {
    name: 'xterm-256color',
    cols: Math.max(request.cols, 40),
    rows: Math.max(request.rows, 12),
    cwd: backend.kind === 'wsl' ? undefined : cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      ...launchPreparation.env
    },
    useConpty: process.platform === 'win32'
  })

  const session: TerminalSession = {
    id: terminalId,
    cwd,
    ownerId: event.sender.id,
    ptyProcess,
    kind,
    backend,
    agentProviderId: provider?.id,
    threadId: request.threadId,
    launchConfirmationTimer: null,
    hookPollTimer: null,
    sessionStartReader: launchPreparation.sessionStartReader,
    userPromptReader: launchPreparation.userPromptReader,
    codexSessionReader: launchPreparation.codexSessionReader
  }

  sessions.set(terminalId, session)
  startHookPolling(session)
  if (provider && request.threadId) {
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

    event.sender.send(IPC_CHANNELS.terminal.data, {
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
    launchedCommand: ptyCommand.displayCommand
  }
}

function saveClipboardImageForSession(
  event: IpcMainInvokeEvent,
  terminalId: string
): TerminalClipboardImageResult {
  const session = getOwnedSession(event, terminalId)
  if (!session) {
    return { ok: false, error: 'Terminal session not found.' }
  }

  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return { ok: false, error: 'No image is currently available on the Windows clipboard.' }
  }

  const filename = `clipboard-${Date.now()}-${randomUUID()}.png`
  const directory =
    session.backend.kind === 'wsl'
      ? '/tmp/taskmaster-clipboard-images'
      : join(app.getPath('temp'), 'taskmaster-clipboard-images')
  const targetPath =
    session.backend.kind === 'wsl' ? `${directory}/${filename}` : join(directory, filename)
  const windowsDirectory =
    session.backend.kind === 'wsl' ? toUiPath(session.backend, directory) : directory
  const windowsPath =
    session.backend.kind === 'wsl' ? toUiPath(session.backend, targetPath) : targetPath

  try {
    mkdirSync(windowsDirectory, { recursive: true })
    writeFileSync(windowsPath, image.toPNG())
    return { ok: true, path: targetPath }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function getRunningThreadIds(): Set<string> {
  return new Set(
    [...sessions.values()]
      .filter((session) => session.kind === 'agent')
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
    stopHookPolling(session)
    sessions.delete(session.id)
    session.ptyProcess.kill()
  }
}

export function registerTerminalIpc(hooks: TerminalHooks = {}): void {
  terminalHooks = hooks

  handleIpc(
    IPC_CHANNELS.terminal.status,
    (_event, providerId?: AgentProviderId, backend?: RepositoryBackend) => {
      return getAgentStatus(getAgentProvider(providerId), normalizeRepositoryBackend(backend))
    }
  )

  handleIpc(IPC_CHANNELS.terminal.create, (event, request: TerminalCreateRequest) => {
    return createSession(event, request)
  })

  handleIpc(IPC_CHANNELS.terminal.kill, (event, terminalId: string) => {
    const session = getOwnedSession(event, terminalId)
    if (!session) {
      return false
    }

    session.ptyProcess.kill()
    return true
  })

  handleIpc(IPC_CHANNELS.terminal.saveClipboardImage, (event, terminalId: string) => {
    return saveClipboardImageForSession(event, terminalId)
  })

  ipcMain.on(
    IPC_CHANNELS.terminal.input,
    (event, payload: { terminalId: string; data: string }) => {
      const session = getOwnedSession(event, payload.terminalId)
      if (!session) {
        return
      }

      session.ptyProcess.write(payload.data)
    }
  )

  ipcMain.on(
    IPC_CHANNELS.terminal.resize,
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
      stopHookPolling(session)
      session.ptyProcess.kill()
    }

    sessions.clear()
  })
}
