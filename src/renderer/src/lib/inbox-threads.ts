import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'

type InboxEntry = { repository: RepositorySnapshot; thread: ThreadSnapshot }

/** When the thread last asked for attention: its last activity, or waking from a snooze. */
function attentionAt(thread: ThreadSnapshot): string {
  const awakenedAt = thread.awakenedAt ?? ''
  return awakenedAt > thread.lastActivityAt ? awakenedAt : thread.lastActivityAt
}

export function getInboxThreads(repositories: RepositorySnapshot[]): {
  active: InboxEntry[]
  snoozed: InboxEntry[]
  settled: InboxEntry[]
} {
  const threads = repositories
    .flatMap((repository) => repository.threads.map((thread) => ({ repository, thread })))
    .sort(
      (a, b) =>
        attentionAt(b.thread).localeCompare(attentionAt(a.thread)) ||
        a.thread.id.localeCompare(b.thread.id)
    )
  const open = threads.filter(({ thread }) => !thread.settledAt && !thread.snoozedUntil)
  return {
    // Suspended threads sink below the rest but keep their activity order among themselves.
    active: [
      ...open.filter(({ thread }) => !thread.suspendedAt),
      ...open.filter(({ thread }) => thread.suspendedAt)
    ],
    // Soonest to wake first.
    snoozed: threads
      .filter(({ thread }) => !thread.settledAt && thread.snoozedUntil)
      .sort(
        (a, b) =>
          (a.thread.snoozedUntil ?? '').localeCompare(b.thread.snoozedUntil ?? '') ||
          a.thread.id.localeCompare(b.thread.id)
      ),
    settled: threads.filter(({ thread }) => thread.settledAt)
  }
}
