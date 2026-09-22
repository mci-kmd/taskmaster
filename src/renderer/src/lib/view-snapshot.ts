import type { AppSnapshot, ViewMode } from '../../../shared/app-types'

export function getViewSnapshot(
  snapshot: AppSnapshot,
  viewMode: ViewMode = snapshot.viewMode ?? 'projects'
): AppSnapshot {
  return {
    ...snapshot,
    viewMode,
    repositories: snapshot.repositories.map((repository) => {
      const threads = repository.threads.filter(
        (thread) => (thread.viewMode ?? 'projects') === viewMode
      )
      return {
        ...repository,
        threads,
        lastActivityAt: threads.reduce(
          (latest, thread) => (thread.lastActivityAt > latest ? thread.lastActivityAt : latest),
          repository.addedAt
        )
      }
    })
  }
}
