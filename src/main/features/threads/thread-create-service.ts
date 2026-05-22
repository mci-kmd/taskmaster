import type {
  CreateThreadInput,
  MutationResult,
  PersistedAppState,
  PersistedThread,
  ThreadMode
} from '../../../shared/app-types'
import { runGit } from '../../backends/git-client'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import {
  checkoutExistingBranch,
  getCurrentBranchLabel,
  getCurrentBranchName,
  hasUncommittedChanges,
  listRepositoryWorktrees,
  resolveExistingBranchTarget
} from '../repositories/repository-git'
import { buildThreadSessionName, normalizeCustomTitle } from './thread-values'
import {
  createWorktree,
  resolveBaseRef,
  runNewWorktreeSetupCommand,
  removeWorktree
} from './thread-worktree-utils'

function createThreadRecord(
  dependencies: {
    createId: () => string
    nowIso: () => string
  },
  repositoryId: string,
  mode: ThreadMode,
  branchName: string,
  customTitle: string | null,
  worktreePath: string | null,
  repositoryName: string,
  ownership: {
    ownsBranch: boolean
    ownsWorktree: boolean
  }
): PersistedThread {
  const createdAt = dependencies.nowIso()
  return {
    id: dependencies.createId(),
    repositoryId,
    customTitle,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode,
    branchName,
    worktreePath,
    ownsBranch: ownership.ownsBranch,
    ownsWorktree: ownership.ownsWorktree,
    sessionName: buildThreadSessionName(repositoryName, dependencies.createId),
    resumeSessionId: null,
    createdAt,
    lastActivityAt: createdAt,
    hasLaunched: false
  }
}

export function createThreadCreateService(dependencies: {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads'>
  updateSelection: (repositoryId: string | null, threadId: string | null) => void
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  nowIso: () => string
  createId: () => string
}): {
  createThread: (input: CreateThreadInput) => MutationResult
} {
  return {
    createThread: (input: CreateThreadInput): MutationResult => {
      const state = dependencies.ensureState()
      const repository = state.repositories.find((item) => item.id === input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const customTitle = normalizeCustomTitle(input.title)
      const repositoryPath = getRepositoryExecutionPath(repository)

      if (input.mode === 'worktree') {
        const branchName = input.branchName?.trim()
        if (!branchName) {
          return dependencies.failureResult('Branch name is required for worktree threads.')
        }

        const existingWorktree = listRepositoryWorktrees(repositoryPath, repository.backend).find(
          (item) => item.branchName === branchName
        )
        if (existingWorktree) {
          const thread = createThreadRecord(
            dependencies,
            repository.id,
            'worktree',
            existingWorktree.branchName,
            customTitle,
            existingWorktree.path,
            repository.name,
            {
              ownsBranch: false,
              ownsWorktree: false
            }
          )

          state.threads.push(thread)
          dependencies.updateSelection(repository.id, thread.id)
          dependencies.saveState()
          return dependencies.successResult()
        }

        const branchResolution = resolveExistingBranchTarget(
          repositoryPath,
          branchName,
          repository.backend
        )
        if (!branchResolution.ok) {
          return dependencies.failureResult(branchResolution.error)
        }
        if (branchResolution.target) {
          return dependencies.failureResult(
            `Cannot create a worktree thread for existing branch "${branchName}" because it is not an existing worktree.`
          )
        }

        const baseResolution = resolveBaseRef(
          repositoryPath,
          input.useCurrentBranch,
          repository.backend
        )
        if (!baseResolution.ok) {
          return dependencies.failureResult(baseResolution.error)
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
          return dependencies.failureResult(error instanceof Error ? error.message : String(error))
        }

        try {
          runNewWorktreeSetupCommand(repository, { branchName, worktreePath })
        } catch (error) {
          const setupError = error instanceof Error ? error.message : String(error)
          let cleanupError: string | null = null

          try {
            removeWorktree(
              { branchName, worktreePath },
              repositoryPath,
              repository.backend,
              true,
              true
            )
          } catch (cleanupFailure) {
            cleanupError =
              cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure)
          }

          return dependencies.failureResult(
            cleanupError
              ? `New worktree setup script failed: ${setupError} Cleanup also failed: ${cleanupError}`
              : `New worktree setup script failed: ${setupError}`
          )
        }

        const thread = createThreadRecord(
          dependencies,
          repository.id,
          'worktree',
          branchName,
          customTitle,
          worktreePath,
          repository.name,
          {
            ownsBranch: true,
            ownsWorktree: true
          }
        )

        state.threads.push(thread)
        dependencies.updateSelection(repository.id, thread.id)
        dependencies.saveState()
        return dependencies.successResult()
      }

      const requestedBranchName = input.branchName?.trim()
      if (!requestedBranchName) {
        const currentBranchLabel = getCurrentBranchLabel(repositoryPath, repository.backend)
        const thread = createThreadRecord(
          dependencies,
          repository.id,
          'active-branch',
          currentBranchLabel,
          customTitle,
          null,
          repository.name,
          {
            ownsBranch: false,
            ownsWorktree: false
          }
        )

        state.threads.push(thread)
        dependencies.updateSelection(repository.id, thread.id)
        dependencies.saveState()
        return dependencies.successResult()
      }

      const branchResolution = resolveExistingBranchTarget(
        repositoryPath,
        requestedBranchName,
        repository.backend
      )
      if (!branchResolution.ok) {
        return dependencies.failureResult(branchResolution.error)
      }

      const currentBranchName = getCurrentBranchName(repositoryPath, repository.backend)
      const currentBranchLabel = getCurrentBranchLabel(repositoryPath, repository.backend)
      const targetBranchName = branchResolution.target?.branchName ?? requestedBranchName
      const switchingBranches = currentBranchName !== targetBranchName

      if (switchingBranches && hasUncommittedChanges(repositoryPath, repository.backend)) {
        return dependencies.failureResult(
          `Cannot switch from "${currentBranchLabel}" to "${targetBranchName}" because the current branch has uncommitted changes. Commit or stash them first.`
        )
      }

      if (branchResolution.target) {
        try {
          if (switchingBranches) {
            checkoutExistingBranch(repositoryPath, branchResolution.target, repository.backend)
          }
        } catch (error) {
          return dependencies.failureResult(error instanceof Error ? error.message : String(error))
        }

        const thread = createThreadRecord(
          dependencies,
          repository.id,
          'active-branch',
          targetBranchName,
          customTitle,
          null,
          repository.name,
          {
            ownsBranch: false,
            ownsWorktree: false
          }
        )

        state.threads.push(thread)
        dependencies.updateSelection(repository.id, thread.id)
        dependencies.saveState()
        return dependencies.successResult()
      }

      const baseResolution = resolveBaseRef(
        repositoryPath,
        input.useCurrentBranch,
        repository.backend
      )
      if (!baseResolution.ok) {
        return dependencies.failureResult(baseResolution.error)
      }

      try {
        runGit(
          repositoryPath,
          ['checkout', '-b', requestedBranchName, baseResolution.ref],
          repository.backend
        )
      } catch (error) {
        return dependencies.failureResult(error instanceof Error ? error.message : String(error))
      }

      const thread = createThreadRecord(
        dependencies,
        repository.id,
        'new-branch',
        requestedBranchName,
        customTitle,
        null,
        repository.name,
        {
          ownsBranch: true,
          ownsWorktree: false
        }
      )

      state.threads.push(thread)
      dependencies.updateSelection(repository.id, thread.id)
      dependencies.saveState()
      return dependencies.successResult()
    }
  }
}
