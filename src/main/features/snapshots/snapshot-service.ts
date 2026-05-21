import type {
  AppSnapshot,
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositorySnapshot,
  ThreadSnapshot
} from '../../../shared/app-types'

export type BuildSnapshotOptions = {
  refreshGit?: boolean
}

type SnapshotServiceDependencies = {
  ensureState: () => PersistedAppState
  getRunningThreadIds: () => Set<string>
  getRunningRunThreadIds: () => Set<string>
  getRepositoryGitState: (
    repository: PersistedRepository,
    refreshGit: boolean
  ) => { currentBranch: string; primaryBranch: string | null }
  getThreadUiCwd: (
    thread: Pick<PersistedThread, 'mode' | 'worktreePath'>,
    repository: Pick<PersistedRepository, 'path' | 'backend'>
  ) => string
  getThreadExecutionCwd: (
    thread: Pick<PersistedThread, 'mode' | 'worktreePath'>,
    repository: Pick<PersistedRepository, 'path' | 'backend'>
  ) => string
  buildRepositoryFaviconUrl: (repositoryPath: string, faviconPath: string | null) => string | null
  parseGlobalFlags: (input: string) => string[]
  parseTaskTagsInput: (input: string) => string[]
  resolveTerminalFontFamily: (settings: PersistedAppState['settings']) => string
  sidebarWidth: {
    default: number
    min: number
    max: number
  }
  sanitizeUserFacingMessage: (value: string) => string
}

function compareRepositoriesAlphabetically(
  left: Pick<RepositorySnapshot, 'name' | 'path'>,
  right: Pick<RepositorySnapshot, 'name' | 'path'>
): number {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return byName !== 0
    ? byName
    : left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
}

function clampSidebarWidth(
  value: number,
  bounds: SnapshotServiceDependencies['sidebarWidth']
): number {
  if (!Number.isFinite(value)) {
    return bounds.default
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)))
}

export function createSnapshotService(dependencies: SnapshotServiceDependencies): {
  buildSnapshot: (options?: BuildSnapshotOptions) => AppSnapshot
  buildSelectionSnapshot: () => AppSnapshot
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
} {
  function buildThreadSnapshot(
    repository: PersistedRepository,
    thread: PersistedThread,
    runningThreadIds: Set<string>,
    runningRunThreadIds: Set<string>
  ): ThreadSnapshot {
    return {
      ...thread,
      cwd: dependencies.getThreadUiCwd(thread, repository),
      executionCwd: dependencies.getThreadExecutionCwd(thread, repository),
      backend: repository.backend,
      displayBranchName: thread.branchName,
      displayTitle: thread.customTitle ?? thread.branchName,
      isRunning: runningThreadIds.has(thread.id),
      isRunCommandRunning: runningRunThreadIds.has(thread.id)
    }
  }

  function buildRepositorySnapshot(
    repository: PersistedRepository,
    threads: PersistedThread[],
    runningThreadIds: Set<string>,
    runningRunThreadIds: Set<string>,
    refreshGit: boolean
  ): RepositorySnapshot {
    const repositoryGitState = dependencies.getRepositoryGitState(repository, refreshGit)
    const snapshotThreads = threads
      .filter((thread) => thread.repositoryId === repository.id)
      .map((thread) =>
        buildThreadSnapshot(repository, thread, runningThreadIds, runningRunThreadIds)
      )
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

    return {
      ...repository,
      currentBranch: repositoryGitState.currentBranch,
      faviconUrl: dependencies.buildRepositoryFaviconUrl(repository.path, repository.faviconPath),
      primaryBranch: repositoryGitState.primaryBranch,
      lastActivityAt: snapshotThreads[0]?.lastActivityAt ?? repository.addedAt,
      threads: snapshotThreads
    }
  }

  const buildSnapshot = (options: BuildSnapshotOptions = {}): AppSnapshot => {
    const state = dependencies.ensureState()
    const runningThreadIds = dependencies.getRunningThreadIds()
    const runningRunThreadIds = dependencies.getRunningRunThreadIds()
    const refreshGit = options.refreshGit ?? true

    const repositories = state.repositories
      .map((repository) =>
        buildRepositorySnapshot(
          repository,
          state.threads,
          runningThreadIds,
          runningRunThreadIds,
          refreshGit
        )
      )
      .sort(compareRepositoriesAlphabetically)

    return {
      repositories,
      settings: {
        ...state.settings,
        parsedGlobalFlags: dependencies.parseGlobalFlags(state.settings.globalFlagsInput),
        parsedTaskTags: dependencies.parseTaskTagsInput(state.settings.taskTagsInput),
        resolvedTerminalFontFamily: dependencies.resolveTerminalFontFamily(state.settings)
      },
      selectedRepositoryId: state.ui.selectedRepositoryId,
      selectedThreadId: state.ui.selectedThreadId,
      sidebarWidth: clampSidebarWidth(
        state.ui.sidebarWidth ?? dependencies.sidebarWidth.default,
        dependencies.sidebarWidth
      )
    }
  }

  const buildSelectionSnapshot = (): AppSnapshot => buildSnapshot({ refreshGit: false })

  return {
    buildSnapshot,
    buildSelectionSnapshot,
    successResult: (): MutationResult => ({
      ok: true,
      snapshot: buildSnapshot()
    }),
    failureResult: (error: string, cancelled = false): MutationResult => ({
      ok: false,
      cancelled,
      error: dependencies.sanitizeUserFacingMessage(error),
      snapshot: buildSnapshot()
    })
  }
}
