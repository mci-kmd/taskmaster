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
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z'
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
  function setup(
    repoPath: string,
    cwd: string,
    platform: NodeJS.Platform = 'win32'
  ): {
    service: ReturnType<typeof createThreadWorkspaceService>
    openPath: ReturnType<typeof vi.fn>
  } {
    const openPath = vi.fn().mockResolvedValue('')
    const service = createThreadWorkspaceService({
      resolveThreadGitContext: () => ({
        ok: true,
        cwd,
        repository: createRepository(repoPath),
        thread: createThread()
      }),
      openPath,
      openExternal: vi.fn(),
      platform
    })
    return { service, openPath }
  }

  it("opens the solution file in the thread's worktree", async () => {
    const repoPath = createTempRepo()
    writeRepoFile(repoPath, 'Taskmaster.slnx')
    const worktree = join(repoPath, '.worktrees', 'feature-thread')
    const solutionPath = writeRepoFile(worktree, 'Taskmaster.slnx')
    const { service, openPath } = setup(repoPath, worktree)

    expect(await service.openThreadSolutionInVisualStudio('thread-1')).toEqual({ ok: true })
    expect(openPath).toHaveBeenCalledWith(solutionPath)
  })

  it('reports a solution file missing from the worktree', async () => {
    const repoPath = createTempRepo()
    writeRepoFile(repoPath, 'Taskmaster.slnx')
    const { service, openPath } = setup(repoPath, join(repoPath, '.worktrees', 'feature-thread'))

    expect(await service.openThreadSolutionInVisualStudio('thread-1')).toEqual({
      ok: false,
      error: "Configured solution file was not found in this thread's worktree: Taskmaster.slnx."
    })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('only opens solutions on Windows', async () => {
    const repoPath = createTempRepo()
    const { service } = setup(repoPath, repoPath, 'linux')

    expect(await service.openThreadSolutionInVisualStudio('thread-1')).toEqual({
      ok: false,
      error: 'Opening a solution in Visual Studio is only supported on Windows.'
    })
  })
})
