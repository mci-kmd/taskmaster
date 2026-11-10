import type {
  MoveThreadCheckoutInput,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositoryBackend,
  ThreadCheckoutMoveKind
} from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'
import { threadDisplayName } from '../../../shared/thread-title'
import { runGit, tryGit } from '../../backends/git-client'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import {
  branchExists,
  checkoutExistingBranch,
  getCurrentBranchName,
  getPrimaryBranch,
  isDirtyGitPath,
  listRepositoryWorktrees,
  resolveExistingBranchTarget
} from '../repositories/repository-git'
import { fallbackBranchName, uniqueBranchName } from './thread-branch-name'
import { findCheckoutDrift } from './thread-checkout-drift'
import { isBranchNameTaken } from './thread-create-service'
import { getThreadExecutionCwd } from './thread-paths'
import {
  cleanupFailedWorktree,
  createWorktree,
  createWorktreeForExistingBranch,
  runNewWorktreeSetupCommand,
  WorktreeCreationError
} from './thread-worktree-utils'

export type ThreadCheckoutMove = {
  kind: ThreadCheckoutMoveKind
  branchName: string
  previousCwd: string
  cwd: string
  /** `adopted` takes over a branch or worktree the checkout or another tool already made. */
  outcome: 'created' | 'existing' | 'adopted'
  /** Whether uncommitted changes moved along with the thread. */
  carriedChanges: boolean
  /** Whether uncommitted changes stayed behind in the project's checkout. */
  leftChanges: boolean
}

export type ThreadCheckoutMoveResult =
  ({ ok: true } & ThreadCheckoutMove) | { ok: false; error: string }

type Context = {
  thread: PersistedThread
  repository: PersistedRepository
  repositoryPath: string
  backend: RepositoryBackend
  primaryBranch: string
  /** Other threads working in the project's checkout. */
  sharing: PersistedThread[]
  /** A branch the checkout already switched to for this thread. */
  drift: string | null
}

const failed = (error: string): ThreadCheckoutMoveResult => ({ ok: false, error })
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function stashTip(cwd: string, backend: RepositoryBackend): string | null {
  const result = tryGit(cwd, ['rev-parse', '-q', '--verify', 'refs/stash'], backend)
  return result.ok && result.stdout ? result.stdout.trim() : null
}

/** `stash@{n}` for a stash commit; `stash drop` and `stash pop` need that form. */
function stashRef(cwd: string, sha: string, backend: RepositoryBackend): string | null {
  const result = tryGit(cwd, ['stash', 'list', '--format=%H'], backend)
  if (!result.ok) return null
  const index = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .indexOf(sha)
  return index < 0 ? null : `stash@{${index}}`
}

/** Stashes tracked and untracked changes; returns the stash commit, or null when clean. */
function stashChanges(cwd: string, label: string, backend: RepositoryBackend): string | null {
  const before = stashTip(cwd, backend)
  runGit(cwd, ['stash', 'push', '--include-untracked', '-m', label], backend)
  const after = stashTip(cwd, backend)
  return after && after !== before ? after : null
}

function restoreStash(cwd: string, sha: string, backend: RepositoryBackend): string | null {
  const ref = stashRef(cwd, sha, backend)
  const pop = ref ? tryGit(cwd, ['stash', 'pop', '--index', ref], backend) : null
  if (pop?.ok) return null
  return `Your uncommitted changes are kept in stash ${sha}; restore them with "git stash apply ${sha}".`
}

function isValidBranchName(cwd: string, name: string, backend: RepositoryBackend): boolean {
  return !name.startsWith('-') && tryGit(cwd, ['check-ref-format', '--branch', name], backend).ok
}

/**
 * Moves a thread off the primary branch to a branch of its own, in the project's checkout or in
 * a new worktree, carrying its uncommitted changes along.
 */
export function createThreadCheckoutMoveService(dependencies: {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads'>
  saveState: () => void
  isCommitting: (threadId: string) => boolean
  isWorking: (threadId: string) => boolean
  isRunCommandRunning: (threadId: string) => boolean
  /** Writes a branch name from the thread's conversation. */
  generateBranchName?: (request: {
    repository: PersistedRepository
    cwd: string
    prompt: string
  }) => Promise<string | null>
}): {
  moveThreadCheckout: (input: MoveThreadCheckoutInput) => Promise<ThreadCheckoutMoveResult>
} {
  const moving = new Set<string>()

  const resolveContext = (
    threadId: string,
    kind: ThreadCheckoutMoveKind
  ): { ok: true; context: Context } | { ok: false; error: string } => {
    const state = dependencies.ensureState()
    const thread = state.threads.find((item) => item.id === threadId)
    if (!thread) return { ok: false, error: 'Thread not found.' }
    const repository = state.repositories.find((item) => item.id === thread.repositoryId)
    if (!repository) return { ok: false, error: 'Owning repository not found.' }
    if (isGeneralProject(repository))
      return { ok: false, error: `Threads in ${repository.name} are not tied to a repository.` }
    if (thread.pendingSetup)
      return {
        ok: false,
        error: 'This thread has no checkout yet. Pick a branch or worktree below its message box.'
      }
    if (thread.mode === 'worktree')
      return {
        ok: false,
        error: `This thread already works in its own worktree on "${thread.branchName}".`
      }

    const repositoryPath = getRepositoryExecutionPath(repository)
    const backend = repository.backend
    const primaryBranch = getPrimaryBranch(repositoryPath, backend)
    if (!primaryBranch)
      return { ok: false, error: 'Could not determine the primary branch of this project.' }
    if (thread.branchName !== primaryBranch)
      return {
        ok: false,
        error: `Only threads on the primary branch "${primaryBranch}" can move. This thread works on "${thread.branchName}".`
      }

    const projectThreads = state.threads.filter((item) => item.repositoryId === repository.id)
    const liveBranch = getCurrentBranchName(repositoryPath, backend)
    const drift = findCheckoutDrift({ thread, threads: projectThreads, primaryBranch, liveBranch })
    if (liveBranch !== primaryBranch && !(drift && kind === 'branch')) {
      return {
        ok: false,
        error: !liveBranch
          ? `The project's checkout is not on a branch. Switch it back to "${primaryBranch}" first.`
          : drift
            ? `The project's checkout already switched to "${drift}". Move with kind "branch" and branch name "${drift}" to keep working there, or switch it back to "${primaryBranch}" first.`
            : `The project's checkout is on "${liveBranch}", which belongs to another thread. Switch it back to "${primaryBranch}" first.`
      }
    }

    if (dependencies.isCommitting(thread.id))
      return { ok: false, error: 'Wait for the commit to finish before moving the thread.' }
    if (dependencies.isRunCommandRunning(thread.id))
      return {
        ok: false,
        error: "Stop the thread's run command first; it runs in the current checkout."
      }
    const sharing = projectThreads.filter(
      (item) => item.id !== thread.id && item.mode !== 'worktree'
    )
    if (sharing.some((item) => dependencies.isCommitting(item.id)))
      return {
        ok: false,
        error: "Another thread is committing in the project's checkout. Try again when it finishes."
      }

    return {
      ok: true,
      context: { thread, repository, repositoryPath, backend, primaryBranch, sharing, drift }
    }
  }

  const resolveBranchName = async (
    context: Context,
    requested: string | null
  ): Promise<{ ok: true; name: string } | { ok: false; error: string }> => {
    const { repository, repositoryPath, backend, primaryBranch, thread } = context
    if (requested) {
      if (requested === primaryBranch)
        return {
          ok: false,
          error: `Pick a branch other than the primary branch "${primaryBranch}".`
        }
      if (!isValidBranchName(repositoryPath, requested, backend))
        return { ok: false, error: `"${requested}" is not a valid branch name.` }
      return { ok: true, name: requested }
    }

    const prompt =
      thread.lastUserMessage ?? thread.customTitle ?? thread.latestCopilotTitle ?? thread.id
    let generated: string | null = null
    try {
      generated =
        (await dependencies.generateBranchName?.({
          repository,
          cwd: repositoryPath,
          prompt
        })) ?? null
    } catch (error) {
      console.warn('Could not generate a branch name:', error)
    }
    const name = uniqueBranchName(
      generated ?? fallbackBranchName(prompt),
      (candidate) => candidate === primaryBranch || isBranchNameTaken(repository, candidate)
    )
    return { ok: true, name }
  }

  const isDirty = (context: Context): boolean => {
    try {
      return isDirtyGitPath(context.repositoryPath, context.backend)
    } catch {
      return false
    }
  }

  const moveToBranch = (context: Context, name: string): ThreadCheckoutMoveResult => {
    const { thread, repository, repositoryPath, backend, primaryBranch } = context
    const previousCwd = getThreadExecutionCwd(thread, repository)

    if (context.drift) {
      if (name !== context.drift)
        return failed(
          `The project's checkout already switched to "${context.drift}". Move to "${context.drift}" or switch the checkout back to "${primaryBranch}" first.`
        )
      thread.mode = 'active-branch'
      thread.branchName = context.drift
      thread.worktreePath = null
      thread.ownsBranch = false
      thread.ownsWorktree = false
      dependencies.saveState()
      return {
        ok: true,
        kind: 'branch',
        branchName: context.drift,
        previousCwd,
        cwd: previousCwd,
        outcome: 'adopted',
        carriedChanges: false,
        leftChanges: false
      }
    }

    const others = context.sharing.filter((item) => !item.settledAt && !item.pendingSetup)
    if (others.length > 0) {
      const names = others
        .slice(0, 3)
        .map((item) => `"${threadDisplayName(item)}"`)
        .join(', ')
      return failed(
        `Other threads also work in the project's checkout (${names}${others.length > 3 ? ', …' : ''}); switching its branch would move them too. Move to a worktree instead.`
      )
    }

    const worktree = listRepositoryWorktrees(repositoryPath, backend).find(
      (item) => item.branchName === name
    )
    if (worktree)
      return failed(
        `Branch "${name}" is checked out in the worktree at ${worktree.path}. Move with kind "worktree" to work there.`
      )

    const resolution = resolveExistingBranchTarget(repositoryPath, name, backend)
    if (!resolution.ok) return failed(resolution.error)
    const carriedChanges = isDirty(context)
    try {
      if (resolution.target) checkoutExistingBranch(repositoryPath, resolution.target, backend)
      else runGit(repositoryPath, ['checkout', '-b', name], backend)
    } catch (error) {
      return failed(`Could not switch to "${name}": ${message(error)}`)
    }

    const branchName = resolution.target?.branchName ?? name
    const created = !resolution.target
    thread.mode = created ? 'new-branch' : 'active-branch'
    thread.branchName = branchName
    thread.worktreePath = null
    thread.ownsBranch = created
    thread.ownsWorktree = false
    dependencies.saveState()
    return {
      ok: true,
      kind: 'branch',
      branchName,
      previousCwd,
      cwd: previousCwd,
      outcome: created ? 'created' : 'existing',
      carriedChanges,
      leftChanges: false
    }
  }

  const moveToWorktree = (context: Context, name: string): ThreadCheckoutMoveResult => {
    const { thread, repository, repositoryPath, backend } = context
    const previousCwd = getThreadExecutionCwd(thread, repository)
    const dirty = isDirty(context)

    const existing = listRepositoryWorktrees(repositoryPath, backend).find(
      (item) => item.branchName === name
    )
    if (existing) {
      thread.mode = 'worktree'
      thread.branchName = existing.branchName
      thread.worktreePath = existing.path
      thread.ownsBranch = false
      thread.ownsWorktree = false
      dependencies.saveState()
      return {
        ok: true,
        kind: 'worktree',
        branchName: existing.branchName,
        previousCwd,
        cwd: existing.path,
        outcome: 'adopted',
        carriedChanges: false,
        leftChanges: dirty
      }
    }

    if (dirty) {
      const working = context.sharing.find((item) => dependencies.isWorking(item.id))
      if (working)
        return failed(
          `"${threadDisplayName(working)}" is working in the project's checkout, so its changes can't be told apart from this thread's. Try again when it finishes.`
        )
    }

    const resolution = resolveExistingBranchTarget(repositoryPath, name, backend)
    if (!resolution.ok) return failed(resolution.error)
    const branchName = resolution.target?.branchName ?? name
    let createdBranch = false
    let worktreePath: string | null = null
    let stash: string | null = null

    try {
      if (resolution.target) {
        if (
          resolution.target.kind === 'remote' &&
          !branchExists(repositoryPath, branchName, backend)
        ) {
          runGit(
            repositoryPath,
            ['branch', '--track', branchName, resolution.target.remoteRef],
            backend
          )
          createdBranch = true
        }
        worktreePath = createWorktreeForExistingBranch(repositoryPath, branchName, backend)
      } else {
        worktreePath = createWorktree(repositoryPath, branchName, 'HEAD', backend)
        createdBranch = true
      }
      if (dirty) {
        stash = stashChanges(repositoryPath, `taskmaster: move thread to ${branchName}`, backend)
        if (stash) runGit(worktreePath, ['stash', 'apply', '--index', stash], backend)
      }
      runNewWorktreeSetupCommand(repository, { branchName, worktreePath })
    } catch (error) {
      if (error instanceof WorktreeCreationError) {
        worktreePath ??= error.worktreePath
        createdBranch ||= error.ownsBranch
      }
      const rollbackErrors: string[] = []
      if (worktreePath) {
        try {
          cleanupFailedWorktree({ branchName, worktreePath }, repositoryPath, backend, {
            deleteBranch: createdBranch,
            ownsWorktreePath: true
          })
        } catch (cleanupError) {
          rollbackErrors.push(message(cleanupError))
        }
      } else if (createdBranch) {
        const deleted = tryGit(repositoryPath, ['branch', '-D', branchName], backend)
        if (!deleted.ok) rollbackErrors.push(deleted.stderr || `Could not delete "${branchName}".`)
      }
      if (stash) {
        const restoreError = restoreStash(repositoryPath, stash, backend)
        if (restoreError) rollbackErrors.push(restoreError)
      }
      return failed(
        rollbackErrors.length > 0
          ? `Moving to a worktree failed: ${message(error)} Rollback also failed: ${rollbackErrors.join(' ')}`
          : `Moving to a worktree failed: ${message(error)}`
      )
    }

    if (stash) {
      const ref = stashRef(repositoryPath, stash, backend)
      if (ref) tryGit(repositoryPath, ['stash', 'drop', ref], backend)
    }
    thread.mode = 'worktree'
    thread.branchName = branchName
    thread.worktreePath = worktreePath
    thread.ownsBranch = createdBranch && !resolution.target
    thread.ownsWorktree = true
    dependencies.saveState()
    return {
      ok: true,
      kind: 'worktree',
      branchName,
      previousCwd,
      cwd: worktreePath,
      outcome: resolution.target ? 'existing' : 'created',
      carriedChanges: Boolean(stash),
      leftChanges: false
    }
  }

  const move = async (input: MoveThreadCheckoutInput): Promise<ThreadCheckoutMoveResult> => {
    const first = resolveContext(input.threadId, input.kind)
    if (!first.ok) return first
    const requested = input.branchName?.trim() || first.context.drift || null
    const name = await resolveBranchName(first.context, requested)
    if (!name.ok) return name
    // Naming can take a while; the thread or checkout may have changed meanwhile.
    const resolved = requested ? first : resolveContext(input.threadId, input.kind)
    if (!resolved.ok) return resolved
    return input.kind === 'branch'
      ? moveToBranch(resolved.context, name.name)
      : moveToWorktree(resolved.context, name.name)
  }

  return {
    moveThreadCheckout: async (input) => {
      if (input.kind !== 'branch' && input.kind !== 'worktree')
        return failed('Kind must be "branch" or "worktree".')
      const thread = dependencies.ensureState().threads.find((item) => item.id === input.threadId)
      const key = thread?.repositoryId ?? input.threadId
      if (moving.has(key))
        return failed('Another thread of this project is moving its checkout. Try again shortly.')
      moving.add(key)
      try {
        return await move(input)
      } finally {
        moving.delete(key)
      }
    }
  }
}
