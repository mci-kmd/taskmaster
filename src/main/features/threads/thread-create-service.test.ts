import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationResult, PersistedAppState } from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { runGit } from '../../backends/git-client'
import {
  checkoutExistingBranch,
  getCurrentBranchLabel,
  getCurrentBranchName,
  getPrimaryBranch,
  hasUncommittedChanges,
  listRepositoryWorktrees,
  resolveExistingBranchTarget
} from '../repositories/repository-git'
import {
  cleanupFailedWorktree,
  createWorktree,
  resolveBaseRef,
  runNewWorktreeSetupCommand,
  WorktreeCreationError
} from './thread-worktree-utils'
import { createThreadCreateService } from './thread-create-service'

vi.mock('../../backends/git-client', () => ({
  runGit: vi.fn()
}))

vi.mock('../repositories/repository-git', () => ({
  checkoutExistingBranch: vi.fn(),
  getCurrentBranchLabel: vi.fn(),
  getCurrentBranchName: vi.fn(),
  getPrimaryBranch: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  listRepositoryWorktrees: vi.fn(),
  resolveExistingBranchTarget: vi.fn()
}))

vi.mock('./thread-worktree-utils', () => ({
  cleanupFailedWorktree: vi.fn(),
  createWorktree: vi.fn(),
  resolveBaseRef: vi.fn(),
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

function createState(): PersistedAppState {
  return {
    version: 17,
    settings: {
      yoloEnabled: true,
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

type CreateService = ReturnType<typeof createThreadCreateService>

function createHarness(
  options: { generateBranchName?: (prompt: string) => Promise<string | null> } = {}
): {
  state: PersistedAppState
  createThread: CreateService['createThread']
  finishThreadSetup: CreateService['finishThreadSetup']
  isThreadSettingUp: CreateService['isThreadSettingUp']
  saveState: ReturnType<typeof vi.fn>
  updateSelection: ReturnType<typeof vi.fn>
  onThreadSetUp: ReturnType<typeof vi.fn>
} {
  const state = createState()
  const saveState = vi.fn()
  const updateSelection = vi.fn()
  const onThreadSetUp = vi.fn()
  const generate = options.generateBranchName
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
      .mockReturnValue('id'),
    generateBranchName: generate ? ({ prompt }) => generate(prompt) : undefined,
    onThreadSetUp
  })

  return {
    state,
    createThread: service.createThread,
    finishThreadSetup: service.finishThreadSetup,
    isThreadSettingUp: service.isThreadSettingUp,
    saveState,
    updateSelection,
    onThreadSetUp
  }
}

describe('createThreadCreateService', () => {
  beforeEach(() => {
    vi.mocked(getCurrentBranchLabel).mockReset()
    vi.mocked(getCurrentBranchName).mockReset()
    vi.mocked(getPrimaryBranch).mockReset()
    vi.mocked(hasUncommittedChanges).mockReset()
    vi.mocked(resolveExistingBranchTarget).mockReset()
    vi.mocked(checkoutExistingBranch).mockReset()
    vi.mocked(listRepositoryWorktrees).mockReset()
    vi.mocked(resolveBaseRef).mockReset()
    vi.mocked(createWorktree).mockReset()
    vi.mocked(cleanupFailedWorktree).mockReset()
    vi.mocked(runNewWorktreeSetupCommand).mockReset()
    vi.mocked(runGit).mockReset()

    vi.mocked(getCurrentBranchLabel).mockReturnValue('main')
    vi.mocked(getCurrentBranchName).mockReturnValue('main')
    vi.mocked(getPrimaryBranch).mockReturnValue('main')
    vi.mocked(hasUncommittedChanges).mockReturnValue(false)
    vi.mocked(resolveExistingBranchTarget).mockReturnValue({ ok: true, target: null })
    vi.mocked(listRepositoryWorktrees).mockReturnValue([])
    vi.mocked(resolveBaseRef).mockReturnValue({ ok: true, ref: 'main' })
    vi.mocked(createWorktree).mockReturnValue('/repo/.worktrees/feature-thread')
  })

  it('creates a thread on the shared repository without a view mode', () => {
    const harness = createHarness()
    expect(harness.createThread({ repositoryId: 'repo-1', mode: 'active-branch' }).ok).toBe(true)
    expect(harness.state.repositories).toHaveLength(1)
    expect(harness.state.threads[0]).toMatchObject({ repositoryId: 'repo-1' })
    expect(harness.state.threads[0]).not.toHaveProperty('viewMode')
  })

  it('creates general project threads directly without git', () => {
    const harness = createHarness()
    harness.state.repositories.unshift({
      ...harness.state.repositories[0],
      kind: 'general',
      id: 'general',
      name: 'Computer',
      path: '/home/me'
    })

    const result = harness.createThread({ repositoryId: 'general', mode: 'worktree' })

    expect(result).toEqual({ ok: true })
    expect(harness.state.threads[0]).toMatchObject({
      repositoryId: 'general',
      mode: 'active-branch',
      branchName: '',
      worktreePath: null,
      ownsBranch: false,
      ownsWorktree: false
    })
    expect(harness.updateSelection).toHaveBeenCalledWith('general', 'thread-1')
    expect(getCurrentBranchName).not.toHaveBeenCalled()
    expect(listRepositoryWorktrees).not.toHaveBeenCalled()
    expect(createWorktree).not.toHaveBeenCalled()
    expect(runGit).not.toHaveBeenCalled()
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

  it('creates threads without a CLI interface choice', () => {
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'active-branch'
    })

    expect(result).toEqual({ ok: true })
    expect(harness.state.threads[0]).not.toHaveProperty('agentInterface')
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

  it('cleans a partial worktree when creation fails', () => {
    vi.mocked(createWorktree).mockImplementation(() => {
      throw new WorktreeCreationError(
        'Filename too long',
        '/repo/.worktrees/feature-worktree',
        true
      )
    })
    const harness = createHarness()

    const result = harness.createThread({
      repositoryId: 'repo-1',
      mode: 'worktree',
      branchName: 'feature/worktree'
    })

    expect(result).toEqual({
      ok: false,
      error: 'Worktree creation failed: Filename too long',
      cancelled: false
    })
    expect(cleanupFailedWorktree).toHaveBeenCalledWith(
      {
        branchName: 'feature/worktree',
        worktreePath: '/repo/.worktrees/feature-worktree'
      },
      '/repo',
      createNativeBackend(),
      {
        deleteBranch: true,
        ownsWorktreePath: true
      }
    )
    expect(harness.state.threads).toEqual([])
  })
  describe('threads without a checkout yet', () => {
    it('creates a thread on the current branch with the default checkout to make', () => {
      const harness = createHarness()

      expect(harness.createThread({ repositoryId: 'repo-1' })).toEqual({ ok: true })

      expect(harness.state.threads[0]).toMatchObject({
        mode: 'active-branch',
        branchName: 'main',
        worktreePath: null,
        pendingSetup: { mode: 'trunk', branchName: null }
      })
      expect(runGit).not.toHaveBeenCalled()
      expect(createWorktree).not.toHaveBeenCalled()
    })

    it('preselects the project checkout over the app setting', () => {
      const harness = createHarness()
      harness.state.settings.threadSetupMode = 'branch'
      expect(harness.createThread({ repositoryId: 'repo-1' }).ok).toBe(true)
      harness.state.repositories[0].threadSetupMode = 'worktree'
      expect(harness.createThread({ repositoryId: 'repo-1' }).ok).toBe(true)

      expect(harness.state.threads.map((thread) => thread.pendingSetup?.mode)).toEqual([
        'branch',
        'worktree'
      ])
    })

    it('checks out the primary branch for a trunk thread', async () => {
      vi.mocked(getCurrentBranchName).mockReturnValue('feature/old')
      vi.mocked(resolveExistingBranchTarget).mockReturnValue({
        ok: true,
        target: { kind: 'local', branchName: 'main' }
      })
      const harness = createHarness()
      harness.createThread({ repositoryId: 'repo-1' })

      await expect(harness.finishThreadSetup('thread-1', 'Fix it')).resolves.toEqual({
        ok: true,
        cwdChanged: false
      })

      expect(checkoutExistingBranch).toHaveBeenCalledWith(
        '/repo',
        { kind: 'local', branchName: 'main' },
        createNativeBackend()
      )
      expect(harness.state.threads[0]).toMatchObject({ mode: 'active-branch', branchName: 'main' })
      expect(harness.state.threads[0]).not.toHaveProperty('pendingSetup')
      expect(harness.onThreadSetUp).toHaveBeenCalledWith('thread-1')
    })

    it('names a new branch from the first message', async () => {
      const generate = vi.fn(async () => '12431234-build-the-thing')
      const harness = createHarness({ generateBranchName: generate })
      harness.state.settings.threadSetupMode = 'branch'
      harness.createThread({ repositoryId: 'repo-1' })

      const result = await harness.finishThreadSetup('thread-1', 'US 12431234: build the thing')

      expect(result).toEqual({ ok: true, cwdChanged: false })
      expect(generate).toHaveBeenCalledWith('US 12431234: build the thing')
      expect(runGit).toHaveBeenCalledWith(
        '/repo',
        ['checkout', '-b', '12431234-build-the-thing', 'main'],
        createNativeBackend()
      )
      expect(harness.state.threads[0]).toMatchObject({
        mode: 'new-branch',
        branchName: '12431234-build-the-thing',
        ownsBranch: true
      })
    })

    it('makes a generated name unique and falls back when naming fails', async () => {
      vi.mocked(listRepositoryWorktrees).mockReturnValue([
        { branchName: 'add-login', path: '/repo/.worktrees/add-login' }
      ])
      const harness = createHarness({ generateBranchName: async () => 'add-login' })
      harness.state.settings.threadSetupMode = 'worktree'
      harness.createThread({ repositoryId: 'repo-1' })

      const result = await harness.finishThreadSetup('thread-1', 'Add login')

      expect(result).toEqual({ ok: true, cwdChanged: true })
      expect(createWorktree).toHaveBeenCalledWith(
        '/repo',
        'add-login-2',
        'main',
        createNativeBackend()
      )
      expect(harness.state.threads[0]).toMatchObject({
        mode: 'worktree',
        branchName: 'add-login-2',
        worktreePath: '/repo/.worktrees/feature-thread',
        resumeSessionId: null
      })
    })

    it('uses the chosen branch name without generating one', async () => {
      const generate = vi.fn(async () => 'unused')
      const harness = createHarness({ generateBranchName: generate })
      harness.createThread({ repositoryId: 'repo-1' })
      harness.state.threads[0].pendingSetup = { mode: 'worktree', branchName: 'feature/chosen' }

      await harness.finishThreadSetup('thread-1', 'Anything')

      expect(generate).not.toHaveBeenCalled()
      expect(createWorktree).toHaveBeenCalledWith(
        '/repo',
        'feature/chosen',
        'main',
        createNativeBackend()
      )
    })

    it('keeps the thread pending when the checkout fails', async () => {
      vi.mocked(getCurrentBranchName).mockReturnValue('feature/old')
      vi.mocked(hasUncommittedChanges).mockReturnValue(true)
      vi.mocked(resolveExistingBranchTarget).mockReturnValue({
        ok: true,
        target: { kind: 'local', branchName: 'main' }
      })
      const harness = createHarness()
      harness.createThread({ repositoryId: 'repo-1' })

      const result = await harness.finishThreadSetup('thread-1', 'Fix it')

      expect(result.ok).toBe(false)
      expect(harness.state.threads[0].pendingSetup).toEqual({ mode: 'trunk', branchName: null })
      expect(harness.onThreadSetUp).not.toHaveBeenCalled()
    })

    it('sets a thread up once while its branch is being named', async () => {
      let finishNaming: (name: string) => void = () => undefined
      const harness = createHarness({
        generateBranchName: () => new Promise((resolve) => (finishNaming = resolve))
      })
      harness.state.settings.threadSetupMode = 'branch'
      harness.createThread({ repositoryId: 'repo-1' })

      const first = harness.finishThreadSetup('thread-1', 'Do it')
      const second = harness.finishThreadSetup('thread-1', 'Do it')
      expect(harness.isThreadSettingUp('thread-1')).toBe(true)
      finishNaming('do-it')

      expect(await first).toEqual(await second)
      expect(runGit).toHaveBeenCalledOnce()
      expect(harness.isThreadSettingUp('thread-1')).toBe(false)
    })

    it('does nothing for a thread that already has its checkout', async () => {
      const harness = createHarness()
      harness.createThread({ repositoryId: 'repo-1', mode: 'active-branch' })

      await expect(harness.finishThreadSetup('thread-1', 'Hi')).resolves.toEqual({
        ok: true,
        cwdChanged: false
      })
      expect(harness.onThreadSetUp).not.toHaveBeenCalled()
    })
  })
})
