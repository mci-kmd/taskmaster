import type {
  MutationResult,
  PersistedAppState,
  PersistedThread,
  RepositoryBackend
} from '../../../shared/app-types'
import { runGit } from '../../backends/git-client'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import {
  branchExists,
  getCurrentBranchName,
  getPrimaryBranchCheckoutTarget,
  getProtectedBranchDeletionError,
  isDirtyGitPath,
  remoteBranchExists,
  resolveGitRoot
} from '../repositories/repository-git'
import { removeWorktree, runPostWorktreeRemoveCommand } from './thread-worktree-utils'

type MessageBoxOptions = {
  type: 'question' | 'warning'
  buttons: string[]
  defaultId: number
  cancelId: number
  title: string
  message: string
  detail: string
}

type MessageBoxResult = {
  response: number
}

function ownsBranch(thread: Pick<PersistedThread, 'mode' | 'ownsBranch'>): boolean {
  return thread.ownsBranch ?? (thread.mode === 'new-branch' || thread.mode === 'worktree')
}

function ownsWorktree(thread: Pick<PersistedThread, 'mode' | 'ownsWorktree'>): boolean {
  return thread.ownsWorktree ?? thread.mode === 'worktree'
}

type BranchDeleteResult = { ok: true } | { ok: false; error: string }

function deleteLocalBranch(
  thread: PersistedThread,
  repositoryPath: string,
  backend: RepositoryBackend
): BranchDeleteResult {
  if (!branchExists(repositoryPath, thread.branchName, backend)) {
    return { ok: true }
  }

  const protectedBranchError = getProtectedBranchDeletionError(
    repositoryPath,
    thread.branchName,
    backend
  )
  if (protectedBranchError) {
    return { ok: false, error: protectedBranchError }
  }

  const currentBranchName = getCurrentBranchName(repositoryPath, backend)
  if (currentBranchName === thread.branchName) {
    if (isDirtyGitPath(repositoryPath, backend)) {
      return {
        ok: false,
        error: `Can't delete "${thread.branchName}" because it is checked out and has uncommitted changes.`
      }
    }

    const checkoutTarget = getPrimaryBranchCheckoutTarget(
      repositoryPath,
      thread.branchName,
      backend
    )
    if (!checkoutTarget) {
      return {
        ok: false,
        error: `Can't delete "${thread.branchName}" because the repository primary branch could not be determined.`
      }
    }

    try {
      runGit(repositoryPath, ['checkout', checkoutTarget], backend)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (!branchExists(repositoryPath, thread.branchName, backend)) {
    return { ok: true }
  }

  try {
    runGit(repositoryPath, ['branch', '-D', thread.branchName], backend)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  return { ok: true }
}

function hasAccessibleWorktreeGit(
  thread: Pick<PersistedThread, 'worktreePath'>,
  backend: RepositoryBackend
): boolean {
  return thread.worktreePath ? resolveGitRoot(thread.worktreePath, backend) !== null : false
}

function formatWorktreeRemovalError(error: string): string {
  return /permission denied|access is denied/i.test(error)
    ? `${error} Close any apps still using that worktree folder and try again.`
    : error
}

async function maybeRemoveLocalBranchForNewBranchThread(
  thread: PersistedThread,
  repositoryPath: string,
  backend: RepositoryBackend,
  failureResult: (error: string, cancelled?: boolean) => MutationResult,
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxResult>
): Promise<MutationResult | null> {
  if (
    !branchExists(repositoryPath, thread.branchName, backend) ||
    remoteBranchExists(repositoryPath, thread.branchName, backend)
  ) {
    return null
  }

  const threadLabel = thread.customTitle ?? thread.branchName
  const confirmation = await showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Keep branch', 'Remove branch'],
    defaultId: 2,
    cancelId: 0,
    title: 'Remove local branch?',
    message: `Close "${threadLabel}" and remove its local branch?`,
    detail: `The remote branch "${thread.branchName}" no longer exists. Keep branch will only remove the thread.`
  })

  if (confirmation.response === 0) {
    return failureResult('Thread close cancelled.', true)
  }

  if (confirmation.response === 1 || !branchExists(repositoryPath, thread.branchName, backend)) {
    return null
  }

  const deleteResult = deleteLocalBranch(thread, repositoryPath, backend)
  if (deleteResult.ok) {
    return null
  }

  if (deleteResult.error.includes('checked out and has uncommitted changes.')) {
    const dirtyConfirmation = await showMessageBox({
      type: 'warning',
      buttons: ['Cancel thread removal', 'Continue without removing branch'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cannot delete branch',
      message: deleteResult.error,
      detail:
        'Taskmaster cannot switch to the primary branch until you commit or stash those changes.'
    })

    if (dirtyConfirmation.response === 0) {
      return failureResult('Thread close cancelled.', true)
    }

    return null
  }

  return failureResult(deleteResult.error)
}

export function createThreadCloseService(dependencies: {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads' | 'ui'>
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  stopThreadRunSession: (threadId: string) => boolean
  killSessionsForThread: (threadId: string) => void
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxResult>
}): {
  closeThread: (threadId: string) => Promise<MutationResult>
} {
  return {
    closeThread: async (threadId: string): Promise<MutationResult> => {
      try {
        const state = dependencies.ensureState()
        const thread = state.threads.find((item) => item.id === threadId)
        if (!thread) {
          return dependencies.failureResult('Thread not found.')
        }

        const repository = state.repositories.find((item) => item.id === thread.repositoryId)
        if (!repository) {
          return dependencies.failureResult('Owning repository not found.')
        }

        let postWorktreeRemoveError: string | null = null
        let closeWarning: string | null = null
        const repositoryPath = getRepositoryExecutionPath(repository)
        let didStopThreadProcesses = false
        const stopThreadProcesses = (): void => {
          if (didStopThreadProcesses) {
            return
          }

          didStopThreadProcesses = true
          dependencies.killSessionsForThread(threadId)
          dependencies.stopThreadRunSession(threadId)
        }

        if (thread.mode === 'worktree' && ownsWorktree(thread)) {
          let worktreeCleanupCompleted = false
          const branchOwned = ownsBranch(thread)

          if (hasAccessibleWorktreeGit(thread, repository.backend) && thread.worktreePath) {
            const dirty = isDirtyGitPath(thread.worktreePath, repository.backend)
            if (dirty) {
              const confirmation = await dependencies.showMessageBox({
                type: 'warning',
                buttons: ['Cancel', 'Delete anyway'],
                defaultId: 0,
                cancelId: 0,
                title: 'Uncommitted changes',
                message: `The worktree for "${thread.customTitle ?? thread.branchName}" has uncommitted changes.`,
                detail: ownsBranch(thread)
                  ? 'Delete anyway will remove the worktree and delete its branch.'
                  : 'Delete anyway will remove the worktree.'
              })

              if (confirmation.response === 0) {
                return dependencies.failureResult('Thread close cancelled.', true)
              }
            }

            stopThreadProcesses()
            try {
              removeWorktree(thread, repositoryPath, repository.backend, dirty, branchOwned)
              worktreeCleanupCompleted = true
            } catch (error) {
              const cleanupError = error instanceof Error ? error.message : String(error)
              if (hasAccessibleWorktreeGit(thread, repository.backend) || !branchOwned) {
                return dependencies.failureResult(formatWorktreeRemovalError(cleanupError))
              }

              const branchDeleteResult = deleteLocalBranch(
                thread,
                repositoryPath,
                repository.backend
              )
              worktreeCleanupCompleted = true
              closeWarning = branchDeleteResult.ok
                ? `the worktree disappeared during cleanup. Original worktree removal error: ${cleanupError}`
                : `the worktree disappeared during cleanup, and the branch cleanup failed: ${branchDeleteResult.error}`
            }
          } else {
            worktreeCleanupCompleted = true
            if (branchOwned) {
              const branchDeleteResult = deleteLocalBranch(
                thread,
                repositoryPath,
                repository.backend
              )
              if (!branchDeleteResult.ok) {
                closeWarning = `the orphaned branch cleanup failed: ${branchDeleteResult.error}`
              }
            }
          }

          if (worktreeCleanupCompleted && !closeWarning) {
            try {
              runPostWorktreeRemoveCommand(repository, thread)
            } catch (error) {
              postWorktreeRemoveError = error instanceof Error ? error.message : String(error)
            }
          }
        }

        if (thread.mode === 'new-branch' && ownsBranch(thread)) {
          const branchRemovalResult = await maybeRemoveLocalBranchForNewBranchThread(
            thread,
            repositoryPath,
            repository.backend,
            dependencies.failureResult,
            dependencies.showMessageBox
          )
          if (branchRemovalResult) {
            return branchRemovalResult
          }
        }

        stopThreadProcesses()
        state.threads = state.threads.filter((item) => item.id !== thread.id)
        if (state.ui.selectedThreadId === thread.id) {
          state.ui.selectedThreadId = null
          state.ui.selectedRepositoryId = repository.id
        }

        dependencies.saveState()
        const issues = [
          closeWarning,
          postWorktreeRemoveError ? `post-remove script failed: ${postWorktreeRemoveError}` : null
        ].filter((value): value is string => value !== null)
        return issues.length > 0
          ? dependencies.failureResult(`Thread closed, but ${issues.join(' ')}`)
          : dependencies.successResult()
      } catch (error) {
        return dependencies.failureResult(error instanceof Error ? error.message : String(error))
      }
    }
  }
}
