import type { MutationResult, PersistedAppState } from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'

type RepositoryRemoveServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads' | 'ui'>
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  isThreadWorking: (threadId: string) => boolean
  stopThreadProcesses: (threadId: string) => Promise<void>
}

/** Forgets a project and its threads and tasks; never touches the repository, its branches, or worktrees. */
export function createRepositoryRemoveService(dependencies: RepositoryRemoveServiceDependencies): {
  removeRepository: (repositoryId: string) => Promise<MutationResult>
} {
  return {
    removeRepository: async (repositoryId: string): Promise<MutationResult> => {
      try {
        const state = dependencies.ensureState()
        const repository = state.repositories.find((item) => item.id === repositoryId)
        if (!repository) {
          return dependencies.failureResult('Project not found.')
        }
        if (isGeneralProject(repository)) {
          return dependencies.failureResult('The built-in project cannot be removed.')
        }

        const threadIds = state.threads
          .filter((thread) => thread.repositoryId === repositoryId)
          .map((thread) => thread.id)
        if (threadIds.some((threadId) => dependencies.isThreadWorking(threadId))) {
          return dependencies.failureResult(
            'Wait for working threads in this project to finish before removing it.'
          )
        }

        for (const threadId of threadIds) {
          await dependencies.stopThreadProcesses(threadId)
        }

        // Re-read in case state changed while sessions were shutting down.
        const current = dependencies.ensureState()
        const removedThreadIds = new Set(
          current.threads
            .filter((thread) => thread.repositoryId === repositoryId)
            .map((thread) => thread.id)
        )
        current.threads = current.threads.filter((thread) => !removedThreadIds.has(thread.id))
        current.repositories = current.repositories.filter((item) => item.id !== repositoryId)
        if (
          current.ui.selectedRepositoryId === repositoryId ||
          (current.ui.selectedThreadId !== null &&
            removedThreadIds.has(current.ui.selectedThreadId))
        ) {
          current.ui.selectedRepositoryId = null
          current.ui.selectedThreadId = null
        }

        dependencies.saveState()
        return dependencies.successResult()
      } catch (error) {
        return dependencies.failureResult(error instanceof Error ? error.message : String(error))
      }
    }
  }
}
