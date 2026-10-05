import type {
  AppSnapshot,
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositorySnapshot,
  ThreadSnapshot
} from '../../../shared/app-types'
import { GENERAL_THREAD_FALLBACK_TITLE, isGeneralProject } from '../../../shared/general-project'

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
  resolveThreadPreviewUrl: (
    repository: PersistedRepository,
    thread: PersistedThread
  ) => string | null
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

function compareRepositoriesForDisplay(
  left: RepositorySnapshot,
  right: RepositorySnapshot
): number {
  const generalFirst = Number(isGeneralProject(right)) - Number(isGeneralProject(left))
  return generalFirst !== 0 ? generalFirst : compareRepositoriesAlphabetically(left, right)
}

const GENERAL_PROJECT_GIT_STATE: RepositoryGitSnapshotState = {
  currentBranch: '',
  primaryBranch: null,
  branchOptions: [],
  worktreeOptions: []
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
    runningRunThreadIds: Set<string>
  ): ThreadSnapshot {
    const general = isGeneralProject(repository)
    return {
      ...thread,
      projectKind: general ? 'general' : 'repository',
      cwd: dependencies.getThreadUiCwd(thread, repository),
      executionCwd: dependencies.getThreadExecutionCwd(thread, repository),
      backend: repository.backend,
      displayBranchName: general ? '' : thread.branchName,
      displayTitle:
        thread.customTitle ?? (general ? GENERAL_THREAD_FALLBACK_TITLE : thread.branchName),
      isRunCommandRunning: runningRunThreadIds.has(thread.id),
      previewUrl: general ? null : dependencies.resolveThreadPreviewUrl(repository, thread)
    }
  }

  function buildRepositorySnapshot(
    repository: PersistedRepository,
    threads: PersistedThread[],
    runningRunThreadIds: Set<string>,
    refreshGit: boolean,
    resolvedGitState?: RepositoryGitSnapshotState
  ): RepositorySnapshot {
    const repositoryGitState = isGeneralProject(repository)
      ? GENERAL_PROJECT_GIT_STATE
      : (resolvedGitState ?? dependencies.getRepositoryGitState(repository, refreshGit))
    const snapshotThreads = threads
      .filter((thread) => thread.repositoryId === repository.id)
      .map((thread) => buildThreadSnapshot(repository, thread, runningRunThreadIds))
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

    return {
      ...repository,
      currentBranch: repositoryGitState.currentBranch,
      faviconUrl: isGeneralProject(repository)
        ? null
        : dependencies.buildRepositoryFaviconUrl(repository.path, repository.faviconPath),
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
    const runningRunThreadIds = dependencies.getRunningRunThreadIds()
    const refreshGit = options.refreshGit ?? false

    const repositories = state.repositories
      .map((repository) =>
        buildRepositorySnapshot(
          repository,
          state.threads,
          runningRunThreadIds,
          refreshGit,
          gitStateByRepositoryId?.get(repository.id)
        )
      )
      .sort(compareRepositoriesForDisplay)

    return {
      repositories,
      settings: {
        ...state.settings,
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
      sortRepositoriesForGitRefresh(
        state.repositories.filter((repository) => !isGeneralProject(repository)),
        state.threads
      ).map(async (repository) => ({
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
