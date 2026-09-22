import type { PersistedAppState, PersistedRepository, ViewMode } from '../../../shared/app-types'
import { isSameRepositoryPath } from '../../backends/repository-backend'

/** Upgrade the initial inbox implementation, which stored mode on project records. */
export function migrateSharedProjects(state: PersistedAppState): PersistedAppState {
  const legacy = state.repositories as Array<PersistedRepository & { viewMode?: ViewMode }>
  if (!legacy.some((repository) => repository.viewMode !== undefined)) return state

  const repositories: PersistedRepository[] = []
  const targets = new Map<string, { repositoryId: string; viewMode: ViewMode }>()
  // Keep the established Projects configuration when both views configured the same folder.
  const ordered = [...legacy].sort(
    (a, b) => Number(a.viewMode === 'inbox') - Number(b.viewMode === 'inbox')
  )
  for (const source of ordered) {
    const { viewMode = 'projects', ...repository } = source
    const index = repositories.findIndex((existing) =>
      isSameRepositoryPath(existing.path, existing.backend, repository.path, repository.backend)
    )
    if (index < 0) {
      repositories.push(repository)
      targets.set(source.id, { repositoryId: repository.id, viewMode })
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
    targets.set(source.id, { repositoryId: existing.id, viewMode })
  }
  const remapRepositoryId = (id: string | null): string | null =>
    id ? (targets.get(id)?.repositoryId ?? id) : null
  return {
    ...state,
    repositories,
    threads: state.threads.map((thread) => {
      const target = targets.get(thread.repositoryId)
      return target
        ? {
            ...thread,
            repositoryId: target.repositoryId,
            viewMode: thread.viewMode ?? target.viewMode
          }
        : thread
    }),
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
