import type {
  MutationResult,
  PersistedAppState,
  PersistedRepository
} from '../../../shared/app-types'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createThreadConvertService(dependencies: {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads'>
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  hasRunningProcesses: (threadId: string) => boolean
  refreshRepositoryGitState: (repository: PersistedRepository) => void
}): {
  convertThreadToWorktree: (threadId: string) => MutationResult
} {
  return {
    convertThreadToWorktree: (threadId: string): MutationResult => {
      const state = dependencies.ensureState()
      const thread = state.threads.find((item) => item.id === threadId)
      if (!thread) {
        return dependencies.failureResult('Thread not found.')
      }

      if (thread.mode === 'worktree') {
        return dependencies.failureResult('Thread is already a worktree thread.')
      }

      const repository = state.repositories.find((item) => item.id === thread.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Owning repository not found.')
      }

      const repositoryPath = getRepositoryExecutionPath(repository)
      const currentBranchName = getCurrentBranchName(repositoryPath, repository.backend)
      if (currentBranchName === thread.branchName) {
        return dependencies.failureResult(
          'Convert to work tree only works for threads whose branch is not currently checked out.'
        )
      }

      if (dependencies.hasRunningProcesses(thread.id)) {
        return dependencies.failureResult(
          'Stop the thread before converting it to a work tree. Running processes cannot be moved to the new working directory.'
        )
      }

      if (!branchExists(repositoryPath, thread.branchName, repository.backend)) {
        return dependencies.failureResult(
          `Cannot convert the thread because branch "${thread.branchName}" does not exist locally.`
        )
      }

      const existingWorktrees = listRepositoryWorktrees(repositoryPath, repository.backend).filter(
        (item) => item.branchName === thread.branchName
      )
      if (existingWorktrees.length > 0) {
        return dependencies.failureResult(
          `Cannot convert "${thread.branchName}" because it is already checked out in another worktree.`
        )
      }

      let worktreePath: string | null = null

      try {
        worktreePath = createWorktreeForExistingBranch(
          repositoryPath,
          thread.branchName,
          repository.backend
        )
        runNewWorktreeSetupCommand(repository, {
          branchName: thread.branchName,
          worktreePath
        })
      } catch (error) {
        const conversionError = errorMessage(error)
        const rollbackErrors: string[] = []
        const attemptedWorktreePath =
          worktreePath ?? (error instanceof WorktreeCreationError ? error.worktreePath : null)

        if (attemptedWorktreePath) {
          try {
            cleanupFailedWorktree(
              { branchName: thread.branchName, worktreePath: attemptedWorktreePath },
              repositoryPath,
              repository.backend,
              {
                deleteBranch: false,
                ownsWorktreePath: true
              }
            )
          } catch (cleanupError) {
            rollbackErrors.push(`worktree cleanup failed: ${errorMessage(cleanupError)}`)
          }
        }

        return dependencies.failureResult(
          rollbackErrors.length > 0
            ? `Thread conversion failed: ${conversionError} Rollback also failed: ${rollbackErrors.join(' ')}`
            : `Thread conversion failed: ${conversionError}`
        )
      }

      thread.mode = 'worktree'
      thread.worktreePath = worktreePath
      thread.ownsWorktree = true
      dependencies.saveState()
      dependencies.refreshRepositoryGitState(repository)
      return dependencies.successResult()
    }
  }
}
