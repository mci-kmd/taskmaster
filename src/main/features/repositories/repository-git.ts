import type { PersistedRepository, RepositoryBackend } from '../../../shared/app-types'
import { runGit, tryGit } from '../../backends/git-client'
import { createNativeBackend, getRepositoryExecutionPath } from '../../backends/repository-backend'

export type RepositoryGitState = {
  currentBranch: string
  primaryBranch: string | null
}

export function resolveGitRoot(
  path: string,
  backend: RepositoryBackend = createNativeBackend()
): string | null {
  const result = tryGit(path, ['rev-parse', '--show-toplevel'], backend)
  return result.ok ? result.stdout : null
}

export function branchExists(
  repoPath: string,
  branchName: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  return tryGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], backend)
    .ok
}

export function remoteBranchExists(
  repoPath: string,
  branchName: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  const result = tryGit(repoPath, ['branch', '--remotes', '--list', `*/${branchName}`], backend)
  return result.ok && result.stdout.length > 0
}

export function getCurrentBranchLabel(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
  if (!branchResult.ok) {
    return 'Unavailable'
  }

  if (branchResult.stdout === 'HEAD') {
    const headResult = tryGit(repoPath, ['rev-parse', '--short', 'HEAD'], backend)
    return headResult.ok ? `HEAD (${headResult.stdout})` : 'HEAD'
  }

  return branchResult.stdout
}

export function getCurrentBranchName(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string | null {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
  if (!branchResult.ok || branchResult.stdout === 'HEAD') {
    return null
  }

  return branchResult.stdout
}

export function getPrimaryBranch(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string | null {
  const symref = tryGit(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], backend)
  if (symref.ok && symref.stdout) {
    const candidate = symref.stdout.replace(/^origin\//, '')
    if (candidate && branchExists(repoPath, candidate, backend)) {
      return candidate
    }
  }

  for (const candidate of ['main', 'master']) {
    if (branchExists(repoPath, candidate, backend)) {
      return candidate
    }
  }

  return null
}

export function getPrimaryBranchCheckoutTarget(
  repoPath: string,
  branchName: string,
  backend: RepositoryBackend = createNativeBackend()
): string | null {
  const primaryBranch = getPrimaryBranch(repoPath, backend)
  return primaryBranch && primaryBranch !== branchName ? primaryBranch : null
}

export function getProtectedBranchDeletionError(
  repoPath: string,
  branchName: string,
  backend: RepositoryBackend = createNativeBackend()
): string | null {
  if (branchName === 'main') {
    return 'The main branch cannot be deleted.'
  }

  const primaryBranch = getPrimaryBranch(repoPath, backend)
  if (primaryBranch === branchName) {
    return `The repository primary branch "${branchName}" cannot be deleted.`
  }

  return null
}

export function hasUncommittedChanges(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  const result = tryGit(repoPath, ['status', '--porcelain', '--untracked-files=no'], backend)
  return result.ok && result.stdout.length > 0
}

export function isDirtyGitPath(
  path: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  return runGit(path, ['status', '--porcelain', '--untracked-files=all'], backend).length > 0
}

function readRepositoryGitState(repository: PersistedRepository): RepositoryGitState {
  const repositoryPath = getRepositoryExecutionPath(repository)
  return {
    currentBranch: getCurrentBranchLabel(repositoryPath, repository.backend),
    primaryBranch: getPrimaryBranch(repositoryPath, repository.backend)
  }
}

export function createRepositoryGitStateService(): {
  getRepositoryGitState: (
    repository: PersistedRepository,
    refreshGit: boolean
  ) => RepositoryGitState
} {
  const repositoryGitStateCache = new Map<string, RepositoryGitState>()

  return {
    getRepositoryGitState: (
      repository: PersistedRepository,
      refreshGit: boolean
    ): RepositoryGitState => {
      if (!refreshGit) {
        const cached = repositoryGitStateCache.get(repository.id)
        if (cached) {
          return cached
        }
      }

      const next = readRepositoryGitState(repository)
      repositoryGitStateCache.set(repository.id, next)
      return next
    }
  }
}
