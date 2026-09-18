import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationResult, PersistedAppState, PersistedThread } from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import {
  branchExists,
  getCurrentBranchName,
  listRepositoryWorktrees
} from '../repositories/repository-git'
import {
  cleanupFailedWorktree,
  createWorktreeForExistingBranch,
  runNewWorktreeSetupCommand,
  WorktreeCreationError
} from './thread-worktree-utils'
import { createThreadConvertService } from './thread-convert-service'

vi.mock('../repositories/repository-git', () => ({
  branchExists: vi.fn(),
  getCurrentBranchName: vi.fn(),
  listRepositoryWorktrees: vi.fn()
}))

vi.mock('./thread-worktree-utils', () => ({
  cleanupFailedWorktree: vi.fn(),
  createWorktreeForExistingBranch: vi.fn(),
  runNewWorktreeSetupCommand: vi.fn(),
  WorktreeCreationError: class WorktreeCreationError extends Error {
    readonly worktreePath: string
    readonly ownsBranch: boolean

    constructor(message: string, worktreePath: string, ownsBranch: boolean) {
      super(message)
      this.worktreePath = worktreePath
      this.ownsBranch = ownsBranch
    }
  }
}))

function createThread(overrides: Partial<PersistedThread> = {}): PersistedThread {
  return {
    id: 'thread-1',
    repositoryId: 'repo-1',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'new-branch',
    branchName: 'feature/thread',
    worktreePath: null,
    ownsBranch: true,
    ownsWorktree: false,
    sessionName: 'repo-feature-thread',
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    hasLaunched: false,
    ...overrides
  }
}

function createState(thread: PersistedThread = createThread()): PersistedAppState {
  return {
    version: 15,
    settings: {
      globalFlagsInput: '',
      terminalFontFamilyInput: '',
      taskTagsInput: ''
    },
    repositories: [
      {
        id: 'repo-1',
        name: 'Repo',
        path: '/repo',
        backend: createNativeBackend(),
        faviconPath: null,
        runCommand: null,
        solutionFilePath: null,
        newWorktreeSetupCommand: null,
        postWorktreeRemoveCommand: null,
        addedAt: '2026-01-01T00:00:00.000Z',
        tasks: []
      }
    ],
    threads: [thread],
    ui: {
      selectedRepositoryId: 'repo-1',
      selectedThreadId: thread.id
    }
  }
}

function createHarness(state: PersistedAppState = createState()): {
  convertThreadToWorktree: (threadId: string) => MutationResult
  saveState: ReturnType<typeof vi.fn>
  hasRunningProcesses: ReturnType<typeof vi.fn>
  refreshRepositoryGitState: ReturnType<typeof vi.fn>
} {
  const saveState = vi.fn()
  const hasRunningProcesses = vi.fn().mockReturnValue(false)
  const refreshRepositoryGitState = vi.fn()
  const service = createThreadConvertService({
    ensureState: () => state,
    saveState,
    successResult: () => ({ ok: true }),
    failureResult: (error, cancelled = false) => ({ ok: false, error, cancelled }),
    hasRunningProcesses,
    refreshRepositoryGitState
  })

  return {
    convertThreadToWorktree: service.convertThreadToWorktree,
    saveState,
    hasRunningProcesses,
    refreshRepositoryGitState
  }
}

describe('createThreadConvertService', () => {
  beforeEach(() => {
    vi.mocked(branchExists).mockReset()
    vi.mocked(getCurrentBranchName).mockReset()
    vi.mocked(listRepositoryWorktrees).mockReset()
    vi.mocked(cleanupFailedWorktree).mockReset()
    vi.mocked(createWorktreeForExistingBranch).mockReset()
    vi.mocked(runNewWorktreeSetupCommand).mockReset()

    vi.mocked(branchExists).mockReturnValue(true)
    vi.mocked(getCurrentBranchName).mockReturnValue('main')
    vi.mocked(listRepositoryWorktrees).mockReturnValue([])
    vi.mocked(createWorktreeForExistingBranch).mockReturnValue('/repo.worktrees/feature-thread')
  })

  it('converts an existing branch into an owned worktree', () => {
    const state = createState()
    const harness = createHarness(state)

    const result = harness.convertThreadToWorktree('thread-1')

    expect(result).toEqual({ ok: true })
    expect(createWorktreeForExistingBranch).toHaveBeenCalledWith(
      '/repo',
      'feature/thread',
      createNativeBackend()
    )
    expect(runNewWorktreeSetupCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      {
        branchName: 'feature/thread',
        worktreePath: '/repo.worktrees/feature-thread'
      }
    )
    expect(state.threads[0]).toMatchObject({
      mode: 'worktree',
      branchName: 'feature/thread',
      worktreePath: '/repo.worktrees/feature-thread',
      ownsBranch: true,
      ownsWorktree: true
    })
    expect(harness.saveState).toHaveBeenCalledOnce()
    expect(harness.refreshRepositoryGitState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' })
    )
  })

  it('rejects the currently checked-out branch', () => {
    vi.mocked(getCurrentBranchName).mockReturnValue('feature/thread')
    const state = createState()
    const harness = createHarness(state)

    const result = harness.convertThreadToWorktree('thread-1')

    expect(result).toEqual({
      ok: false,
      error:
        'Convert to work tree only works for threads whose branch is not currently checked out.',
      cancelled: false
    })
    expect(createWorktreeForExistingBranch).not.toHaveBeenCalled()
    expect(state.threads[0].mode).toBe('new-branch')
  })

  it('reports the current-branch restriction before the running-process restriction', () => {
    vi.mocked(getCurrentBranchName).mockReturnValue('feature/thread')
    const harness = createHarness()
    harness.hasRunningProcesses.mockReturnValue(true)

    const result = harness.convertThreadToWorktree('thread-1')

    expect(result).toEqual({
      ok: false,
      error:
        'Convert to work tree only works for threads whose branch is not currently checked out.',
      cancelled: false
    })
  })

  it('rolls back the worktree when setup fails', () => {
    vi.mocked(runNewWorktreeSetupCommand).mockImplementation(() => {
      throw new Error('setup failed')
    })
    const state = createState()
    const harness = createHarness(state)

    const result = harness.convertThreadToWorktree('thread-1')

    expect(result).toEqual({
      ok: false,
      error: 'Thread conversion failed: setup failed',
      cancelled: false
    })
    expect(cleanupFailedWorktree).toHaveBeenCalledWith(
      {
        branchName: 'feature/thread',
        worktreePath: '/repo.worktrees/feature-thread'
      },
      '/repo',
      createNativeBackend(),
      {
        deleteBranch: false,
        ownsWorktreePath: true
      }
    )
    expect(state.threads[0].mode).toBe('new-branch')
    expect(harness.saveState).not.toHaveBeenCalled()
  })

  it('rejects conversion while the thread has running processes', () => {
    const harness = createHarness()
    harness.hasRunningProcesses.mockReturnValue(true)

    const result = harness.convertThreadToWorktree('thread-1')

    expect(result).toEqual({
      ok: false,
      error:
        'Stop the thread before converting it to a work tree. Running processes cannot be moved to the new working directory.',
      cancelled: false
    })
    expect(branchExists).not.toHaveBeenCalled()
  })

  it('cleans the attempted path when worktree creation fails', () => {
    vi.mocked(createWorktreeForExistingBranch).mockImplementation(() => {
      throw new WorktreeCreationError('Filename too long', '/repo.worktrees/feature-thread', false)
    })
    const harness = createHarness()

    const result = harness.convertThreadToWorktree('thread-1')

    expect(result).toEqual({
      ok: false,
      error: 'Thread conversion failed: Filename too long',
      cancelled: false
    })
    expect(cleanupFailedWorktree).toHaveBeenCalledWith(
      {
        branchName: 'feature/thread',
        worktreePath: '/repo.worktrees/feature-thread'
      },
      '/repo',
      createNativeBackend(),
      {
        deleteBranch: false,
        ownsWorktreePath: true
      }
    )
  })
})
