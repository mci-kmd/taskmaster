import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import {
  app,
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import * as pty from 'node-pty'
import type { TerminalCreateRequest, TerminalStatus } from '../shared/app-types'

type TerminalSession = {
  id: string
  cwd: string
  ownerId: number
  ptyProcess: pty.IPty
  threadId?: string
}

type CopilotCommand = {
  file: string
  args: string[]
  displayCommand: string
}

type TerminalHooks = {
  onThreadStart?: (threadId: string) => void
  onThreadActivity?: (threadId: string) => void
  onThreadStop?: (threadId: string) => void
}

const sessions = new Map<string, TerminalSession>()
const ownerCleanupHooks = new Set<number>()
const threadActivityTimestamps = new Map<string, number>()
let terminalHooks: TerminalHooks = {}

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

function buildCopilotCommand(commandPath: string, args: string[] = []): CopilotCommand {
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

      sessions.delete(session.id)
      session.ptyProcess.kill()
    }
  })
}

function finalizeSession(session: TerminalSession, exitCode: number): void {
  if (!sessions.delete(session.id)) {
    return
  }

  if (session.threadId) {
    threadActivityTimestamps.delete(session.threadId)
    terminalHooks.onThreadStop?.(session.threadId)
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

function notifyThreadActivity(threadId?: string): void {
  if (!threadId) {
    return
  }

  const now = Date.now()
  const lastNotifiedAt = threadActivityTimestamps.get(threadId) ?? 0
  if (now - lastNotifiedAt < 15_000) {
    return
  }

  threadActivityTimestamps.set(threadId, now)
  terminalHooks.onThreadActivity?.(threadId)
}

function createSession(
  event: IpcMainInvokeEvent,
  request: TerminalCreateRequest
):
  | { ok: true; terminalId: string; cwd: string; launchedCommand: string }
  | { ok: false; error: string } {
  const status = getCopilotStatus()
  if (!status.available || !status.commandPath) {
    return { ok: false, error: status.message }
  }

  attachOwnerCleanup(event.sender)

  const cwd = normalizeCwd(request.cwd)
  const command = buildCopilotCommand(status.commandPath, request.args)
  const terminalId = randomUUID()

  const ptyProcess = pty.spawn(command.file, command.args, {
    name: 'xterm-256color',
    cols: Math.max(request.cols, 40),
    rows: Math.max(request.rows, 12),
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color'
    },
    useConpty: true
  })

  const session: TerminalSession = {
    id: terminalId,
    cwd,
    ownerId: event.sender.id,
    ptyProcess,
    threadId: request.threadId
  }

  sessions.set(terminalId, session)
  if (request.threadId) {
    terminalHooks.onThreadStart?.(request.threadId)
  }

  ptyProcess.onData((data) => {
    if (event.sender.isDestroyed()) {
      return
    }

    notifyThreadActivity(session.threadId)
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
      .map((session) => session.threadId)
      .filter((threadId): threadId is string => Boolean(threadId))
  )
}

export function killSessionsForThread(threadId: string): void {
  for (const session of sessions.values()) {
    if (session.threadId !== threadId) {
      continue
    }

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

    notifyThreadActivity(session.threadId)
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
      session.ptyProcess.kill()
    }

    sessions.clear()
  })
}
