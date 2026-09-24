import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
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
import type { RepositoryBackend, TerminalCreateRequest } from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { createNativeBackend, normalizeRepositoryBackend } from '../backends/repository-backend'
import { buildShellCommand } from './command-utils'
import { handleIpc, onIpc, sendIpc } from '../ipc/typed-ipc'
import { runGit, tryGit } from '../backends/git-client'
import type { TerminalSession } from './types'

const sessions = new Map<string, TerminalSession>()
const ownerCleanupHooks = new Set<number>()

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
  if (request.kind && request.kind !== 'shell') {
    return { ok: false, error: 'Only shell terminals are supported.' }
  }

  const backend = normalizeRepositoryBackend(request.backend)
  if (event.sender.isDestroyed()) return { ok: false, error: 'The terminal window was closed.' }

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
  const ptyCommand = buildShellCommand(backend)

  const ptyProcess = pty.spawn(ptyCommand.file, ptyCommand.args, {
    name: 'xterm-256color',
    cols: Math.max(request.cols, 40),
    rows: Math.max(request.rows, 12),
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    useConpty: process.platform === 'win32'
  })

  const session: TerminalSession = {
    id: terminalId,
    ownerId: event.sender.id,
    ptyProcess,
    threadId: request.threadId
  }

  sessions.set(terminalId, session)

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

export function registerTerminalIpc(): void {
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

  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return
    for (const session of sessions.values()) {
      disposeSession(session, false)
    }

    sessions.clear()
  })
}
