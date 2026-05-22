import type {
  PersistedRepository,
  RepositoryBackend,
  RepositoryBranchOption,
  RepositoryWorktreeOption
} from '../../../shared/app-types'
import { runGit, tryGit } from '../../backends/git-client'
import { createNativeBackend, getRepositoryExecutionPath } from '../../backends/repository-backend'

type ExistingBranchTarget =
  | {
      kind: 'local'
      branchName: string
    }
  | {
      kind: 'remote'
      branchName: string
      remoteRef: string
    }

export type RepositoryGitState = {
  currentBranch: string
  primaryBranch: string | null
  branchOptions: RepositoryBranchOption[]
  worktreeOptions: RepositoryWorktreeOption[]
}

type ExistingBranchTargetResolution =
  | { ok: true; target: ExistingBranchTarget | null }
  | { ok: false; error: string }

function parseLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseBranchNameFromRef(ref: string): string | null {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null
}

function compareBranchNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function listLocalBranchNames(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string[] {
  const result = tryGit(
    repoPath,
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    backend
  )
  return result.ok ? parseLines(result.stdout).sort(compareBranchNames) : []
}

function listRemoteBranchRefs(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): string[] {
  const result = tryGit(
    repoPath,
    ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'],
    backend
  )
  return result.ok
    ? parseLines(result.stdout)
        .filter((name) => !name.endsWith('/HEAD'))
        .sort(compareBranchNames)
    : []
}

export function listRepositoryBranchOptions(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): RepositoryBranchOption[] {
  const localBranches = listLocalBranchNames(repoPath, backend).map((branchName) => ({
    value: branchName,
    kind: 'local' as const,
    label: `Local branch`
  }))
  const remoteBranches = listRemoteBranchRefs(repoPath, backend).map((remoteRef) => ({
    value: remoteRef,
    kind: 'remote' as const,
    label: `Remote branch`
  }))
  return [...localBranches, ...remoteBranches]
}

export function listRepositoryWorktrees(
  repoPath: string,
  backend: RepositoryBackend = createNativeBackend()
): RepositoryWorktreeOption[] {
  const result = tryGit(repoPath, ['worktree', 'list', '--porcelain'], backend)
  if (!result.ok) {
    return []
  }

  const entries: RepositoryWorktreeOption[] = []
  let currentPath: string | null = null
  let currentBranchName: string | null = null

  const flush = (): void => {
    if (currentPath && currentBranchName) {
      entries.push({
        branchName: currentBranchName,
        path: currentPath
      })
    }
    currentPath = null
    currentBranchName = null
  }

  for (const rawLine of result.stdout.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }

    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim()
      continue
    }

    if (line.startsWith('branch ')) {
      currentBranchName = parseBranchNameFromRef(line.slice('branch '.length).trim())
    }
  }

  flush()
  return entries.sort((left, right) => compareBranchNames(left.branchName, right.branchName))
}

export function resolveExistingBranchTarget(
  repoPath: string,
  input: string,
  backend: RepositoryBackend = createNativeBackend()
): ExistingBranchTargetResolution {
  const branchName = input.trim()
  if (!branchName) {
    return { ok: true, target: null }
  }

  const remoteRefs = listRemoteBranchRefs(repoPath, backend)
  const exactRemoteRef = remoteRefs.find((remoteRef) => remoteRef === branchName)
  if (exactRemoteRef) {
    return {
      ok: true,
      target: {
        kind: 'remote',
        branchName: exactRemoteRef.replace(/^[^/]+\//u, ''),
        remoteRef: exactRemoteRef
      }
    }
  }

  if (branchExists(repoPath, branchName, backend)) {
    return {
      ok: true,
      target: {
        kind: 'local',
        branchName
      }
    }
  }

  const matchingRemoteRefs = remoteRefs.filter(
    (remoteRef) => remoteRef.replace(/^[^/]+\//u, '') === branchName
  )
  if (matchingRemoteRefs.length > 1) {
    return {
      ok: false,
      error: `Branch "${branchName}" matches multiple remote branches. Pick one from the dropdown instead.`
    }
  }

  if (matchingRemoteRefs.length === 1) {
    return {
      ok: true,
      target: {
        kind: 'remote',
        branchName,
        remoteRef: matchingRemoteRefs[0]
      }
    }
  }

  return { ok: true, target: null }
}

export function checkoutExistingBranch(
  repoPath: string,
  target: ExistingBranchTarget,
  backend: RepositoryBackend = createNativeBackend()
): void {
  if (target.kind === 'local') {
    runGit(repoPath, ['checkout', target.branchName], backend)
    return
  }

  if (branchExists(repoPath, target.branchName, backend)) {
    runGit(repoPath, ['checkout', target.branchName], backend)
    return
  }

  runGit(repoPath, ['checkout', '-b', target.branchName, target.remoteRef], backend)
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
    primaryBranch: getPrimaryBranch(repositoryPath, repository.backend),
    branchOptions: listRepositoryBranchOptions(repositoryPath, repository.backend),
    worktreeOptions: listRepositoryWorktrees(repositoryPath, repository.backend)
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
