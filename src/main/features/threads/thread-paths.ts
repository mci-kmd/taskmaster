import type { PersistedRepository, PersistedThread } from '../../../shared/app-types'
import { getRepositoryExecutionPath, pathForDisplay } from '../../backends/repository-backend'

export function getThreadExecutionCwd(
  thread: Pick<PersistedThread, 'mode' | 'worktreePath'>,
  repository: Pick<PersistedRepository, 'path' | 'backend'>
): string {
  const repositoryPath = getRepositoryExecutionPath(repository)
  return thread.mode === 'worktree' ? (thread.worktreePath ?? repositoryPath) : repositoryPath
}

export function getThreadUiCwd(
  thread: Pick<PersistedThread, 'mode' | 'worktreePath'>,
  repository: Pick<PersistedRepository, 'path' | 'backend'>
): string {
  return pathForDisplay(getThreadExecutionCwd(thread, repository), repository.backend)
}
