import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'

export function getInboxThreads(repositories: RepositorySnapshot[]): {
  active: Array<{ repository: RepositorySnapshot; thread: ThreadSnapshot }>
  settled: Array<{ repository: RepositorySnapshot; thread: ThreadSnapshot }>
} {
  const threads = repositories
    .flatMap((repository) => repository.threads.map((thread) => ({ repository, thread })))
    .sort(
      (a, b) =>
        b.thread.lastActivityAt.localeCompare(a.thread.lastActivityAt) ||
        a.thread.id.localeCompare(b.thread.id)
    )
  return {
    // Suspended threads sink below the rest but keep their activity order among themselves.
    active: [
      ...threads.filter(({ thread }) => !thread.settledAt && !thread.suspendedAt),
      ...threads.filter(({ thread }) => !thread.settledAt && thread.suspendedAt)
    ],
    settled: threads.filter(({ thread }) => thread.settledAt)
  }
}
