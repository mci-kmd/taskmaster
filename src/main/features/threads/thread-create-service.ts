import type {
  CreateThreadInput,
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  ThreadMode,
  ThreadSetup
} from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'
import { resolveThreadSetupMode } from '../../../shared/thread-setup'
import { runGit } from '../../backends/git-client'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import {
  checkoutExistingBranch,
  getCurrentBranchLabel,
  getCurrentBranchName,
  getPrimaryBranch,
  hasUncommittedChanges,
  listRepositoryWorktrees,
  resolveExistingBranchTarget
} from '../repositories/repository-git'
import { fallbackBranchName, uniqueBranchName } from './thread-branch-name'
import { normalizeCustomTitle } from './thread-values'
import {
  cleanupFailedWorktree,
  createWorktree,
  resolveBaseRef,
  runNewWorktreeSetupCommand,
  WorktreeCreationError
} from './thread-worktree-utils'

type Checkout = Pick<
  PersistedThread,
  'mode' | 'branchName' | 'worktreePath' | 'ownsBranch' | 'ownsWorktree'
>

type CheckoutRequest = {
  mode: ThreadMode
  branchName?: string
  useCurrentBranch?: boolean
}

type CheckoutResult = { ok: true; checkout: Checkout } | { ok: false; error: string }

export type ThreadSetupResult =
  | { ok: true; /** Whether the thread now works in a different directory. */ cwdChanged: boolean }
  | { ok: false; error: string }

function createThreadRecord(
  dependencies: {
    createId: () => string
    nowIso: () => string
  },
  repositoryId: string,
  customTitle: string | null,
  checkout: Checkout
): PersistedThread {
  const createdAt = dependencies.nowIso()
  return {
    id: dependencies.createId(),
    repositoryId,
    customTitle,
    latestCopilotTitle: null,
    lastUserMessage: null,
    ...checkout,
    resumeSessionId: null,
    createdAt,
    lastActivityAt: createdAt
  }
}

const failed = (error: string): CheckoutResult => ({ ok: false, error })
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Makes the checkout a thread asks for: a worktree, an existing branch, or a new branch. */
function setUpCheckout(repository: PersistedRepository, input: CheckoutRequest): CheckoutResult {
  const repositoryPath = getRepositoryExecutionPath(repository)

  if (input.mode === 'worktree') {
    const branchName = input.branchName?.trim()
    if (!branchName) {
      return failed('Branch name is required for worktree threads.')
    }

    const existingWorktree = listRepositoryWorktrees(repositoryPath, repository.backend).find(
      (item) => item.branchName === branchName
    )
    if (existingWorktree) {
      return {
        ok: true,
        checkout: {
          mode: 'worktree',
          branchName: existingWorktree.branchName,
          worktreePath: existingWorktree.path,
          ownsBranch: false,
          ownsWorktree: false
        }
      }
    }

    const branchResolution = resolveExistingBranchTarget(
      repositoryPath,
      branchName,
      repository.backend
    )
    if (!branchResolution.ok) {
      return failed(branchResolution.error)
    }
    if (branchResolution.target) {
      return failed(
        `Cannot create a worktree thread for existing branch "${branchName}" because it is not an existing worktree.`
      )
    }

    const baseResolution = resolveBaseRef(
      repositoryPath,
      input.useCurrentBranch,
      repository.backend
    )
    if (!baseResolution.ok) {
      return failed(baseResolution.error)
    }

    let worktreePath: string
    try {
      worktreePath = createWorktree(
        repositoryPath,
        branchName,
        baseResolution.ref,
        repository.backend
      )
    } catch (error) {
      const creationError = message(error)
      if (!(error instanceof WorktreeCreationError)) {
        return failed(creationError)
      }

      try {
        cleanupFailedWorktree(
          { branchName, worktreePath: error.worktreePath },
          repositoryPath,
          repository.backend,
          {
            deleteBranch: error.ownsBranch,
            ownsWorktreePath: true
          }
        )
      } catch (cleanupError) {
        return failed(
          `Worktree creation failed: ${creationError} Cleanup also failed: ${message(cleanupError)}`
        )
      }

      return failed(`Worktree creation failed: ${creationError}`)
    }

    try {
      runNewWorktreeSetupCommand(repository, { branchName, worktreePath })
    } catch (error) {
      const setupError = message(error)
      let cleanupError: string | null = null

      try {
        cleanupFailedWorktree({ branchName, worktreePath }, repositoryPath, repository.backend, {
          deleteBranch: true,
          ownsWorktreePath: true
        })
      } catch (cleanupFailure) {
        cleanupError = message(cleanupFailure)
      }

      return failed(
        cleanupError
          ? `New worktree setup script failed: ${setupError} Cleanup also failed: ${cleanupError}`
          : `New worktree setup script failed: ${setupError}`
      )
    }

    return {
      ok: true,
      checkout: { mode: 'worktree', branchName, worktreePath, ownsBranch: true, ownsWorktree: true }
    }
  }

  const requestedBranchName = input.branchName?.trim()
  if (!requestedBranchName) {
    return {
      ok: true,
      checkout: {
        mode: 'active-branch',
        branchName: getCurrentBranchLabel(repositoryPath, repository.backend),
        worktreePath: null,
        ownsBranch: false,
        ownsWorktree: false
      }
    }
  }

  const branchResolution = resolveExistingBranchTarget(
    repositoryPath,
    requestedBranchName,
    repository.backend
  )
  if (!branchResolution.ok) {
    return failed(branchResolution.error)
  }

  const currentBranchName = getCurrentBranchName(repositoryPath, repository.backend)
  const currentBranchLabel = getCurrentBranchLabel(repositoryPath, repository.backend)
  const targetBranchName = branchResolution.target?.branchName ?? requestedBranchName
  const switchingBranches = currentBranchName !== targetBranchName

  if (switchingBranches && hasUncommittedChanges(repositoryPath, repository.backend)) {
    return failed(
      `Cannot switch from "${currentBranchLabel}" to "${targetBranchName}" because the current branch has uncommitted changes. Commit or stash them first.`
    )
  }

  if (branchResolution.target) {
    try {
      if (switchingBranches) {
        checkoutExistingBranch(repositoryPath, branchResolution.target, repository.backend)
      }
    } catch (error) {
      return failed(message(error))
    }

    return {
      ok: true,
      checkout: {
        mode: 'active-branch',
        branchName: targetBranchName,
        worktreePath: null,
        ownsBranch: false,
        ownsWorktree: false
      }
    }
  }

  const baseResolution = resolveBaseRef(repositoryPath, input.useCurrentBranch, repository.backend)
  if (!baseResolution.ok) {
    return failed(baseResolution.error)
  }

  try {
    runGit(
      repositoryPath,
      ['checkout', '-b', requestedBranchName, baseResolution.ref],
      repository.backend
    )
  } catch (error) {
    return failed(message(error))
  }

  return {
    ok: true,
    checkout: {
      mode: 'new-branch',
      branchName: requestedBranchName,
      worktreePath: null,
      ownsBranch: true,
      ownsWorktree: false
    }
  }
}

/** Whether a new branch by this name would clash with a branch or worktree. */
function isBranchNameTaken(repository: PersistedRepository, name: string): boolean {
  const repositoryPath = getRepositoryExecutionPath(repository)
  if (
    listRepositoryWorktrees(repositoryPath, repository.backend).some(
      (worktree) => worktree.branchName === name
    )
  )
    return true
  const resolution = resolveExistingBranchTarget(repositoryPath, name, repository.backend)
  return !resolution.ok || Boolean(resolution.target)
}

export function createThreadCreateService(dependencies: {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads' | 'ui' | 'settings'>
  updateSelection: (repositoryId: string | null, threadId: string | null) => void
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  nowIso: () => string
  createId: () => string
  /** Writes a branch name for a thread from its first prompt. */
  generateBranchName?: (request: {
    repository: PersistedRepository
    cwd: string
    prompt: string
  }) => Promise<string | null>
  /** Called after a thread's checkout is made. */
  onThreadSetUp?: (threadId: string) => void
}): {
  createThread: (input: CreateThreadInput) => MutationResult
  /** Makes the checkout a new thread's options ask for; a no-op once it is set up. */
  finishThreadSetup: (threadId: string, prompt: string) => Promise<ThreadSetupResult>
  isThreadSettingUp: (threadId: string) => boolean
} {
  const settingUp = new Map<string, Promise<ThreadSetupResult>>()

  const addThread = (thread: PersistedThread): MutationResult => {
    const state = dependencies.ensureState()
    state.threads.push(thread)
    dependencies.updateSelection(thread.repositoryId, thread.id)
    dependencies.saveState()
    return dependencies.successResult()
  }

  const resolveBranchName = async (
    repository: PersistedRepository,
    setup: ThreadSetup,
    prompt: string
  ): Promise<string> => {
    if (setup.branchName) return setup.branchName
    let name: string | null = null
    try {
      name =
        (await dependencies.generateBranchName?.({
          repository,
          cwd: getRepositoryExecutionPath(repository),
          prompt
        })) ?? null
    } catch (error) {
      console.warn('Could not generate a branch name:', error)
    }
    return uniqueBranchName(name ?? fallbackBranchName(prompt), (candidate) =>
      isBranchNameTaken(repository, candidate)
    )
  }

  const setUp = async (threadId: string, prompt: string): Promise<ThreadSetupResult> => {
    const state = dependencies.ensureState()
    const pending = state.threads.find((item) => item.id === threadId)
    const setup = pending?.pendingSetup
    if (!pending || !setup) return { ok: true, cwdChanged: false }
    const repository = state.repositories.find((item) => item.id === pending.repositoryId)
    if (!repository) return { ok: false, error: 'Repository not found.' }
    const repositoryPath = getRepositoryExecutionPath(repository)
    const primaryBranch = getPrimaryBranch(repositoryPath, repository.backend)

    const request: CheckoutRequest =
      setup.mode === 'trunk'
        ? { mode: 'active-branch', branchName: primaryBranch ?? undefined }
        : {
            mode: setup.mode === 'worktree' ? 'worktree' : 'active-branch',
            branchName: await resolveBranchName(repository, setup, prompt),
            // Without a known primary branch, new branches start from the current one.
            useCurrentBranch: primaryBranch === null
          }

    // The thread may have been closed while its branch was named.
    const thread = dependencies.ensureState().threads.find((item) => item.id === threadId)
    if (!thread?.pendingSetup) return { ok: false, error: 'Thread not found.' }
    const result = setUpCheckout(repository, request)
    if (!result.ok) return result

    const cwdChanged = result.checkout.worktreePath !== thread.worktreePath
    Object.assign(thread, result.checkout)
    delete thread.pendingSetup
    if (cwdChanged) {
      // The session so far ran elsewhere; the thread starts a new one in its own checkout.
      thread.resumeSessionId = null
      delete thread.aside
    }
    dependencies.saveState()
    dependencies.onThreadSetUp?.(threadId)
    return { ok: true, cwdChanged }
  }

  return {
    createThread: (input: CreateThreadInput): MutationResult => {
      const state = dependencies.ensureState()
      const repository = state.repositories.find((item) => item.id === input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const customTitle = normalizeCustomTitle(input.title)

      if (isGeneralProject(repository)) {
        return addThread(
          createThreadRecord(dependencies, repository.id, customTitle, {
            mode: 'active-branch',
            branchName: '',
            worktreePath: null,
            ownsBranch: false,
            ownsWorktree: false
          })
        )
      }

      if (!input.mode) {
        const repositoryPath = getRepositoryExecutionPath(repository)
        return addThread({
          ...createThreadRecord(dependencies, repository.id, customTitle, {
            mode: 'active-branch',
            branchName: getCurrentBranchLabel(repositoryPath, repository.backend),
            worktreePath: null,
            ownsBranch: false,
            ownsWorktree: false
          }),
          pendingSetup: {
            mode: resolveThreadSetupMode(state.settings, repository),
            branchName: null
          }
        })
      }

      const result = setUpCheckout(repository, {
        mode: input.mode,
        branchName: input.branchName,
        useCurrentBranch: input.useCurrentBranch
      })
      if (!result.ok) {
        return dependencies.failureResult(result.error)
      }
      return addThread(
        createThreadRecord(dependencies, repository.id, customTitle, result.checkout)
      )
    },

    finishThreadSetup: (threadId, prompt) => {
      const running = settingUp.get(threadId)
      if (running) return running
      const operation = setUp(threadId, prompt)
        .catch((error): ThreadSetupResult => ({ ok: false, error: message(error) }))
        .finally(() => settingUp.delete(threadId))
      settingUp.set(threadId, operation)
      return operation
    },

    isThreadSettingUp: (threadId) => settingUp.has(threadId)
  }
}
