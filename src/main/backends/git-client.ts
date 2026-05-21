import type { RepositoryBackend } from '../../shared/app-types'
import {
  buildNativeCommand,
  createNativeBackend,
  spawnBackendCommand,
  spawnSyncBackendCommand
} from './repository-backend'

export type GitCommandResult = {
  ok: boolean
  stdout: string
  stderr: string
}

export function runGit(
  cwd: string,
  args: string[],
  backend: RepositoryBackend = createNativeBackend()
): string {
  const result = spawnSyncBackendCommand(
    backend,
    buildNativeCommand('git', ['-C', cwd, ...args], `git ${args.join(' ')}`),
    { cwd }
  )

  if (!result.ok) {
    const message = result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`
    throw new Error(message)
  }

  return result.stdout.trim()
}

export function tryGit(
  cwd: string,
  args: string[],
  backend: RepositoryBackend = createNativeBackend()
): GitCommandResult {
  const result = spawnSyncBackendCommand(
    backend,
    buildNativeCommand('git', ['-C', cwd, ...args], `git ${args.join(' ')}`),
    { cwd }
  )

  return {
    ok: result.ok,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  }
}

export function tryGitAsync(
  cwd: string,
  args: string[],
  backend: RepositoryBackend = createNativeBackend()
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawnBackendCommand(backend, buildNativeCommand('git', ['-C', cwd, ...args]), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: GitCommandResult): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      finish({
        ok: false,
        stdout,
        stderr: error.message
      })
    })

    child.on('close', (code) => {
      finish({
        ok: code === 0,
        stdout,
        stderr: stderr.trim()
      })
    })
  })
}
