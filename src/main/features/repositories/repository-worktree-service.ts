import type {
  CleanupRepositoryWorktreeInput,
  ListRepositoryWorktreesResult,
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  RepositoryWorktreeStatus
} from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'
import { threadDisplayName } from '../../../shared/thread-title'
import { getWorktreeCleanupBlocker } from '../../../shared/worktrees'
import { runGit, tryGitAsync } from '../../backends/git-client'
import { backendPathExists, getRepositoryExecutionPath } from '../../backends/repository-backend'
import { runPostWorktreeRemoveCommand, worktreeGitArgs } from '../threads/thread-worktree-utils'
import { getProtectedBranchDeletionError } from './repository-git'

type RepositoryWorktreeServiceDeps = {
  ensureState: () => Pick<PersistedAppState, 'threads'>
  findRepository: (repositoryId: string) => PersistedRepository | undefined
  successResult: () => MutationResult
  failureResult: (error: string) => MutationResult
  refreshRepositoryGitState: (repository: PersistedRepository) => void
}

type WorktreeEntry = {
  /** As git reports it, for passing back to git. */
  gitPath: string
  branchName: string | null
  locked: boolean
  prunable: boolean
}

type ListedWorktree = RepositoryWorktreeStatus & { gitPath: string }

function parseLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

function toDisplayPath(path: string): string {
  return process.platform === 'win32' ? path.replace(/\//gu, '\\') : path
}

function pathKey(path: string): string {
  const normalized = toDisplayPath(path).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: (WorktreeEntry & { bare: boolean }) | null = null

  const flush = (): void => {
    if (current && !current.bare) {
      entries.push({
        gitPath: current.gitPath,
        branchName: current.branchName,
        locked: current.locked,
        prunable: current.prunable
      })
    }
    current = null
  }

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      current = {
        gitPath: line.slice('worktree '.length),
        branchName: null,
        locked: false,
        prunable: false,
        bare: false
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('branch refs/heads/')) {
      current.branchName = line.slice('branch refs/heads/'.length)
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true
    }
  }
  flush()
  return entries
}

async function readLocalChanges(
  path: string,
  repository: PersistedRepository
): Promise<boolean | null> {
  const result = await tryGitAsync(
    path,
    ['status', '--porcelain', '--untracked-files=all'],
    repository.backend
  )
  return result.ok ? result.stdout.trim().length > 0 : null
}

async function listWorktrees(
  repository: PersistedRepository,
  state: Pick<PersistedAppState, 'threads'>
): Promise<{ ok: true; worktrees: ListedWorktree[] } | { ok: false; error: string }> {
  const repositoryPath = getRepositoryExecutionPath(repository)
  const [listResult, localResult, remoteResult] = await Promise.all([
    tryGitAsync(repositoryPath, ['worktree', 'list', '--porcelain'], repository.backend),
    tryGitAsync(
      repositoryPath,
      ['for-each-ref', '--format=%(refname:short)%09%(upstream:short)', 'refs/heads'],
      repository.backend
    ),
    tryGitAsync(
      repositoryPath,
      ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'],
      repository.backend
    )
  ])
  if (!listResult.ok) {
    return {
      ok: false,
      error: listResult.stderr.trim() || "Couldn't list the project's worktrees."
    }
  }

  const upstreamByBranch = new Map<string, string>()
  for (const line of parseLines(localResult.stdout)) {
    const [branchName, upstream = ''] = line.split('\t')
    upstreamByBranch.set(branchName, upstream.trim())
  }
  const remoteRefs = new Set(
    parseLines(remoteResult.stdout).filter((ref) => !ref.endsWith('/HEAD'))
  )
  const hasRemoteBranch = (branchName: string): boolean => {
    const upstream = upstreamByBranch.get(branchName)
    if (upstream && remoteRefs.has(upstream)) return true
    return [...remoteRefs].some((ref) => ref.replace(/^[^/]+\//u, '') === branchName)
  }

  // Settled threads don't count as using a worktree, so it can be cleaned up.
  const repositoryThreads = state.threads.filter(
    (thread) => thread.repositoryId === repository.id && !thread.settledAt
  )
  const entries = parseWorktreeList(listResult.stdout)
  const worktrees = await Promise.all(
    entries.map(async (entry, index): Promise<ListedWorktree> => {
      const isMain = index === 0
      const key = pathKey(entry.gitPath)
      const missing =
        entry.prunable || !backendPathExists(repository.backend, entry.gitPath, 'directory')
      const threads = repositoryThreads.filter((thread) =>
        thread.worktreePath ? pathKey(thread.worktreePath) === key : isMain
      )
      return {
        gitPath: entry.gitPath,
        path: toDisplayPath(entry.gitPath),
        branchName: entry.branchName,
        isMain,
        hasLocalBranch: entry.branchName !== null && upstreamByBranch.has(entry.branchName),
        hasRemoteBranch: entry.branchName !== null && hasRemoteBranch(entry.branchName),
        hasLocalChanges: missing ? null : await readLocalChanges(entry.gitPath, repository),
        locked: entry.locked,
        missing,
        threadTitles: threads.map((thread) => threadDisplayName(thread))
      }
    })
  )
  return { ok: true, worktrees }
}

function toStatus({ gitPath, ...status }: ListedWorktree): RepositoryWorktreeStatus {
  void gitPath
  return status
}

export function createRepositoryWorktreeService(deps: RepositoryWorktreeServiceDeps): {
  listRepositoryWorktrees: (repositoryId: string) => Promise<ListRepositoryWorktreesResult>
  cleanupRepositoryWorktree: (input: CleanupRepositoryWorktreeInput) => Promise<MutationResult>
} {
  const findGitRepository = (repositoryId: string): PersistedRepository | string => {
    const repository = deps.findRepository(repositoryId)
    if (!repository) return 'Project not found.'
    if (isGeneralProject(repository)) return 'This project has no git worktrees.'
    return repository
  }

  return {
    listRepositoryWorktrees: async (repositoryId) => {
      const repository = findGitRepository(repositoryId)
      if (typeof repository === 'string') return { ok: false, error: repository }
      const result = await listWorktrees(repository, deps.ensureState())
      return result.ok ? { ok: true, worktrees: result.worktrees.map(toStatus) } : result
    },
    cleanupRepositoryWorktree: async ({ repositoryId, path }) => {
      const repository = findGitRepository(repositoryId)
      if (typeof repository === 'string') return deps.failureResult(repository)

      // Re-checks against the current state; the list the user saw may be stale.
      const listed = await listWorktrees(repository, deps.ensureState())
      if (!listed.ok) return deps.failureResult(listed.error)
      const worktree = listed.worktrees.find((item) => pathKey(item.gitPath) === pathKey(path))
      if (!worktree) return deps.failureResult('Worktree not found. Refresh the list.')
      const blocker = getWorktreeCleanupBlocker(worktree)
      if (blocker) return deps.failureResult(blocker)

      const repositoryPath = getRepositoryExecutionPath(repository)
      const branchToDelete = worktree.hasLocalBranch ? worktree.branchName : null
      if (branchToDelete) {
        const protectedError = getProtectedBranchDeletionError(
          repositoryPath,
          branchToDelete,
          repository.backend
        )
        if (protectedError) return deps.failureResult(protectedError)
      }

      try {
        runGit(
          repositoryPath,
          worktreeGitArgs(
            repository.backend,
            worktree.missing ? ['worktree', 'prune'] : ['worktree', 'remove', worktree.gitPath]
          ),
          repository.backend
        )
        if (branchToDelete) {
          runGit(repositoryPath, ['branch', '-D', branchToDelete], repository.backend)
        }
      } catch (error) {
        return deps.failureResult(error instanceof Error ? error.message : String(error))
      } finally {
        deps.refreshRepositoryGitState(repository)
      }

      if (worktree.branchName) {
        try {
          runPostWorktreeRemoveCommand(repository, { branchName: worktree.branchName })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return deps.failureResult(`Worktree removed, but the cleanup script failed: ${message}`)
        }
      }
      return deps.successResult()
    }
  }
}
