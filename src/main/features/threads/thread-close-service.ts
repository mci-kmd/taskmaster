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
  remoteBranchExists
} from '../repositories/repository-git'
import {
  removeWorktree,
  runPostWorktreeRemoveCommand,
  shouldSkipWorktreeGitCleanup
} from './thread-worktree-utils'

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

  const protectedBranchError = getProtectedBranchDeletionError(
    repositoryPath,
    thread.branchName,
    backend
  )
  if (protectedBranchError) {
    return failureResult(protectedBranchError)
  }

  const currentBranchName = getCurrentBranchName(repositoryPath, backend)
  if (currentBranchName === thread.branchName) {
    if (isDirtyGitPath(repositoryPath, backend)) {
      const dirtyConfirmation = await showMessageBox({
        type: 'warning',
        buttons: ['Cancel thread removal', 'Continue without removing branch'],
        defaultId: 0,
        cancelId: 0,
        title: 'Cannot delete branch',
        message: `Can't delete "${thread.branchName}" because it is checked out and has uncommitted changes.`,
        detail:
          'Taskmaster cannot switch to the primary branch until you commit or stash those changes.'
      })

      if (dirtyConfirmation.response === 0) {
        return failureResult('Thread close cancelled.', true)
      }

      return null
    }

    const checkoutTarget = getPrimaryBranchCheckoutTarget(
      repositoryPath,
      thread.branchName,
      backend
    )
    if (!checkoutTarget) {
      return failureResult(
        `Can't delete "${thread.branchName}" because the repository primary branch could not be determined.`
      )
    }

    try {
      runGit(repositoryPath, ['checkout', checkoutTarget], backend)
    } catch (error) {
      return failureResult(error instanceof Error ? error.message : String(error))
    }
  }

  if (!branchExists(repositoryPath, thread.branchName, backend)) {
    return null
  }

  try {
    runGit(repositoryPath, ['branch', '-D', thread.branchName], backend)
  } catch (error) {
    return failureResult(error instanceof Error ? error.message : String(error))
  }

  return null
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

        if (thread.mode === 'worktree') {
          const skipGitCleanup = shouldSkipWorktreeGitCleanup(
            thread,
            repositoryPath,
            repository.backend
          )

          if (!skipGitCleanup && thread.worktreePath) {
            const dirty = isDirtyGitPath(thread.worktreePath, repository.backend)
            if (dirty) {
              const confirmation = await dependencies.showMessageBox({
                type: 'warning',
                buttons: ['Cancel', 'Delete anyway'],
                defaultId: 0,
                cancelId: 0,
                title: 'Uncommitted changes',
                message: `The worktree for "${thread.customTitle ?? thread.branchName}" has uncommitted changes.`,
                detail: 'Delete anyway will remove the worktree and delete its branch.'
              })

              if (confirmation.response === 0) {
                return dependencies.failureResult('Thread close cancelled.', true)
              }
            }

            stopThreadProcesses()
            try {
              removeWorktree(thread, repositoryPath, repository.backend, dirty)
            } catch (error) {
              return dependencies.failureResult(
                error instanceof Error ? error.message : String(error)
              )
            }
          }

          try {
            runPostWorktreeRemoveCommand(repository, thread)
          } catch (error) {
            postWorktreeRemoveError = error instanceof Error ? error.message : String(error)
          }
        }

        if (thread.mode === 'new-branch') {
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
        return postWorktreeRemoveError
          ? dependencies.failureResult(
              `Thread closed, but post-remove script failed: ${postWorktreeRemoveError}`
            )
          : dependencies.successResult()
      } catch (error) {
        return dependencies.failureResult(error instanceof Error ? error.message : String(error))
      }
    }
  }
}
