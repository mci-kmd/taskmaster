import { describe, expect, it, vi } from 'vitest'
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
    expect(saveState).toHaveBeenCalledTimes(4)
  })
})
