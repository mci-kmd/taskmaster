import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import type {
  OpenThreadSolutionInVisualStudioResult,
  OpenThreadWorkingDirectoryResult,
  OpenThreadWorkspaceInVscodeResult
} from '../../../shared/app-types'
import { quoteCmdArgument, resolveCommandOnPath } from '../../terminal/command-utils'
import { backendPathExists, toUiPath } from '../../backends/repository-backend'
import {
  normalizeRepositorySolutionFilePath,
  resolveRepositorySolutionFilePath
} from '../repositories/repository-solution-file-service'
import type { ThreadGitContext } from './thread-git-context'

function buildVscodeWorkspaceUri(cwd: string): string {
  const fileUrl = pathToFileURL(cwd)
  return fileUrl.host
    ? `vscode://file//${fileUrl.host}${fileUrl.pathname}`
    : `vscode://file${fileUrl.pathname}`
}

function buildVscodeLaunchCommand(
  commandPath: string,
  cwd: string
): { file: string; args: string[] } {
  const vscodeArgs = ['-n', cwd]

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)) {
    const command = [quoteCmdArgument(commandPath), ...vscodeArgs.map(quoteCmdArgument)].join(' ')
    return {
      file: process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', command]
    }
  }

  return { file: commandPath, args: vscodeArgs }
}

function spawnDetachedProcess(
  command: { file: string; args: string[] },
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'ignore'
    })

    const handleError = (error: Error): void => reject(error)
    const handleSpawn = (): void => {
      child.off('error', handleError)
      child.unref()
      resolve()
    }

    child.once('error', handleError)
    child.once('spawn', handleSpawn)
  })
}

export function createThreadWorkspaceService(dependencies: {
  resolveThreadGitContext: (threadId: string) => ThreadGitContext
  openPath: (path: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  getHomePath: () => string
}): {
  openThreadWorkingDirectory: (threadId: string) => Promise<OpenThreadWorkingDirectoryResult>
  openThreadWorkspaceInVscode: (threadId: string) => Promise<OpenThreadWorkspaceInVscodeResult>
  openThreadSolutionInVisualStudio: (
    threadId: string
  ) => Promise<OpenThreadSolutionInVisualStudioResult>
} {
  const openThreadWorkingDirectory = async (
    threadId: string
  ): Promise<OpenThreadWorkingDirectoryResult> => {
    const context = dependencies.resolveThreadGitContext(threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const cwd = toUiPath(context.repository.backend, context.cwd)
    if (!backendPathExists(context.repository.backend, context.cwd, 'directory')) {
      return { ok: false, error: `Working directory not found: ${cwd}` }
    }

    const error = await dependencies.openPath(cwd)
    return error ? { ok: false, error: `Failed to open working directory: ${error}` } : { ok: true }
  }

  const openThreadWorkspaceInVscode = async (
    threadId: string
  ): Promise<OpenThreadWorkspaceInVscodeResult> => {
    const context = dependencies.resolveThreadGitContext(threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const cwd = toUiPath(context.repository.backend, context.cwd)
    if (!backendPathExists(context.repository.backend, context.cwd, 'directory')) {
      return { ok: false, error: `Working directory not found: ${cwd}` }
    }

    try {
      if (context.repository.backend.kind === 'wsl') {
        try {
          await dependencies.openExternal(buildVscodeWorkspaceUri(cwd))
          return { ok: true }
        } catch {
          // Fall back to the VS Code CLI below.
        }

        const codePath = resolveCommandOnPath('code')
        if (!codePath) {
          return { ok: false, error: 'VS Code is unavailable: code CLI was not found on PATH.' }
        }

        await spawnDetachedProcess(
          buildVscodeLaunchCommand(codePath, cwd),
          dependencies.getHomePath()
        )
        return { ok: true }
      }

      await dependencies.openExternal(buildVscodeWorkspaceUri(cwd))
      return { ok: true }
    } catch (uriError) {
      const codePath = resolveCommandOnPath('code')
      if (codePath) {
        try {
          await spawnDetachedProcess(buildVscodeLaunchCommand(codePath, cwd), cwd)
          return { ok: true }
        } catch (cliError) {
          return {
            ok: false,
            error: `Failed to open workspace in VS Code: ${cliError instanceof Error ? cliError.message : String(cliError)}`
          }
        }
      }

      return {
        ok: false,
        error:
          uriError instanceof Error
            ? `VS Code is unavailable: ${uriError.message}`
            : `VS Code is unavailable: ${String(uriError)}`
      }
    }
  }

  const openThreadSolutionInVisualStudio = async (
    threadId: string
  ): Promise<OpenThreadSolutionInVisualStudioResult> => {
    const context = dependencies.resolveThreadGitContext(threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    if (process.platform !== 'win32') {
      return {
        ok: false,
        error: 'Opening a solution in Visual Studio is only supported on Windows.'
      }
    }

    if (context.repository.backend.kind === 'wsl') {
      return {
        ok: false,
        error: 'Opening a solution in Visual Studio is not supported for WSL repositories.'
      }
    }

    const configuredPath = normalizeRepositorySolutionFilePath(context.repository.solutionFilePath)
    if (!configuredPath) {
      return { ok: false, error: 'No solution file is configured for this project.' }
    }

    const solutionPath = resolveRepositorySolutionFilePath(context.repository.path, configuredPath)
    if (!solutionPath) {
      return {
        ok: false,
        error: `Configured solution file was not found: ${configuredPath}. Update it in Edit project.`
      }
    }

    const error = await dependencies.openPath(solutionPath)
    return error
      ? { ok: false, error: `Failed to open solution in Visual Studio: ${error}` }
      : { ok: true }
  }

  return {
    openThreadWorkingDirectory,
    openThreadWorkspaceInVscode,
    openThreadSolutionInVisualStudio
  }
}
