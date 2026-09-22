import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import {
  app,
  clipboard,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import * as pty from 'node-pty'
import type {
  RepositoryBackend,
  TerminalCreateRequest,
  TerminalSessionStartEvent,
  TerminalUserPromptEvent
} from '../../shared/app-types'
import { COPILOT_LABEL } from '../../shared/copilot'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { createNativeBackend, normalizeRepositoryBackend } from '../backends/repository-backend'
import { buildShellCommand } from './command-utils'
import { handleIpc, onIpc, sendIpc } from '../ipc/typed-ipc'
import { runGit, tryGit } from '../backends/git-client'
import { readHookFile, removeHookEventFiles, TASKMASTER_HOOK_EVENTS_DIRNAME } from './copilot-hooks'
import { createTerminalAgentRuntime } from './agent-runtime'
import type {
  HookSessionStartPayload,
  HookUserPromptPayload,
  TerminalHooks,
  TerminalSession
} from './types'

const sessions = new Map<string, TerminalSession>()
const ownerCleanupHooks = new Set<number>()
let terminalHooks: TerminalHooks = {}
const LAUNCH_CONFIRMATION_MS = 1_500
const HOOK_POLL_MS = 250
const agentRuntime = createTerminalAgentRuntime({
  getDefaultCwd,
  getTaskmasterHookEventsDir
})

function getDefaultCwd(): string {
  return app.isPackaged ? app.getPath('home') : process.cwd()
}

function resolveCwd(cwd?: string): string | null {
  if (!cwd) {
    return getDefaultCwd()
  }

  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return null
  }

  return cwd
}

function getTaskmasterHookEventsDir(): string {
  return join(app.getPath('userData'), TASKMASTER_HOOK_EVENTS_DIRNAME)
}

function emitSessionStart(session: TerminalSession, payload: HookSessionStartPayload): void {
  const ownerContents = webContents.fromId(session.ownerId)
  if (!ownerContents || ownerContents.isDestroyed()) {
    return
  }

  sendIpc(ownerContents, IPC_CHANNELS.terminal.sessionStart, {
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

  sendIpc(ownerContents, IPC_CHANNELS.terminal.userPrompt, {
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

  removeHookEventFiles([session.sessionStartReader, session.userPromptReader])
}

function getCurrentBranchLabel(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
  if (!branchResult.ok) {
    const unbornBranchResult = tryGit(repoPath, ['symbolic-ref', '--short', 'HEAD'], backend)
    const unbornBranchName = unbornBranchResult.stdout.trim()
    return unbornBranchResult.ok && unbornBranchName ? unbornBranchName : 'Unavailable'
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

function killPtyProcess(session: TerminalSession, waitForExit = true): void {
  if (process.platform === 'win32' && !waitForExit && session.ptyProcess.pid) {
    const taskkill = spawn('taskkill', ['/pid', String(session.ptyProcess.pid), '/t', '/f'], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    taskkill.unref()
    return
  }

  session.ptyProcess.kill()
}

function disposeSession(session: TerminalSession, waitForExit = true): void {
  clearLaunchConfirmation(session)
  stopHookPolling(session)
  sessions.delete(session.id)
  killPtyProcess(session, waitForExit)
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

      disposeSession(session, false)
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

  sendIpc(ownerContents, IPC_CHANNELS.terminal.exit, {
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

async function createSession(
  event: IpcMainInvokeEvent,
  request: TerminalCreateRequest
): Promise<
  | { ok: true; terminalId: string; cwd: string; launchedCommand: string }
  | { ok: false; error: string }
> {
  const kind = request.kind ?? 'agent'
  const backend = normalizeRepositoryBackend(request.backend)
  const provider = kind === 'agent' ? agentRuntime.getAgentProvider() : null
  const status = provider ? await agentRuntime.getAgentStatus(provider, backend) : null
  if (event.sender.isDestroyed()) return { ok: false, error: 'The terminal window was closed.' }
  if (provider && (!status?.available || !status.commandPath)) {
    return {
      ok: false,
      error: status?.message ?? `${COPILOT_LABEL} CLI unavailable.`
    }
  }

  attachOwnerCleanup(event.sender)

  const requestedCwd = request.executionCwd ?? request.cwd
  const cwd = resolveCwd(requestedCwd)
  if (!cwd) {
    return { ok: false, error: `Working directory not found: ${requestedCwd}` }
  }
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
          userPromptReader: null
        }

  const ptyCommand = launchPreparation.command

  const ptyProcess = pty.spawn(ptyCommand.file, ptyCommand.args, {
    name: 'xterm-256color',
    cols: Math.max(request.cols, 40),
    rows: Math.max(request.rows, 12),
    cwd,
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
    threadId: request.threadId,
    launchConfirmationTimer: null,
    hookPollTimer: null,
    sessionStartReader: launchPreparation.sessionStartReader,
    userPromptReader: launchPreparation.userPromptReader
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

    sendIpc(event.sender, IPC_CHANNELS.terminal.data, {
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

export function getRunningThreadIds(): Set<string> {
  return new Set(
    [...sessions.values()]
      .filter((session) => session.kind === 'agent')
      .map((session) => session.threadId)
      .filter((threadId): threadId is string => Boolean(threadId))
  )
}

export function hasSessionsForThread(threadId: string): boolean {
  return [...sessions.values()].some((session) => session.threadId === threadId)
}

export function killSessionsForThread(threadId: string): void {
  for (const session of sessions.values()) {
    if (session.threadId !== threadId) {
      continue
    }

    disposeSession(session)
  }
}

export function registerTerminalIpc(hooks: TerminalHooks = {}): void {
  terminalHooks = hooks

  handleIpc(IPC_CHANNELS.terminal.status, (_event, backend?: RepositoryBackend) => {
    return agentRuntime.getAgentStatus(
      agentRuntime.getAgentProvider(),
      normalizeRepositoryBackend(backend)
    )
  })

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

  handleIpc(IPC_CHANNELS.terminal.hasClipboardImage, async () => {
    const items = await clipboard.read()
    return items.some((item) => item.types.some((type) => type.startsWith('image/')))
  })

  handleIpc(IPC_CHANNELS.terminal.readClipboardText, () => clipboard.readText())

  onIpc(IPC_CHANNELS.terminal.input, (event, payload: { terminalId: string; data: string }) => {
    const session = getOwnedSession(event, payload.terminalId)
    if (!session) {
      return
    }

    session.ptyProcess.write(payload.data)
  })

  onIpc(
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
      disposeSession(session, false)
    }

    sessions.clear()
  })
}
