import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'

export function getInboxThreads(repositories: RepositorySnapshot[]): {
  active: Array<{ repository: RepositorySnapshot; thread: ThreadSnapshot }>
  settled: Array<{ repository: RepositorySnapshot; thread: ThreadSnapshot }>
} {
  const threads = repositories
    .flatMap((repository) =>
      repository.threads
        .filter((thread) => thread.viewMode === 'inbox')
        .map((thread) => ({ repository, thread }))
    )
    .sort(
      (a, b) =>
        b.thread.lastActivityAt.localeCompare(a.thread.lastActivityAt) ||
        a.thread.id.localeCompare(b.thread.id)
    )
  return {
    active: threads.filter(({ thread }) => !thread.settledAt),
    settled: threads.filter(({ thread }) => thread.settledAt)
  }
}
