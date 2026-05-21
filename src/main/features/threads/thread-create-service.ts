import type {
  CreateThreadInput,
  MutationResult,
  PersistedAppState,
  PersistedThread
} from '../../../shared/app-types'
import { runGit } from '../../backends/git-client'
import { getRepositoryExecutionPath } from '../../backends/repository-backend'
import {
  branchExists,
  getCurrentBranchLabel,
  hasUncommittedChanges
} from '../repositories/repository-git'
import { buildThreadSessionName, normalizeCustomTitle } from './thread-values'
import {
  createWorktree,
  resolveBaseRef,
  runNewWorktreeSetupCommand,
  removeWorktree
} from './thread-worktree-utils'

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

      const createdAt = dependencies.nowIso()
      const customTitle = normalizeCustomTitle(input.title)
      const repositoryPath = getRepositoryExecutionPath(repository)

      if (input.mode === 'worktree') {
        const branchName = input.branchName?.trim()
        if (!branchName) {
          return dependencies.failureResult('Branch name is required for worktree threads.')
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
            removeWorktree({ branchName, worktreePath }, repositoryPath, repository.backend, true)
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

        const thread: PersistedThread = {
          id: dependencies.createId(),
          repositoryId: repository.id,
          customTitle,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'worktree',
          branchName,
          worktreePath,
          sessionName: buildThreadSessionName(repository.name, dependencies.createId),
          resumeSessionId: null,
          createdAt,
          lastActivityAt: createdAt,
          hasLaunched: false
        }

        state.threads.push(thread)
        dependencies.updateSelection(repository.id, thread.id)
        dependencies.saveState()
        return dependencies.successResult()
      }

      if (input.mode === 'new-branch') {
        const branchName = input.branchName?.trim()
        if (!branchName) {
          return dependencies.failureResult('Branch name is required for new-branch threads.')
        }

        if (branchExists(repositoryPath, branchName, repository.backend)) {
          return dependencies.failureResult(`Branch "${branchName}" already exists.`)
        }

        if (hasUncommittedChanges(repositoryPath, repository.backend)) {
          return dependencies.failureResult(
            'Working tree has uncommitted changes. Commit or stash them before creating a new-branch thread.'
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

        try {
          runGit(
            repositoryPath,
            ['checkout', '-b', branchName, baseResolution.ref],
            repository.backend
          )
        } catch (error) {
          return dependencies.failureResult(error instanceof Error ? error.message : String(error))
        }

        const thread: PersistedThread = {
          id: dependencies.createId(),
          repositoryId: repository.id,
          customTitle,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'new-branch',
          branchName,
          worktreePath: null,
          sessionName: buildThreadSessionName(repository.name, dependencies.createId),
          resumeSessionId: null,
          createdAt,
          lastActivityAt: createdAt,
          hasLaunched: false
        }

        state.threads.push(thread)
        dependencies.updateSelection(repository.id, thread.id)
        dependencies.saveState()
        return dependencies.successResult()
      }

      const thread: PersistedThread = {
        id: dependencies.createId(),
        repositoryId: repository.id,
        customTitle,
        latestCopilotTitle: null,
        lastUserMessage: null,
        mode: 'active-branch',
        branchName: getCurrentBranchLabel(repositoryPath, repository.backend),
        worktreePath: null,
        sessionName: buildThreadSessionName(repository.name, dependencies.createId),
        resumeSessionId: null,
        createdAt,
        lastActivityAt: createdAt,
        hasLaunched: false
      }

      state.threads.push(thread)
      dependencies.updateSelection(repository.id, thread.id)
      dependencies.saveState()
      return dependencies.successResult()
    }
  }
}
