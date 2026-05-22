import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationResult, PersistedAppState, PersistedThread } from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { createThreadCloseService } from './thread-close-service'
import {
  branchExists,
  getCurrentBranchName,
  getPrimaryBranchCheckoutTarget,
  getProtectedBranchDeletionError,
  isDirtyGitPath,
  remoteBranchExists
} from '../repositories/repository-git'
import {
  removeWorktree,
  runPostWorktreeRemoveCommand,
  shouldSkipWorktreeGitCleanup
} from './thread-worktree-utils'

vi.mock('../../backends/git-client', () => ({
  runGit: vi.fn()
}))

vi.mock('../repositories/repository-git', () => ({
  branchExists: vi.fn(),
  getCurrentBranchName: vi.fn(),
  getPrimaryBranchCheckoutTarget: vi.fn(),
  getProtectedBranchDeletionError: vi.fn(),
  isDirtyGitPath: vi.fn(),
  remoteBranchExists: vi.fn()
}))

vi.mock('./thread-worktree-utils', () => ({
  removeWorktree: vi.fn(),
  runPostWorktreeRemoveCommand: vi.fn(),
  shouldSkipWorktreeGitCleanup: vi.fn()
}))

function createState(thread: PersistedThread): PersistedAppState {
  return {
    version: 12,
    settings: {
      agentProviderId: 'copilot',
      globalFlagsInput: '',
      terminalFontFamilyInput: '',
      taskTagsInput: 'bug, feature'
    },
    repositories: [
      {
        id: 'repo-1',
        name: 'Repo',
        path: '/repo',
        backend: createNativeBackend(),
        faviconPath: null,
        runCommand: null,
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

function createThread(overrides: Partial<PersistedThread> = {}): PersistedThread {
  return {
    id: 'thread-1',
    repositoryId: 'repo-1',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'worktree',
    branchName: 'feature/thread',
    worktreePath: '/repo/.worktrees/feature-thread',
    sessionName: 'repo-feature-thread',
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    hasLaunched: false,
    ...overrides
  }
}

function createHarness(thread: PersistedThread): {
  closeThread: (threadId: string) => Promise<MutationResult>
  state: PersistedAppState
  saveState: ReturnType<typeof vi.fn>
  killSessionsForThread: ReturnType<typeof vi.fn>
  stopThreadRunSession: ReturnType<typeof vi.fn>
  showMessageBox: ReturnType<typeof vi.fn>
} {
  const state = createState(thread)
  const saveState = vi.fn()
  const killSessionsForThread = vi.fn()
  const stopThreadRunSession = vi.fn()
  const showMessageBox = vi.fn()
  const service = createThreadCloseService({
    ensureState: () => state,
    saveState,
    successResult: () => ({ ok: true }),
    failureResult: (error, cancelled = false) => ({ ok: false, error, cancelled }),
    stopThreadRunSession,
    killSessionsForThread,
    showMessageBox
  })

  return {
    closeThread: service.closeThread,
    state,
    saveState,
    killSessionsForThread,
    stopThreadRunSession,
    showMessageBox
  }
}

describe('createThreadCloseService', () => {
  beforeEach(() => {
    vi.mocked(branchExists).mockReset()
    vi.mocked(getCurrentBranchName).mockReset()
    vi.mocked(getPrimaryBranchCheckoutTarget).mockReset()
    vi.mocked(getProtectedBranchDeletionError).mockReset()
    vi.mocked(isDirtyGitPath).mockReset()
    vi.mocked(remoteBranchExists).mockReset()
    vi.mocked(removeWorktree).mockReset()
    vi.mocked(runPostWorktreeRemoveCommand).mockReset()
    vi.mocked(shouldSkipWorktreeGitCleanup).mockReset()

    vi.mocked(branchExists).mockReturnValue(true)
    vi.mocked(getCurrentBranchName).mockReturnValue('main')
    vi.mocked(getPrimaryBranchCheckoutTarget).mockReturnValue('main')
    vi.mocked(getProtectedBranchDeletionError).mockReturnValue(null)
    vi.mocked(isDirtyGitPath).mockReturnValue(false)
    vi.mocked(remoteBranchExists).mockReturnValue(false)
    vi.mocked(shouldSkipWorktreeGitCleanup).mockReturnValue(false)
  })

  it('does not stop thread processes when dirty worktree close is cancelled', async () => {
    vi.mocked(isDirtyGitPath).mockReturnValue(true)
    const harness = createHarness(createThread())
    harness.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })

    const result = await harness.closeThread('thread-1')

    expect(result).toEqual({ ok: false, error: 'Thread close cancelled.', cancelled: true })
    expect(harness.killSessionsForThread).not.toHaveBeenCalled()
    expect(harness.stopThreadRunSession).not.toHaveBeenCalled()
    expect(removeWorktree).not.toHaveBeenCalled()
    expect(harness.state.threads).toHaveLength(1)
    expect(harness.saveState).not.toHaveBeenCalled()
  })

  it('stops thread processes before removing a confirmed dirty worktree', async () => {
    vi.mocked(isDirtyGitPath).mockReturnValue(true)
    const harness = createHarness(createThread())
    harness.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })

    const result = await harness.closeThread('thread-1')

    expect(result).toEqual({ ok: true })
    expect(harness.killSessionsForThread).toHaveBeenCalledWith('thread-1')
    expect(harness.stopThreadRunSession).toHaveBeenCalledWith('thread-1')
    expect(removeWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thread-1' }),
      '/repo',
      createNativeBackend(),
      true
    )
    expect(harness.state.threads).toEqual([])
    expect(harness.saveState).toHaveBeenCalledOnce()
  })

  it('does not stop thread processes when local branch removal is cancelled', async () => {
    const harness = createHarness(
      createThread({
        mode: 'new-branch',
        worktreePath: null
      })
    )
    harness.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })

    const result = await harness.closeThread('thread-1')

    expect(result).toEqual({ ok: false, error: 'Thread close cancelled.', cancelled: true })
    expect(harness.killSessionsForThread).not.toHaveBeenCalled()
    expect(harness.stopThreadRunSession).not.toHaveBeenCalled()
    expect(harness.state.threads).toHaveLength(1)
    expect(harness.saveState).not.toHaveBeenCalled()
  })
})
