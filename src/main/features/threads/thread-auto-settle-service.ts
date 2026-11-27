import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  ThreadWorkItem
} from '../../../shared/app-types'
import { sameThreadTaskNumbers, sameThreadWorkItems } from '../../../shared/work-items'

const DEFAULT_POLL_INTERVAL_MS = 60_000

type ThreadAutoSettleServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'repositories' | 'threads'>
  findThread: (threadId: string) => PersistedThread | undefined
  findRepository: (repositoryId: string) => PersistedRepository | undefined
  isWorkItemCompleted: (item: ThreadWorkItem) => Promise<boolean | null>
  autoSettleThread: (threadId: string) => boolean
  onThreadSettled: (threadId: string) => void
  pollIntervalMs?: number
}

function areLocalTasksCompleted(
  repository: PersistedRepository | undefined,
  taskNumbers: readonly number[]
): boolean {
  if (taskNumbers.length === 0) return true
  if (!repository) return false
  return taskNumbers.every(
    (number) =>
      !repository.tasks.some((task) => task.number === number) &&
      (repository.completedTasks?.some((task) => task.number === number) ?? false)
  )
}

export function createThreadAutoSettleService(dependencies: ThreadAutoSettleServiceDependencies): {
  /** Checks pending auto-settling threads now (coalesced if already running) and updates polling. */
  checkNow: () => Promise<string[]>
  /** Updates whether the background poll timer should be active. */
  syncSchedule: () => void
  /** Stops background polling. */
  stop: () => void
} {
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<string[]> | null = null
  let rerunRequested = false
  let stopped = false

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const hasPendingRemoteCandidates = (): boolean =>
    dependencies
      .ensureState()
      .threads.some(
        (thread) =>
          thread.autoSettle === true && !thread.settledAt && (thread.workItems?.length ?? 0) > 0
      )

  const syncSchedule = (): void => {
    if (stopped) {
      clearTimer()
      return
    }
    if (!hasPendingRemoteCandidates()) {
      clearTimer()
      return
    }
    if (timer || running) return
    timer = setTimeout(() => {
      timer = null
      void checkNow()
    }, pollIntervalMs)
  }

  const runSweep = async (): Promise<string[]> => {
    const settled: string[] = []
    const remoteCache = new Map<string, Promise<boolean | null>>()
    const checkRemote = (item: ThreadWorkItem): Promise<boolean | null> => {
      const existing = remoteCache.get(item.url)
      if (existing) return existing
      const pending = dependencies.isWorkItemCompleted(item).catch(() => null)
      remoteCache.set(item.url, pending)
      return pending
    }

    const candidates = dependencies
      .ensureState()
      .threads.filter((thread) => thread.autoSettle === true && !thread.settledAt)
      .map((thread) => ({
        id: thread.id,
        repositoryId: thread.repositoryId,
        workItems: thread.workItems ? [...thread.workItems] : [],
        taskNumbers: thread.taskNumbers ? [...thread.taskNumbers] : []
      }))

    for (const candidate of candidates) {
      if (stopped) break
      if (candidate.workItems.length === 0 && candidate.taskNumbers.length === 0) continue

      const repository = dependencies.findRepository(candidate.repositoryId)
      if (!areLocalTasksCompleted(repository, candidate.taskNumbers)) continue

      let allRemoteCompleted = true
      for (const item of candidate.workItems) {
        if ((await checkRemote(item)) !== true) {
          allRemoteCompleted = false
          break
        }
      }
      if (!allRemoteCompleted || stopped) continue

      // Re-verify the thread and its links in case they changed while remote checks were in flight.
      const current = dependencies.findThread(candidate.id)
      if (!current || current.autoSettle !== true || current.settledAt) continue
      const expectedWorkItems = candidate.workItems.length > 0 ? candidate.workItems : undefined
      const expectedTaskNumbers =
        candidate.taskNumbers.length > 0 ? candidate.taskNumbers : undefined
      if (!sameThreadWorkItems(current.workItems, expectedWorkItems)) continue
      if (!sameThreadTaskNumbers(current.taskNumbers, expectedTaskNumbers)) continue
      if (
        !areLocalTasksCompleted(
          dependencies.findRepository(current.repositoryId),
          candidate.taskNumbers
        )
      ) {
        continue
      }

      if (dependencies.autoSettleThread(current.id)) {
        settled.push(current.id)
        dependencies.onThreadSettled(current.id)
      }
    }

    return settled
  }

  const checkNow = (): Promise<string[]> => {
    if (stopped) return Promise.resolve([])
    if (running) {
      rerunRequested = true
      return running
    }
    clearTimer()
    running = (async () => {
      try {
        const allSettled: string[] = []
        do {
          rerunRequested = false
          allSettled.push(...(await runSweep()))
        } while (rerunRequested && !stopped)
        return allSettled
      } finally {
        running = null
        syncSchedule()
      }
    })()
    return running
  }

  return {
    checkNow,
    syncSchedule,
    stop: () => {
      stopped = true
      rerunRequested = false
      clearTimer()
    }
  }
}
