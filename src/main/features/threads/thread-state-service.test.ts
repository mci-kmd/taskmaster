import { describe, expect, it, vi } from 'vitest'
import type { PersistedThread } from '../../../shared/app-types'
import { createThreadStateService } from './thread-state-service'

describe('thread state service', () => {
  it('updates thread selection through the shared snapshot builder', () => {
    const updateSelection = vi.fn()
    const saveState = vi.fn()
    const thread = {
      id: 'thread-1',
      repositoryId: 'repo-1',
      customTitle: null,
      latestCopilotTitle: null,
      lastUserMessage: null,
      mode: 'active-branch' as const,
      branchName: 'main',
      worktreePath: null,
      resumeSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z'
    }
    const snapshot = { repositories: [], settings: {}, selectedRepositoryId: 'repo-1' } as never
    const service = createThreadStateService({
      ensureState: () => ({
        repositories: [],
        threads: [thread],
        ui: { selectedRepositoryId: 'repo-1', selectedThreadId: null }
      }),
      findThread: () => thread,
      saveState,
      updateSelection,
      buildSelectionSnapshot: () => snapshot,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      normalizeCustomTitle: (value) => value?.trim() ?? null,
      normalizeTrackedText: (value) => value?.trim() ?? null,
      normalizeCopilotTitle: (title) => title?.trim() ?? null,
      nowIso: () => '2026-01-01T00:00:01.000Z'
    })

    const result = service.selectThread('thread-1')
    expect(result).toBe(snapshot)
    expect(updateSelection).toHaveBeenNthCalledWith(1, 'repo-1', 'thread-1')
    expect(updateSelection).toHaveBeenCalledTimes(1)
  })

  it('updates thread metadata and persists changes', () => {
    const saveState = vi.fn()
    const thread = {
      id: 'thread-1',
      repositoryId: 'repo-1',
      customTitle: null,
      latestCopilotTitle: null,
      lastUserMessage: null,
      mode: 'active-branch' as const,
      branchName: 'main',
      worktreePath: null,
      resumeSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z'
    }
    const service = createThreadStateService({
      ensureState: () => ({
        repositories: [],
        threads: [thread],
        ui: { selectedRepositoryId: 'repo-1', selectedThreadId: null }
      }),
      findThread: () => thread,
      saveState,
      updateSelection: () => {},
      buildSelectionSnapshot: () => ({}) as never,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      normalizeCustomTitle: (value) => value?.trim() ?? null,
      normalizeTrackedText: (value) => value?.trim() ?? null,
      normalizeCopilotTitle: (title) => title?.trim() ?? null,
      nowIso: () => '2026-01-01T00:00:01.000Z'
    })

    service.updateThread({ threadId: 'thread-1', customTitle: '  New title  ' })
    service.updateThreadCopilotTitle({ threadId: 'thread-1', title: ' Runtime ' })
    service.updateThreadResumeSession({
      threadId: 'thread-1',
      sessionId: 'session-2',
      source: 'new'
    })
    service.updateThreadLastUserMessage({ threadId: 'thread-1', message: '  hello  ' })

    expect(thread).toMatchObject({
      customTitle: 'New title',
      latestCopilotTitle: null,
      resumeSessionId: 'session-2',
      lastUserMessage: 'hello',
      lastActivityAt: '2026-01-01T00:00:01.000Z'
    })
    expect(thread).not.toHaveProperty('lastModel')
    expect(saveState).toHaveBeenCalledTimes(4)

    service.updateThreadLastUserMessage({
      threadId: 'thread-1',
      message: 'next',
      model: { id: 'gpt-5.5', name: 'GPT-5.5' }
    })
    service.updateThreadLastUserMessage({ threadId: 'thread-1', message: 'again', model: null })
    expect(thread).toMatchObject({
      lastUserMessage: 'again',
      lastModel: { id: 'gpt-5.5', name: 'GPT-5.5' }
    })
  })

  it('lets the agent settle its thread and link work items without moving the selection', () => {
    const saveState = vi.fn()
    const updateSelection = vi.fn()
    const thread: PersistedThread = {
      id: 'thread-1',
      repositoryId: 'repo-1',
      customTitle: null,
      latestCopilotTitle: null,
      lastUserMessage: null,
      mode: 'active-branch',
      branchName: 'main',
      worktreePath: null,
      resumeSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z'
    }
    const service = createThreadStateService({
      ensureState: () => ({
        repositories: [],
        threads: [thread],
        ui: { selectedRepositoryId: 'repo-1', selectedThreadId: 'thread-1' }
      }),
      findThread: (id) => (id === thread.id ? thread : undefined),
      saveState,
      updateSelection,
      buildSelectionSnapshot: () => ({}) as never,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      normalizeCustomTitle: (value) => value ?? null,
      normalizeTrackedText: (value) => value ?? null,
      normalizeCopilotTitle: (title) => title ?? null,
      nowIso: () => '2026-01-01T00:00:01.000Z'
    })

    expect(service.settleThreadFromAgent('missing')).toBe(false)
    expect(service.settleThreadFromAgent('thread-1')).toBe(true)
    expect(service.settleThreadFromAgent('thread-1')).toBe(true)
    expect(thread.settledAt).toBe('2026-01-01T00:00:01.000Z')
    expect(updateSelection).not.toHaveBeenCalled()
    expect(saveState).toHaveBeenCalledTimes(1)

    const item = { provider: 'github', container: 'o/r', number: 1 } as const
    expect(
      service.setThreadWorkItems('thread-1', [
        { ...item, url: 'https://github.com/o/r/issues/1' },
        { ...item, url: 'https://github.com/o/r/issues/1' }
      ])
    ).toBe(true)
    expect(thread.workItems).toEqual([{ ...item, url: 'https://github.com/o/r/issues/1' }])
    service.setThreadWorkItems('thread-1', [...thread.workItems!])
    expect(saveState).toHaveBeenCalledTimes(2)
    service.setThreadWorkItems('thread-1', [])
    expect(thread).not.toHaveProperty('workItems')
    expect(saveState).toHaveBeenCalledTimes(3)
  })

  it('suspends idle threads without touching their activity and unsuspends on a new prompt', () => {
    const saveState = vi.fn()
    let working = true
    const thread: PersistedThread = {
      id: 'thread-1',
      repositoryId: 'repo-1',
      customTitle: null,
      latestCopilotTitle: null,
      lastUserMessage: null,
      mode: 'active-branch',
      branchName: 'main',
      worktreePath: null,
      resumeSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z'
    }
    const service = createThreadStateService({
      ensureState: () => ({
        repositories: [],
        threads: [thread],
        ui: { selectedRepositoryId: 'repo-1', selectedThreadId: 'thread-1' }
      }),
      findThread: (id) => (id === thread.id ? thread : undefined),
      saveState,
      updateSelection: () => {},
      buildSelectionSnapshot: () => ({}) as never,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      normalizeCustomTitle: (value) => value ?? null,
      normalizeTrackedText: (value) => value ?? null,
      normalizeCopilotTitle: (title) => title ?? null,
      nowIso: () => '2026-01-02T00:00:00.000Z',
      isThreadWorking: () => working
    })

    expect(service.updateThread({ threadId: 'thread-1', suspended: true })).toEqual({
      ok: false,
      error: 'Wait for Copilot to finish before suspending the thread.'
    })
    expect(thread).not.toHaveProperty('suspendedAt')
    working = false
    expect(service.updateThread({ threadId: 'thread-1', suspended: true }).ok).toBe(true)
    expect(thread.suspendedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(thread.lastActivityAt).toBe('2026-01-01T00:00:00.000Z')
    service.updateThread({ threadId: 'thread-1', suspended: false })
    expect(thread).not.toHaveProperty('suspendedAt')
    expect(thread.lastActivityAt).toBe('2026-01-01T00:00:00.000Z')
    expect(saveState).toHaveBeenCalledTimes(2)

    service.updateThread({ threadId: 'thread-1', suspended: true })
    service.updateThreadLastUserMessage({ threadId: 'thread-1', message: 'continue' })
    expect(thread).not.toHaveProperty('suspendedAt')

    service.updateThread({ threadId: 'thread-1', suspended: true })
    service.updateThread({ threadId: 'thread-1', settled: true })
    expect(thread).not.toHaveProperty('suspendedAt')
    expect(service.updateThread({ threadId: 'thread-1', suspended: true })).toEqual({
      ok: false,
      error: 'Resolved threads cannot be suspended.'
    })
  })
})
