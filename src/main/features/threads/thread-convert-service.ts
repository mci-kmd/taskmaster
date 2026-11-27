import type {
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  ThreadSetupPhase
} from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import {
  branchExists,
  getCurrentBranchName,
  listRepositoryWorktrees
} from '../repositories/repository-git'
import {
  cleanupFailedWorktree,
  createWorktreeForExistingBranchAsync,
  runNewWorktreeSetupCommandAsync,
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
  /** Called when a thread starts or stops converting to a worktree. */
  onSetupPhaseChanged?: (threadId: string) => void
}): {
  convertThreadToWorktree: (threadId: string) => Promise<MutationResult>
  getSetupPhases: () => ReadonlyMap<string, ThreadSetupPhase>
} {
  const setupPhases = new Map<string, ThreadSetupPhase>()

  return {
    convertThreadToWorktree: async (threadId: string): Promise<MutationResult> => {
      const state = dependencies.ensureState()
      const thread = state.threads.find((item) => item.id === threadId)
      if (!thread) {
        return dependencies.failureResult('Thread not found.')
      }

      if (thread.mode === 'worktree') {
        return dependencies.failureResult('Thread is already a worktree thread.')
      }

      if (thread.pendingSetup) {
        return dependencies.failureResult(
          'This thread has no checkout yet. Pick Worktree below its message box instead.'
        )
      }

      const repository = state.repositories.find((item) => item.id === thread.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Owning repository not found.')
      }

      if (isGeneralProject(repository)) {
        return dependencies.failureResult(
          `Threads in ${repository.name} are not tied to a repository and cannot be converted to a work tree.`
        )
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
      setupPhases.set(thread.id, 'worktree')
      dependencies.onSetupPhaseChanged?.(thread.id)

      try {
        worktreePath = await createWorktreeForExistingBranchAsync(
          repositoryPath,
          thread.branchName,
          repository.backend
        )
        await runNewWorktreeSetupCommandAsync(repository, {
          branchName: thread.branchName,
          worktreePath
        })
      } catch (error) {
        setupPhases.delete(thread.id)
        dependencies.onSetupPhaseChanged?.(thread.id)
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

      setupPhases.delete(thread.id)
      thread.mode = 'worktree'
      thread.worktreePath = worktreePath
      thread.ownsWorktree = true
      dependencies.saveState()
      dependencies.refreshRepositoryGitState(repository)
      dependencies.onSetupPhaseChanged?.(thread.id)
      return dependencies.successResult()
    },
    getSetupPhases: () => setupPhases
  }
}
