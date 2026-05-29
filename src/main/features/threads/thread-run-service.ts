import { spawn, spawnSync, type ChildProcess } from 'child_process'
import type { MutationResult, PersistedThread } from '../../../shared/app-types'
import { buildScriptCommand } from '../../terminal/command-utils'
import {
  backendPathExists,
  pathForDisplay,
  spawnBackendCommand
} from '../../backends/repository-backend'
import { normalizeRunCommand } from '../repositories/repository-values'
import { applyThreadBranchTokens } from './thread-worktree-utils'
import type { ThreadGitContext } from './thread-git-context'

const RUN_OUTPUT_LIMIT = 24_000

type ThreadRunSession = {
  threadId: string
  child: ChildProcess
  cwd: string
  command: string
  threadLabel: string
  output: string
  stopping: boolean
}

function appendThreadRunOutput(session: ThreadRunSession, chunk: string | Buffer): void {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  if (!text) {
    return
  }

  session.output = `${session.output}${text}`.slice(-RUN_OUTPUT_LIMIT)
}

function formatThreadRunFailureDetail(
  session: Pick<ThreadRunSession, 'command' | 'cwd' | 'output'>,
  fallbackMessage: string | null = null
): string {
  const sections = [`Command:\n${session.command}`, `Working directory:\n${session.cwd}`]
  const output = session.output.trim()
  if (output) {
    sections.push(`Output:\n${output}`)
  } else if (fallbackMessage) {
    sections.push(`Details:\n${fallbackMessage}`)
  }
  return sections.join('\n\n')
}

function killChildProcessTree(child: Pick<ChildProcess, 'pid'>, waitForExit = true): void {
  if (!child.pid) {
    return
  }

  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t', '/f']
    if (waitForExit) {
      spawnSync('taskkill', args, {
        windowsHide: true,
        stdio: 'ignore'
      })
      return
    }

    const taskkill = spawn('taskkill', args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    taskkill.unref()
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
    return
  } catch {
    // Fall through to direct child kill.
  }

  try {
    process.kill(child.pid, 'SIGTERM')
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

export function createThreadRunService(dependencies: {
  findThread: (threadId: string) => PersistedThread | undefined
  resolveThreadGitContext: (threadId: string) => ThreadGitContext
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  broadcastThreadRunState: (threadId: string) => void
  showThreadRunFailure: (title: string, message: string, detail: string) => Promise<void>
}): {
  getRunningThreadIds: () => Set<string>
  startThreadRun: (threadId: string) => MutationResult
  stopThreadRun: (threadId: string) => MutationResult
  stopThreadRunSession: (threadId: string) => boolean
  shutdown: () => void
} {
  const threadRunSessions = new Map<string, ThreadRunSession>()
  let appIsQuitting = false

  const stopThreadRunSession = (threadId: string): boolean => {
    const session = threadRunSessions.get(threadId)
    if (!session) {
      return false
    }

    session.stopping = true
    threadRunSessions.delete(threadId)
    dependencies.broadcastThreadRunState(threadId)
    killChildProcessTree(session.child)
    return true
  }

  const finalizeThreadRun = (
    threadId: string,
    result: { exitCode?: number | null; error?: Error | string | null } = {}
  ): void => {
    const session = threadRunSessions.get(threadId)
    if (!session) {
      return
    }

    threadRunSessions.delete(threadId)
    dependencies.broadcastThreadRunState(threadId)

    if (session.stopping || appIsQuitting) {
      return
    }

    if (result.error) {
      const detail = formatThreadRunFailureDetail(
        session,
        result.error instanceof Error ? result.error.message : String(result.error)
      )
      void dependencies.showThreadRunFailure(
        'Run command failed',
        `${session.threadLabel} failed to start.`,
        detail
      )
      return
    }

    if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
      const detail = formatThreadRunFailureDetail(
        session,
        `Process exited with code ${result.exitCode}.`
      )
      void dependencies.showThreadRunFailure(
        'Run command failed',
        `${session.threadLabel} exited with code ${result.exitCode}.`,
        detail
      )
    }
  }

  return {
    getRunningThreadIds: (): Set<string> => new Set(threadRunSessions.keys()),
    startThreadRun: (threadId: string): MutationResult => {
      if (threadRunSessions.has(threadId)) {
        return dependencies.failureResult('Run command already active for this thread.')
      }

      const context = dependencies.resolveThreadGitContext(threadId)
      if (!context.ok) {
        return dependencies.failureResult(context.error)
      }

      const runCommand = normalizeRunCommand(context.repository.runCommand)
      if (!runCommand) {
        return dependencies.failureResult('No run command configured for this project.')
      }

      if (!backendPathExists(context.repository.backend, context.cwd, 'directory')) {
        return dependencies.failureResult(
          `Working directory not found: ${pathForDisplay(context.cwd, context.repository.backend)}`
        )
      }

      const resolvedRunCommand = applyThreadBranchTokens(
        runCommand,
        context.repository,
        context.thread
      )
      const command = buildScriptCommand(resolvedRunCommand, context.repository.backend)

      try {
        const child = spawnBackendCommand(context.repository.backend, command, {
          cwd: context.cwd,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe']
        })

        const session: ThreadRunSession = {
          threadId,
          child,
          cwd: context.cwd,
          command: resolvedRunCommand,
          threadLabel: context.thread.customTitle ?? context.thread.branchName,
          output: '',
          stopping: false
        }

        threadRunSessions.set(threadId, session)
        child.stdout?.on('data', (chunk) => appendThreadRunOutput(session, chunk))
        child.stderr?.on('data', (chunk) => appendThreadRunOutput(session, chunk))
        child.once('error', (error) => finalizeThreadRun(threadId, { error }))
        child.once('exit', (exitCode) => finalizeThreadRun(threadId, { exitCode }))

        dependencies.broadcastThreadRunState(threadId)
        return dependencies.successResult()
      } catch (error) {
        return dependencies.failureResult(error instanceof Error ? error.message : String(error))
      }
    },
    stopThreadRun: (threadId: string): MutationResult => {
      if (!dependencies.findThread(threadId)) {
        return dependencies.failureResult('Thread not found.')
      }

      stopThreadRunSession(threadId)
      return dependencies.successResult()
    },
    stopThreadRunSession,
    shutdown: (): void => {
      appIsQuitting = true
      for (const session of threadRunSessions.values()) {
        session.stopping = true
        killChildProcessTree(session.child, false)
      }
      threadRunSessions.clear()
    }
  }
}
