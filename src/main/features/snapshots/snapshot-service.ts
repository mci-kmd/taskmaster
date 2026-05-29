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

type RepositoryGitSnapshotState = {
  currentBranch: string
  primaryBranch: string | null
  branchOptions: RepositorySnapshot['branchOptions']
  worktreeOptions: RepositorySnapshot['worktreeOptions']
}

type SnapshotServiceDependencies = {
  ensureState: () => PersistedAppState
  getRunningThreadIds: () => Set<string>
  getRunningRunThreadIds: () => Set<string>
  getRepositoryGitState: (
    repository: PersistedRepository,
    refreshGit: boolean
  ) => RepositoryGitSnapshotState
  refreshRepositoryGitState: (
    repository: PersistedRepository
  ) => Promise<RepositoryGitSnapshotState>
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

function sortRepositoriesForGitRefresh(
  repositories: PersistedRepository[],
  threads: PersistedThread[]
): PersistedRepository[] {
  const latestThreadActivityByRepositoryId = new Map<string, string>()

  for (const thread of threads) {
    const currentLatest = latestThreadActivityByRepositoryId.get(thread.repositoryId)
    if (!currentLatest || thread.lastActivityAt > currentLatest) {
      latestThreadActivityByRepositoryId.set(thread.repositoryId, thread.lastActivityAt)
    }
  }

  return [...repositories].sort((left, right) => {
    const leftLatestActivity = latestThreadActivityByRepositoryId.get(left.id) ?? null
    const rightLatestActivity = latestThreadActivityByRepositoryId.get(right.id) ?? null
    const leftHasThreads = leftLatestActivity !== null
    const rightHasThreads = rightLatestActivity !== null

    if (leftHasThreads !== rightHasThreads) {
      return leftHasThreads ? -1 : 1
    }

    if (leftLatestActivity && rightLatestActivity && leftLatestActivity !== rightLatestActivity) {
      return rightLatestActivity.localeCompare(leftLatestActivity)
    }

    return compareRepositoriesAlphabetically(left, right)
  })
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
  buildSnapshotAsync: (options?: BuildSnapshotOptions) => Promise<AppSnapshot>
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
    refreshGit: boolean,
    resolvedGitState?: RepositoryGitSnapshotState
  ): RepositorySnapshot {
    const repositoryGitState =
      resolvedGitState ?? dependencies.getRepositoryGitState(repository, refreshGit)
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
      branchOptions: repositoryGitState.branchOptions,
      worktreeOptions: repositoryGitState.worktreeOptions,
      lastActivityAt: snapshotThreads[0]?.lastActivityAt ?? repository.addedAt,
      threads: snapshotThreads
    }
  }

  function buildSnapshotWithState(
    state: PersistedAppState,
    options: BuildSnapshotOptions,
    gitStateByRepositoryId?: Map<string, RepositoryGitSnapshotState>
  ): AppSnapshot {
    const runningThreadIds = dependencies.getRunningThreadIds()
    const runningRunThreadIds = dependencies.getRunningRunThreadIds()
    const refreshGit = options.refreshGit ?? false

    const repositories = state.repositories
      .map((repository) =>
        buildRepositorySnapshot(
          repository,
          state.threads,
          runningThreadIds,
          runningRunThreadIds,
          refreshGit,
          gitStateByRepositoryId?.get(repository.id)
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

  const buildSnapshot = (options: BuildSnapshotOptions = {}): AppSnapshot => {
    const state = dependencies.ensureState()
    return buildSnapshotWithState(state, options)
  }

  const buildSelectionSnapshot = (): AppSnapshot => buildSnapshot({ refreshGit: false })

  const buildSnapshotAsync = async (options: BuildSnapshotOptions = {}): Promise<AppSnapshot> => {
    const state = dependencies.ensureState()
    const refreshGit = options.refreshGit ?? false
    if (!refreshGit) {
      return buildSnapshotWithState(state, { ...options, refreshGit: false })
    }

    const repositoryGitStates = await Promise.all(
      sortRepositoriesForGitRefresh(state.repositories, state.threads).map(async (repository) => ({
        repositoryId: repository.id,
        gitState: await dependencies.refreshRepositoryGitState(repository)
      }))
    )

    return buildSnapshotWithState(
      state,
      { ...options, refreshGit: false },
      new Map(repositoryGitStates.map(({ repositoryId, gitState }) => [repositoryId, gitState]))
    )
  }

  return {
    buildSnapshot,
    buildSnapshotAsync,
    buildSelectionSnapshot,
    successResult: (): MutationResult => ({
      ok: true,
      snapshot: buildSelectionSnapshot()
    }),
    failureResult: (error: string, cancelled = false): MutationResult => ({
      ok: false,
      cancelled,
      error: dependencies.sanitizeUserFacingMessage(error),
      snapshot: buildSelectionSnapshot()
    })
  }
}
