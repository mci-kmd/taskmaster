import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistedRepository, PersistedThread } from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { createThreadWorkspaceService } from './thread-workspace-service'

const tempDirs: string[] = []

function createTempRepo(): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskmaster-thread-workspace-'))
  tempDirs.push(directory)
  return directory
}

function writeRepoFile(repoPath: string, relativePath: string): string {
  const fullPath = join(repoPath, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, '')
  return fullPath
}

function createThread(): PersistedThread {
  return {
    id: 'thread-1',
    repositoryId: 'repo-1',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'worktree',
    branchName: 'feature/thread',
    worktreePath: 'C:\\repo\\.worktrees\\feature-thread',
    sessionName: 'session-1',
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    hasLaunched: false
  }
}

function createRepository(repoPath: string): PersistedRepository {
  return {
    id: 'repo-1',
    name: 'Repo',
    path: repoPath,
    backend: createNativeBackend(),
    faviconPath: null,
    runCommand: null,
    solutionFilePath: 'Taskmaster.slnx',
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    tasks: []
  }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('thread workspace service', () => {
  it('opens the configured repo-root solution file', async () => {
    const repoPath = createTempRepo()
    const solutionPath = writeRepoFile(repoPath, 'Taskmaster.slnx')
    const openPath = vi.fn().mockResolvedValue('')
    const service = createThreadWorkspaceService({
      resolveThreadGitContext: () => ({
        ok: true,
        cwd: join(repoPath, '.worktrees', 'feature-thread'),
        repository: createRepository(repoPath),
        thread: createThread()
      }),
      openPath,
      openExternal: vi.fn(),
      getHomePath: () => repoPath
    })

    const result = await service.openThreadSolutionInVisualStudio('thread-1')

    if (process.platform !== 'win32') {
      expect(result).toEqual({
        ok: false,
        error: 'Opening a solution in Visual Studio is only supported on Windows.'
      })
      return
    }

    expect(result).toEqual({ ok: true })
    expect(openPath).toHaveBeenCalledWith(solutionPath)
  })

  it('rejects WSL repositories for Visual Studio launch', async () => {
    const repoPath = createTempRepo()
    const openPath = vi.fn().mockResolvedValue('')
    const service = createThreadWorkspaceService({
      resolveThreadGitContext: () => ({
        ok: true,
        cwd: '\\\\wsl$\\Ubuntu\\repo',
        repository: {
          ...createRepository(repoPath),
          backend: {
            kind: 'wsl',
            distro: 'Ubuntu',
            windowsPath: '\\\\wsl$\\Ubuntu\\repo',
            linuxPath: '/repo'
          }
        },
        thread: createThread()
      }),
      openPath,
      openExternal: vi.fn(),
      getHomePath: () => repoPath
    })

    const result = await service.openThreadSolutionInVisualStudio('thread-1')

    if (process.platform !== 'win32') {
      expect(result).toEqual({
        ok: false,
        error: 'Opening a solution in Visual Studio is only supported on Windows.'
      })
      return
    }

    expect(result).toEqual({
      ok: false,
      error: 'Opening a solution in Visual Studio is not supported for WSL repositories.'
    })
    expect(openPath).not.toHaveBeenCalled()
  })
})
