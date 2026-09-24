import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread
} from '../../../shared/app-types'
import { isSameRepositoryPath } from '../../backends/repository-backend'

type LegacyViewMode = 'projects' | 'inbox'
export type LegacyViewState = Omit<PersistedAppState, 'repositories' | 'threads' | 'ui'> & {
  repositories: Array<PersistedRepository & { viewMode?: LegacyViewMode }>
  threads: Array<PersistedThread & { viewMode?: LegacyViewMode }>
  ui: PersistedAppState['ui'] & {
    viewMode?: LegacyViewMode
    modeSelections?: Partial<
      Record<LegacyViewMode, { repositoryId: string | null; threadId: string | null }>
    >
  }
}

/** Upgrade the initial inbox implementation, which stored mode on project records. */
export function migrateSharedProjects(state: LegacyViewState): LegacyViewState {
  const legacy = state.repositories
  if (!legacy.some((repository) => repository.viewMode !== undefined)) return state

  const repositories: PersistedRepository[] = []
  const targets = new Map<string, string>()
  // Keep the established Projects configuration when both views configured the same folder.
  const ordered = [...legacy].sort(
    (a, b) => Number(a.viewMode === 'inbox') - Number(b.viewMode === 'inbox')
  )
  for (const source of ordered) {
    const { viewMode: _viewMode, ...repository } = source
    void _viewMode
    const index = repositories.findIndex((existing) =>
      isSameRepositoryPath(existing.path, existing.backend, repository.path, repository.backend)
    )
    if (index < 0) {
      repositories.push(repository)
      targets.set(source.id, repository.id)
      continue
    }
    const existing = repositories[index]
    repositories[index] = {
      ...existing,
      icon: existing.icon ?? repository.icon,
      iconColor: existing.iconColor ?? repository.iconColor,
      faviconPath: existing.faviconPath ?? repository.faviconPath,
      runCommand: existing.runCommand ?? repository.runCommand,
      solutionFilePath: existing.solutionFilePath ?? repository.solutionFilePath,
      newWorktreeSetupCommand:
        existing.newWorktreeSetupCommand ?? repository.newWorktreeSetupCommand,
      postWorktreeRemoveCommand:
        existing.postWorktreeRemoveCommand ?? repository.postWorktreeRemoveCommand,
      tasks: [
        ...existing.tasks,
        ...repository.tasks.filter((task) => !existing.tasks.some((item) => item.id === task.id))
      ]
    }
    targets.set(source.id, existing.id)
  }
  const remapRepositoryId = (id: string | null): string | null =>
    id ? (targets.get(id) ?? id) : null
  return {
    ...state,
    repositories,
    threads: state.threads.map((thread) => ({
      ...thread,
      repositoryId: remapRepositoryId(thread.repositoryId) ?? thread.repositoryId
    })),
    ui: {
      ...state.ui,
      selectedRepositoryId: remapRepositoryId(state.ui.selectedRepositoryId),
      ...(state.ui.modeSelections
        ? {
            modeSelections: Object.fromEntries(
              Object.entries(state.ui.modeSelections).map(([mode, selection]) => [
                mode,
                {
                  ...selection,
                  repositoryId: remapRepositoryId(selection.repositoryId)
                }
              ])
            )
          }
        : {})
    }
  }
}
