import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedRepository, PersistedThread } from '../../../shared/app-types'
import { runGit, tryGit } from '../../backends/git-client'
import { createNativeBackend } from '../../backends/repository-backend'
import { createThreadCheckoutMoveService } from './thread-checkout-move-service'

const tempRoots: string[] = []

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'taskmaster-checkout-move-'))
  tempRoots.push(root)
  const path = join(root, 'repo')
  mkdirSync(path)
  runGit(path, ['init', '--initial-branch=main'])
  runGit(path, ['config', 'user.name', 'Test'])
  runGit(path, ['config', 'user.email', 'test@example.com'])
  runGit(path, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(path, 'README.md'), 'one\n')
  runGit(path, ['add', 'README.md'])
  runGit(path, ['commit', '-m', 'init'])
  return path
}

function createThread(id: string, overrides: Partial<PersistedThread> = {}): PersistedThread {
  return {
    id,
    repositoryId: 'repo-1',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: 'Fix the login bug',
    mode: 'active-branch',
    branchName: 'main',
    worktreePath: null,
    resumeSessionId: 'session-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function setup(
  path: string,
  threads: PersistedThread[],
  working: string[] = []
): {
  service: ReturnType<typeof createThreadCheckoutMoveService>
  repository: PersistedRepository
  saves: () => number
} {
  const repository: PersistedRepository = {
    id: 'repo-1',
    name: 'Repo',
    path,
    backend: createNativeBackend(),
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    tasks: []
  }
  const state = { repositories: [repository], threads }
  let saves = 0
  const service = createThreadCheckoutMoveService({
    ensureState: () => state,
    saveState: () => void saves++,
    isCommitting: () => false,
    isWorking: (threadId) => working.includes(threadId),
    isRunCommandRunning: () => false,
    generateBranchName: async () => 'login-fix'
  })
  return { service, repository, saves: () => saves }
}

const branchOf = (path: string): string => runGit(path, ['rev-parse', '--abbrev-ref', 'HEAD'])

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('thread checkout move service', { timeout: 30_000 }, () => {
  it('moves to a new worktree, carrying tracked and untracked changes', async () => {
    const path = createRepository()
    writeFileSync(join(path, 'README.md'), 'two\n')
    runGit(path, ['add', 'README.md'])
    writeFileSync(join(path, 'new.txt'), 'new\n')
    const thread = createThread('t1')
    const other = createThread('t2')
    const { service, saves } = setup(path, [thread, other])

    const result = await service.moveThreadCheckout({ threadId: 't1', kind: 'worktree' })

    expect(result).toMatchObject({ ok: true, branchName: 'login-fix', carriedChanges: true })
    if (!result.ok) return
    expect(thread).toMatchObject({
      mode: 'worktree',
      branchName: 'login-fix',
      worktreePath: result.cwd,
      ownsBranch: true,
      ownsWorktree: true,
      resumeSessionId: 'session-1'
    })
    expect(saves()).toBe(1)
    expect(readFileSync(join(result.cwd, 'README.md'), 'utf8')).toBe('two\n')
    expect(readFileSync(join(result.cwd, 'new.txt'), 'utf8')).toBe('new\n')
    expect(runGit(result.cwd, ['diff', '--cached', '--name-only'])).toBe('README.md')
    // The project's checkout stays on main, clean, with no stash left behind.
    expect(branchOf(path)).toBe('main')
    expect(runGit(path, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
    expect(tryGit(path, ['rev-parse', '-q', '--verify', 'refs/stash']).ok).toBe(false)
    expect(other.branchName).toBe('main')
  })

  it('restores the changes when the worktree setup fails', async () => {
    const path = createRepository()
    writeFileSync(join(path, 'README.md'), 'two\n')
    writeFileSync(join(path, 'new.txt'), 'new\n')
    const thread = createThread('t1')
    const { service, repository } = setup(path, [thread])
    repository.newWorktreeSetupCommand = 'exit 3'

    const result = await service.moveThreadCheckout({ threadId: 't1', kind: 'worktree' })

    expect(result.ok).toBe(false)
    expect(thread).toMatchObject({ mode: 'active-branch', branchName: 'main' })
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('two\n')
    expect(existsSync(join(path, 'new.txt'))).toBe(true)
    expect(tryGit(path, ['rev-parse', '--verify', 'refs/heads/login-fix']).ok).toBe(false)
    expect(tryGit(path, ['rev-parse', '-q', '--verify', 'refs/stash']).ok).toBe(false)
  })

  it('switches the checkout to a new branch, keeping the changes', async () => {
    const path = createRepository()
    writeFileSync(join(path, 'README.md'), 'two\n')
    const thread = createThread('t1')
    const { service } = setup(path, [thread, createThread('t2', { settledAt: 'x' })])

    const result = await service.moveThreadCheckout({
      threadId: 't1',
      kind: 'branch',
      branchName: 'feature/x'
    })

    expect(result).toMatchObject({ ok: true, outcome: 'created', cwd: path })
    expect(thread).toMatchObject({ mode: 'new-branch', branchName: 'feature/x', ownsBranch: true })
    expect(branchOf(path)).toBe('feature/x')
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('two\n')
  })

  it('refuses to switch the branch under other active threads', async () => {
    const path = createRepository()
    const thread = createThread('t1')
    const { service } = setup(path, [thread, createThread('t2')])

    const result = await service.moveThreadCheckout({ threadId: 't1', kind: 'branch' })

    expect(result).toMatchObject({ ok: false })
    expect(branchOf(path)).toBe('main')
    expect(thread.branchName).toBe('main')
  })

  it('adopts a branch the checkout already switched to', async () => {
    const path = createRepository()
    runGit(path, ['switch', '-c', 'agent-branch'])
    const thread = createThread('t1')
    const { service } = setup(path, [thread, createThread('t2')])

    const result = await service.moveThreadCheckout({ threadId: 't1', kind: 'branch' })

    expect(result).toMatchObject({ ok: true, outcome: 'adopted', branchName: 'agent-branch' })
    expect(thread).toMatchObject({ mode: 'active-branch', branchName: 'agent-branch' })
  })

  it('only moves threads on the primary branch', async () => {
    const path = createRepository()
    runGit(path, ['switch', '-c', 'feature/y'])
    const thread = createThread('t1', { mode: 'new-branch', branchName: 'feature/y' })
    const { service } = setup(path, [thread])

    const result = await service.moveThreadCheckout({ threadId: 't1', kind: 'worktree' })

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('primary branch') })
  })

  it('refuses to carry changes while another thread is working in the checkout', async () => {
    const path = createRepository()
    writeFileSync(join(path, 'README.md'), 'two\n')
    const thread = createThread('t1')
    const { service } = setup(path, [thread, createThread('t2')], ['t2'])

    const result = await service.moveThreadCheckout({ threadId: 't1', kind: 'worktree' })

    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('two\n')
    expect(tryGit(path, ['rev-parse', '--verify', 'refs/heads/login-fix']).ok).toBe(false)
  })
})
