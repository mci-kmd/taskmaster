import type {
  BranchStatusRequest,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositoryBackend
} from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import { getThreadExecutionCwd } from './thread-paths'

export type ThreadGitContext =
  | {
      ok: true
      thread: PersistedThread
      repository: PersistedRepository
      cwd: string
    }
  | {
      ok: false
      error: string
    }

export function createThreadGitContextService(dependencies: {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads'>
  findThread: (threadId: string) => PersistedThread | undefined
  findRepository: (repositoryId: string) => PersistedRepository | undefined
}): {
  resolveThreadGitContext: (threadId: string) => ThreadGitContext
  /** Like resolveThreadGitContext, but rejects threads outside a git repository. */
  resolveRepositoryThreadContext: (threadId: string) => ThreadGitContext
  resolveBranchStatusContext: (
    input: BranchStatusRequest
  ) => { cwd: string; backend: RepositoryBackend } | null
} {
  const resolveThreadGitContext = (threadId: string): ThreadGitContext => {
    const thread = dependencies.findThread(threadId)
    if (!thread) {
      return { ok: false, error: 'Thread not found.' }
    }

    const repository = dependencies.findRepository(thread.repositoryId)
    if (!repository) {
      return { ok: false, error: 'Repository not found.' }
    }

    return {
      ok: true,
      thread,
      repository,
      cwd: getThreadExecutionCwd(thread, repository)
    }
  }

  return {
    resolveThreadGitContext,
    resolveRepositoryThreadContext: (threadId: string): ThreadGitContext => {
      const context = resolveThreadGitContext(threadId)
      return context.ok && isGeneralProject(context.repository)
        ? { ok: false, error: `This isn't available for ${context.repository.name} threads.` }
        : context
    },
    resolveBranchStatusContext: (
      input: BranchStatusRequest
    ): { cwd: string; backend: RepositoryBackend } | null => {
      const state = dependencies.ensureState()

      if (input.threadId) {
        const thread = state.threads.find((item) => item.id === input.threadId)
        if (!thread) {
          return null
        }

        const repository = state.repositories.find((item) => item.id === thread.repositoryId)
        if (!repository || isGeneralProject(repository)) {
          return null
        }

        return { cwd: getThreadExecutionCwd(thread, repository), backend: repository.backend }
      }

      if (!input.repositoryId) {
        return null
      }

      const repository = state.repositories.find((item) => item.id === input.repositoryId)
      return repository && !isGeneralProject(repository)
        ? { cwd: getRepositoryExecutionPath(repository), backend: repository.backend }
        : null
    }
  }
}
