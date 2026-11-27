import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PersistedRepository,
  PersistedThread,
  ThreadWorkItem
} from '../../../shared/app-types'
import { createThreadAutoSettleService } from './thread-auto-settle-service'

const ghItem: ThreadWorkItem = {
  provider: 'github',
  url: 'https://github.com/octo/repo/issues/1',
  container: 'octo/repo',
  number: 1
}

const adoItem: ThreadWorkItem = {
  provider: 'azure-devops',
  url: 'https://dev.azure.com/contoso/proj/_workitems/edit/2',
  container: 'contoso/proj',
  number: 2
}

function makeThread(id: string, overrides: Partial<PersistedThread> = {}): PersistedThread {
  return {
    id,
    repositoryId: 'repo-1',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'active-branch',
    branchName: 'main',
    worktreePath: null,
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    autoSettle: true,
    ...overrides
  }
}

function makeRepository(openNumbers: number[], completedNumbers: number[]): PersistedRepository {
  return {
    id: 'repo-1',
    name: 'Repo',
    path: '/repo',
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    tasks: openNumbers.map((number) => ({
      id: `open-${number}`,
      number,
      title: `Task ${number}`,
      description: '',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    })),
    completedTasks: completedNumbers.map((number) => ({
      id: `done-${number}`,
      number,
      title: `Task ${number}`,
      description: '',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z'
    }))
  }
}

describe('thread auto-settle service', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requires every linked work item across local tasks, GitHub and ADO to be completed', async () => {
    const repository = makeRepository([10], [11])
    const thread = makeThread('t1', { taskNumbers: [10, 11], workItems: [ghItem, adoItem] })
    const statuses = new Map<string, boolean | null>([
      [ghItem.url, true],
      [adoItem.url, false]
    ])
    const isWorkItemCompleted = vi.fn(
      async (item: ThreadWorkItem) => statuses.get(item.url) ?? null
    )
    const autoSettleThread = vi.fn(() => {
      thread.settledAt = '2026-01-03T00:00:00.000Z'
      return true
    })
    const onThreadSettled = vi.fn()

    const service = createThreadAutoSettleService({
      ensureState: () => ({ repositories: [repository], threads: [thread] }),
      findThread: (id) => (id === thread.id ? thread : undefined),
      findRepository: (id) => (id === repository.id ? repository : undefined),
      isWorkItemCompleted,
      autoSettleThread,
      onThreadSettled
    })

    // Local task #10 is still open -> skips remote lookups altogether.
    expect(await service.checkNow()).toEqual([])
    expect(isWorkItemCompleted).not.toHaveBeenCalled()

    // Complete local task #10; ADO item is still open -> does not settle yet.
    repository.completedTasks!.push({
      ...repository.tasks.pop()!,
      completedAt: '2026-01-03T00:00:00.000Z'
    })
    expect(await service.checkNow()).toEqual([])
    expect(isWorkItemCompleted).toHaveBeenCalledTimes(2)
    expect(autoSettleThread).not.toHaveBeenCalled()

    // Complete ADO item -> all three sources completed -> settles!
    statuses.set(adoItem.url, true)
    expect(await service.checkNow()).toEqual(['t1'])
    expect(autoSettleThread).toHaveBeenCalledWith('t1')
    expect(onThreadSettled).toHaveBeenCalledWith('t1')
    service.stop()
  })

  it('does not settle if auto-settle is disabled or links change while remote check is in flight', async () => {
    const repository = makeRepository([], [])
    const thread = makeThread('t1', { workItems: [ghItem] })
    let resolveCheck: (done: boolean) => void = () => undefined
    const service = createThreadAutoSettleService({
      ensureState: () => ({ repositories: [repository], threads: [thread] }),
      findThread: (id) => (id === thread.id ? thread : undefined),
      findRepository: (id) => (id === repository.id ? repository : undefined),
      isWorkItemCompleted: () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve
        }),
      autoSettleThread: vi.fn(() => true),
      onThreadSettled: vi.fn()
    })

    const pending = service.checkNow()
    // User disables auto-settle while GitHub request is in flight.
    delete thread.autoSettle
    resolveCheck(true)
    expect(await pending).toEqual([])
    service.stop()
  })

  it('polls periodically only while unsettled auto-settling threads have remote work items', async () => {
    vi.useFakeTimers()
    const repository = makeRepository([], [])
    const thread = makeThread('t1', { workItems: [ghItem] })
    let completed = false
    const isWorkItemCompleted = vi.fn(async () => completed)
    const onThreadSettled = vi.fn()
    const service = createThreadAutoSettleService({
      ensureState: () => ({ repositories: [repository], threads: [thread] }),
      findThread: (id) => (id === thread.id ? thread : undefined),
      findRepository: (id) => (id === repository.id ? repository : undefined),
      isWorkItemCompleted,
      autoSettleThread: () => {
        thread.settledAt = '2026-01-03T00:00:00.000Z'
        return true
      },
      onThreadSettled,
      pollIntervalMs: 5_000
    })

    await service.checkNow()
    expect(isWorkItemCompleted).toHaveBeenCalledTimes(1)

    completed = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(isWorkItemCompleted).toHaveBeenCalledTimes(2)
    expect(onThreadSettled).toHaveBeenCalledWith('t1')

    // Once settled, no further polls run.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(isWorkItemCompleted).toHaveBeenCalledTimes(2)
    service.stop()
  })
})
