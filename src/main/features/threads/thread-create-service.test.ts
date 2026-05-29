import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationResult, PersistedAppState } from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { runGit } from '../../backends/git-client'
import {
  checkoutExistingBranch,
  getCurrentBranchLabel,
  getCurrentBranchName,
  hasUncommittedChanges,
  listRepositoryWorktrees,
  resolveExistingBranchTarget
} from '../repositories/repository-git'
import {
  createWorktree,
  resolveBaseRef,
  runNewWorktreeSetupCommand,
  removeWorktree
} from './thread-worktree-utils'
import { createThreadCreateService } from './thread-create-service'

vi.mock('../../backends/git-client', () => ({
  runGit: vi.fn()
}))

vi.mock('../repositories/repository-git', () => ({
  checkoutExistingBranch: vi.fn(),
  getCurrentBranchLabel: vi.fn(),
  getCurrentBranchName: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  listRepositoryWorktrees: vi.fn(),
  resolveExistingBranchTarget: vi.fn()
}))

vi.mock('./thread-worktree-utils', () => ({
  createWorktree: vi.fn(),
  resolveBaseRef: vi.fn(),
  runNewWorktreeSetupCommand: vi.fn(),
  removeWorktree: vi.fn()
}))

function createState(): PersistedAppState {
  return {
    version: 13,
    settings: {
      agentProviderId: 'copilot',
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
    threads: [],
    ui: {
      selectedRepositoryId: 'repo-1',
      selectedThreadId: null
    }
  }
}

function createHarness(): {
  state: PersistedAppState
  createThread: ReturnType<typeof createThreadCreateService>['createThread']
  saveState: ReturnType<typeof vi.fn>
  updateSelection: ReturnType<typeof vi.fn>
} {
  const state = createState()
  const saveState = vi.fn()
  const updateSelection = vi.fn()
  const service = createThreadCreateService({
    ensureState: () => state,
    updateSelection,
    saveState,
    successResult: () => ({ ok: true }),
    failureResult: (error, cancelled = false): MutationResult => ({ ok: false, error, cancelled }),
    nowIso: () => '2026-01-01T00:00:00.000Z',
    createId: vi
      .fn()
      .mockReturnValueOnce('thread-1')
      .mockReturnValueOnce('session-1')
      .mockReturnValue('id')
  })

  return {
    state,
    createThread: service.createThread,
    saveState,
    updateSelection
  }
}

describe('createThreadCreateService', () => {
  beforeEach(() => {
    vi.mocked(getCurrentBranchLabel).mockReset()
    vi.mocked(getCurrentBranchName).mockReset()
    vi.mocked(hasUncommittedChanges).mockReset()
    vi.mocked(resolveExistingBranchTarget).mockReset()
    vi.mocked(checkoutExistingBranch).mockReset()
    vi.mocked(listRepositoryWorktrees).mockReset()
    vi.mocked(resolveBaseRef).mockReset()
    vi.mocked(createWorktree).mockReset()
    vi.mocked(runNewWorktreeSetupCommand).mockReset()
    vi.mocked(removeWorktree).mockReset()
    vi.mocked(runGit).mockReset()

    vi.mocked(getCurrentBranchLabel).mockReturnValue('main')
    vi.mocked(getCurrentBranchName).mockReturnValue('main')
    vi.mocked(hasUncommittedChanges).mockReturnValue(false)
    vi.mocked(resolveExistingBranchTarget).mockReturnValue({ ok: true, target: null })
    vi.mocked(listRepositoryWorktrees).mockReturnValue([])
    vi.mocked(resolveBaseRef).mockReturnValue({ ok: true, ref: 'main' })
    vi.mocked(createWorktree).mockReturnValue('/repo/.worktrees/feature-thread')
  })

  it('creates a thread on the active branch when branch input is blank', () => {
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'active-branch',
      title: 'Thread'
    })

    expect(result).toEqual({ ok: true })
    expect(harness.state.threads[0]).toMatchObject({
      mode: 'active-branch',
      branchName: 'main',
      customTitle: 'Thread',
      worktreePath: null,
      ownsBranch: false,
      ownsWorktree: false
    })
    expect(harness.saveState).toHaveBeenCalledOnce()
    expect(harness.updateSelection).toHaveBeenCalledWith('repo-1', 'thread-1')
  })

  it('checks out an existing branch instead of creating a new one', () => {
    vi.mocked(resolveExistingBranchTarget).mockReturnValue({
      ok: true,
      target: {
        kind: 'local',
        branchName: 'feature/existing'
      }
    })
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'active-branch',
      branchName: 'feature/existing'
    })

    expect(result).toEqual({ ok: true })
    expect(checkoutExistingBranch).toHaveBeenCalledWith(
      '/repo',
      { kind: 'local', branchName: 'feature/existing' },
      createNativeBackend()
    )
    expect(harness.state.threads[0]).toMatchObject({
      mode: 'active-branch',
      branchName: 'feature/existing',
      ownsBranch: false
    })
    expect(runGit).not.toHaveBeenCalled()
  })

  it('blocks switching to another branch when the current branch is dirty', () => {
    vi.mocked(resolveExistingBranchTarget).mockReturnValue({
      ok: true,
      target: {
        kind: 'local',
        branchName: 'feature/existing'
      }
    })
    vi.mocked(hasUncommittedChanges).mockReturnValue(true)
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'active-branch',
      branchName: 'feature/existing'
    })

    expect(result).toEqual({
      ok: false,
      error:
        'Cannot switch from "main" to "feature/existing" because the current branch has uncommitted changes. Commit or stash them first.',
      cancelled: false
    })
    expect(checkoutExistingBranch).not.toHaveBeenCalled()
    expect(harness.state.threads).toEqual([])
  })

  it('creates a new branch when the typed branch does not exist', () => {
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'active-branch',
      branchName: 'feature/new',
      useCurrentBranch: true
    })

    expect(result).toEqual({ ok: true })
    expect(runGit).toHaveBeenCalledWith(
      '/repo',
      ['checkout', '-b', 'feature/new', 'main'],
      createNativeBackend()
    )
    expect(harness.state.threads[0]).toMatchObject({
      mode: 'new-branch',
      branchName: 'feature/new',
      ownsBranch: true,
      ownsWorktree: false
    })
  })

  it('reuses an existing worktree without running setup', () => {
    vi.mocked(listRepositoryWorktrees).mockReturnValue([
      {
        branchName: 'feature/worktree',
        path: '/repo/.worktrees/feature-worktree'
      }
    ])
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'worktree',
      branchName: 'feature/worktree'
    })

    expect(result).toEqual({ ok: true })
    expect(createWorktree).not.toHaveBeenCalled()
    expect(runNewWorktreeSetupCommand).not.toHaveBeenCalled()
    expect(harness.state.threads[0]).toMatchObject({
      mode: 'worktree',
      branchName: 'feature/worktree',
      worktreePath: '/repo/.worktrees/feature-worktree',
      ownsBranch: false,
      ownsWorktree: false
    })
  })

  it('rejects existing non-worktree branches in worktree mode', () => {
    vi.mocked(resolveExistingBranchTarget).mockReturnValue({
      ok: true,
      target: {
        kind: 'local',
        branchName: 'feature/existing'
      }
    })
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'worktree',
      branchName: 'feature/existing'
    })

    expect(result).toEqual({
      ok: false,
      error:
        'Cannot create a worktree thread for existing branch "feature/existing" because it is not an existing worktree.',
      cancelled: false
    })
    expect(createWorktree).not.toHaveBeenCalled()
    expect(runNewWorktreeSetupCommand).not.toHaveBeenCalled()
    expect(harness.state.threads).toEqual([])
  })

  it('creates and initializes a new worktree when no existing one matches', () => {
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'worktree',
      branchName: 'feature/worktree'
    })

    expect(result).toEqual({ ok: true })
    expect(createWorktree).toHaveBeenCalledWith(
      '/repo',
      'feature/worktree',
      'main',
      createNativeBackend()
    )
    expect(runNewWorktreeSetupCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repo-1' }),
      {
        branchName: 'feature/worktree',
        worktreePath: '/repo/.worktrees/feature-thread'
      }
    )
    expect(harness.state.threads[0]).toMatchObject({
      mode: 'worktree',
      branchName: 'feature/worktree',
      worktreePath: '/repo/.worktrees/feature-thread',
      ownsBranch: true,
      ownsWorktree: true
    })
  })
})
