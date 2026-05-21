import type {
  PersistedRepository,
  PersistedThread,
  RepositoryBackend
} from '../../../shared/app-types'
import { runGit } from '../../backends/git-client'
import {
  backendPathExists,
  createNativeBackend,
  getBasename,
  getDirname,
  getRepositoryExecutionPath,
  joinPath,
  mkdirBackend,
  pathForDisplay,
  spawnSyncBackendCommand
} from '../../backends/repository-backend'
import { buildScriptCommand } from '../../terminal'
import { normalizeRepositoryScript } from '../repositories/repository-values'
import {
  branchExists,
  getPrimaryBranch,
  getProtectedBranchDeletionError
} from '../repositories/repository-git'

const WORKTREES_DIR_SUFFIX = '.worktrees'
const BRANCH_NAME_TOKEN = '{BRANCH-NAME}'
const BRANCH_NAME_SAFE_TOKEN = '{BRANCH-NAME-SAFE}'
const BRANCH_PORT_TOKEN = '{BRANCH-PORT}'
const BRANCH_PORT_MIN = 20_000
const BRANCH_PORT_SPAN = 20_000

export type BaseRefResolution = { ok: true; ref: string } | { ok: false; error: string }

function sanitizeWorktreeName(branchName: string): string {
  const sanitized = branchName
    .trim()
    .split('')
    .map((character) => {
      const codePoint = character.charCodeAt(0)
      return '<>:"/\\|?*'.includes(character) || codePoint < 32 ? '-' : character
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return sanitized || 'worktree'
}

function sanitizeBranchTokenValue(branchName: string): string {
  const normalized = branchName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return normalized || 'branch'
}

function computeDeterministicBranchPort(repositoryPath: string, branchName: string): string {
  const seed = `${repositoryPath}\u0000${branchName}`
  let hash = 2_166_136_261

  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }

  return String(BRANCH_PORT_MIN + ((hash >>> 0) % BRANCH_PORT_SPAN))
}

export function applyThreadBranchTokens(
  command: string,
  repository: Pick<PersistedRepository, 'path' | 'backend'>,
  thread: Pick<PersistedThread, 'branchName'>
): string {
  const repositoryPath = getRepositoryExecutionPath(repository)
  return command
    .split(BRANCH_PORT_TOKEN)
    .join(computeDeterministicBranchPort(repositoryPath, thread.branchName))
    .split(BRANCH_NAME_SAFE_TOKEN)
    .join(sanitizeBranchTokenValue(thread.branchName))
    .split(BRANCH_NAME_TOKEN)
    .join(thread.branchName)
}

function deriveWorktreePath(
  repoPath: string,
  branchName: string,
  backend: RepositoryBackend = createNativeBackend()
): string {
  const repoParent = getDirname(repoPath, backend)
  const repoName = getBasename(repoPath, backend)
  const worktreesDir = joinPath(backend, repoParent, `${repoName}${WORKTREES_DIR_SUFFIX}`)
  const baseName = sanitizeWorktreeName(branchName)

  let candidate = joinPath(backend, worktreesDir, baseName)
  let suffix = 2

  while (backendPathExists(backend, candidate)) {
    candidate = joinPath(backend, worktreesDir, `${baseName}-${suffix}`)
    suffix += 1
  }

  return candidate
}

function runThreadBranchScript(
  script: string,
  repository: Pick<PersistedRepository, 'path' | 'backend'>,
  thread: Pick<PersistedThread, 'branchName'>,
  cwd: string
): void {
  const resolvedScript = applyThreadBranchTokens(script, repository, thread)
  const command = buildScriptCommand(resolvedScript, repository.backend)
  const result = spawnSyncBackendCommand(repository.backend, command, {
    cwd,
    encoding: 'utf8'
  })

  if (result.error) {
    throw result.error
  }

  if (!result.ok) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `Script exited with code ${result.status ?? 'unknown'}.`
    throw new Error(detail)
  }
}

export function resolveBaseRef(
  repoPath: string,
  useCurrentBranch: boolean | undefined,
  backend: RepositoryBackend = createNativeBackend()
): BaseRefResolution {
  if (useCurrentBranch) {
    return { ok: true, ref: 'HEAD' }
  }

  const primary = getPrimaryBranch(repoPath, backend)
  if (!primary) {
    return {
      ok: false,
      error:
        'Could not determine the primary branch (no origin/HEAD, main, or master found). Tick "Use current branch" to base off HEAD instead.'
    }
  }

  return { ok: true, ref: primary }
}

export function createWorktree(
  repoPath: string,
  branchName: string,
  baseRef: string,
  backend: RepositoryBackend = createNativeBackend()
): string {
  if (branchExists(repoPath, branchName, backend)) {
    throw new Error(`Branch "${branchName}" already exists.`)
  }

  const worktreePath = deriveWorktreePath(repoPath, branchName, backend)
  mkdirBackend(backend, getDirname(worktreePath, backend))
  runGit(repoPath, ['worktree', 'add', '-b', branchName, worktreePath, baseRef], backend)
  return worktreePath
}

export function removeWorktree(
  thread: Pick<PersistedThread, 'branchName' | 'worktreePath'>,
  repositoryPath: string,
  backend: RepositoryBackend,
  force: boolean
): void {
  const protectedBranchError = getProtectedBranchDeletionError(
    repositoryPath,
    thread.branchName,
    backend
  )
  if (protectedBranchError) {
    throw new Error(protectedBranchError)
  }

  if (thread.worktreePath && backendPathExists(backend, thread.worktreePath, 'directory')) {
    const args = ['worktree', 'remove']
    if (force) {
      args.push('--force')
    }

    args.push(thread.worktreePath)
    runGit(repositoryPath, args, backend)
  }

  if (branchExists(repositoryPath, thread.branchName, backend)) {
    runGit(repositoryPath, ['branch', '-D', thread.branchName], backend)
  }
}

export function shouldSkipWorktreeGitCleanup(
  thread: Pick<PersistedThread, 'branchName' | 'worktreePath'>,
  repositoryPath: string,
  backend: RepositoryBackend
): boolean {
  return (
    !thread.worktreePath ||
    !backendPathExists(backend, thread.worktreePath, 'directory') ||
    !branchExists(repositoryPath, thread.branchName, backend)
  )
}

export function runPostWorktreeRemoveCommand(
  repository: Pick<PersistedRepository, 'path' | 'backend' | 'postWorktreeRemoveCommand'>,
  thread: Pick<PersistedThread, 'branchName'>
): void {
  const script = normalizeRepositoryScript(repository.postWorktreeRemoveCommand)
  if (!script) {
    return
  }

  runThreadBranchScript(script, repository, thread, getRepositoryExecutionPath(repository))
}

export function runNewWorktreeSetupCommand(
  repository: Pick<PersistedRepository, 'path' | 'backend' | 'newWorktreeSetupCommand'>,
  thread: Pick<PersistedThread, 'branchName' | 'worktreePath'>
): void {
  const script = normalizeRepositoryScript(repository.newWorktreeSetupCommand)
  if (!script) {
    return
  }

  if (!thread.worktreePath) {
    throw new Error('Worktree path missing.')
  }

  if (!backendPathExists(repository.backend, thread.worktreePath, 'directory')) {
    throw new Error(
      `Working directory not found: ${pathForDisplay(thread.worktreePath, repository.backend)}`
    )
  }

  runThreadBranchScript(script, repository, thread, thread.worktreePath)
}
