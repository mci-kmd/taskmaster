import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  MutationResult,
  PersistedRepository,
  PersistedThread
} from '../../../shared/app-types'
import { runGit, tryGit } from '../../backends/git-client'
import { createRepositoryWorktreeService, parseWorktreeList } from './repository-worktree-service'

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function commit(cwd: string, file: string): void {
  writeFileSync(join(cwd, file), file)
  runGit(cwd, ['add', file])
  runGit(cwd, ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', 'commit', '-m', file])
}

function createRepository(): { repo: string; bare: string } {
  const repo = tempDir('taskmaster-worktrees-')
  runGit(repo, ['init', '--initial-branch=main'])
  commit(repo, 'README.md')
  const bare = tempDir('taskmaster-worktrees-bare-')
  runGit(bare, ['init', '--bare'])
  runGit(repo, ['remote', 'add', 'origin', bare])
  runGit(repo, ['push', '-u', 'origin', 'main'])
  return { repo, bare }
}

function addWorktree(repo: string, branchName: string): string {
  const path = join(tempDir('taskmaster-wt-'), branchName)
  runGit(repo, ['worktree', 'add', '-b', branchName, path])
  return path
}

function createService(
  repo: string,
  threads: PersistedThread[] = []
): {
  service: ReturnType<typeof createRepositoryWorktreeService>
  refreshRepositoryGitState: ReturnType<typeof vi.fn>
} {
  const repository = {
    id: 'repo-1',
    name: 'Repo',
    path: repo,
    backend: { kind: 'native' },
    postWorktreeRemoveCommand: null
  } as PersistedRepository
  const refreshRepositoryGitState = vi.fn()
  const service = createRepositoryWorktreeService({
    ensureState: () => ({ threads }),
    findRepository: (id) => (id === repository.id ? repository : undefined),
    successResult: () => ({ ok: true }),
    failureResult: (error) => ({ ok: false, error }),
    refreshRepositoryGitState
  })
  return { service, refreshRepositoryGitState }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('parseWorktreeList', () => {
  it('reads branches, detached heads, locks and prunable entries', () => {
    const entries = parseWorktreeList(
      [
        'worktree /repo',
        'HEAD abc',
        'branch refs/heads/main',
        '',
        'worktree /wt/a',
        'HEAD def',
        'detached',
        'locked reason',
        '',
        'worktree /wt/b',
        'HEAD ghi',
        'branch refs/heads/feature/b',
        'prunable gitdir file points to non-existent location',
        ''
      ].join('\n')
    )
    expect(entries).toEqual([
      { gitPath: '/repo', branchName: 'main', locked: false, prunable: false },
      { gitPath: '/wt/a', branchName: null, locked: true, prunable: false },
      { gitPath: '/wt/b', branchName: 'feature/b', locked: false, prunable: true }
    ])
  })
})

describe('repository worktree service', () => {
  it('reports remote branches, local changes and thread usage', async () => {
    const { repo } = createRepository()
    const pushed = addWorktree(repo, 'pushed')
    runGit(pushed, ['push', 'origin', 'pushed'])
    const dirty = addWorktree(repo, 'dirty')
    writeFileSync(join(dirty, 'new.txt'), 'x')
    const used = addWorktree(repo, 'used')
    const thread = {
      id: 't1',
      repositoryId: 'repo-1',
      customTitle: 'Busy thread',
      latestCopilotTitle: null,
      branchName: 'used',
      worktreePath: used
    } as PersistedThread
    const { service } = createService(repo, [thread])

    const result = await service.listRepositoryWorktrees('repo-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byBranch = new Map(result.worktrees.map((item) => [item.branchName, item]))
    expect(result.worktrees[0]).toMatchObject({ branchName: 'main', isMain: true })
    expect(byBranch.get('main')).toMatchObject({ hasRemoteBranch: true, hasLocalChanges: false })
    expect(byBranch.get('pushed')).toMatchObject({
      isMain: false,
      hasLocalBranch: true,
      hasRemoteBranch: true,
      hasLocalChanges: false
    })
    expect(byBranch.get('dirty')).toMatchObject({ hasRemoteBranch: false, hasLocalChanges: true })
    expect(byBranch.get('used')?.threadTitles).toEqual(['Busy thread'])
  })

  it('cleans up a local, clean worktree and its branch', async () => {
    const { repo } = createRepository()
    const path = addWorktree(repo, 'stale')
    commit(path, 'work.txt')
    const { service, refreshRepositoryGitState } = createService(repo)

    const result = await service.cleanupRepositoryWorktree({ repositoryId: 'repo-1', path })

    expect(result).toEqual({ ok: true })
    expect(existsSync(path)).toBe(false)
    expect(tryGit(repo, ['show-ref', '--verify', '--quiet', 'refs/heads/stale']).ok).toBe(false)
    expect(refreshRepositoryGitState).toHaveBeenCalled()
  })

  it('refuses to clean up worktrees that are pushed, dirty or the main checkout', async () => {
    const { repo } = createRepository()
    const pushed = addWorktree(repo, 'pushed')
    runGit(pushed, ['push', 'origin', 'pushed'])
    const dirty = addWorktree(repo, 'dirty')
    writeFileSync(join(dirty, 'new.txt'), 'x')
    const { service } = createService(repo)

    const cleanup = (path: string): Promise<MutationResult> =>
      service.cleanupRepositoryWorktree({ repositoryId: 'repo-1', path })
    await expect(cleanup(pushed)).resolves.toEqual({
      ok: false,
      error: 'The branch exists on the remote.'
    })
    await expect(cleanup(dirty)).resolves.toEqual({
      ok: false,
      error: 'The worktree has uncommitted changes.'
    })
    await expect(cleanup(repo)).resolves.toMatchObject({ ok: false })
    await expect(cleanup(join(repo, 'nope'))).resolves.toEqual({
      ok: false,
      error: 'Worktree not found. Refresh the list.'
    })
    expect(existsSync(pushed)).toBe(true)
    expect(existsSync(dirty)).toBe(true)
  })

  it('prunes a worktree whose directory was deleted', async () => {
    const { repo } = createRepository()
    const path = addWorktree(repo, 'gone')
    rmSync(path, { recursive: true, force: true })
    const { service } = createService(repo)

    const listed = await service.listRepositoryWorktrees('repo-1')
    expect(listed.ok && listed.worktrees.find((item) => item.branchName === 'gone')).toMatchObject({
      missing: true,
      hasLocalChanges: null
    })

    await expect(
      service.cleanupRepositoryWorktree({ repositoryId: 'repo-1', path })
    ).resolves.toEqual({ ok: true })
    const after = await service.listRepositoryWorktrees('repo-1')
    expect(after.ok && after.worktrees.map((item) => item.branchName)).toEqual(['main'])
  })
})
