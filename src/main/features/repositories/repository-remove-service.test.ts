import { describe, expect, it, vi } from 'vitest'
import type {
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PersistedThread
} from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { createRepositoryRemoveService } from './repository-remove-service'

function repository(id: string, overrides: Partial<PersistedRepository> = {}): PersistedRepository {
  return {
    id,
    name: id,
    path: `/${id}`,
    backend: createNativeBackend(),
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: `${id}-task`, title: 'Task', description: '', tags: [], createdAt: '2026-01-01' }
    ],
    ...overrides
  }
}

function thread(id: string, repositoryId: string): PersistedThread {
  return {
    id,
    repositoryId,
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'worktree',
    branchName: `feature/${id}`,
    worktreePath: `/${repositoryId}/.worktrees/${id}`,
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z'
  }
}

function setup(options: { working?: string[] } = {}): {
  state: PersistedAppState
  saveState: ReturnType<typeof vi.fn>
  stopThreadProcesses: ReturnType<typeof vi.fn>
  service: ReturnType<typeof createRepositoryRemoveService>
} {
  const state: PersistedAppState = {
    version: 17,
    settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' },
    repositories: [
      repository('general', { kind: 'general' }),
      repository('repo-1'),
      repository('repo-2')
    ],
    threads: [
      thread('t1', 'repo-1'),
      { ...thread('t2', 'repo-1'), settledAt: '2026-01-02T00:00:00.000Z' },
      thread('t3', 'repo-2')
    ],
    ui: { selectedRepositoryId: 'repo-1', selectedThreadId: 't1' }
  }
  const saveState = vi.fn()
  const stopThreadProcesses = vi.fn(async () => undefined)
  const working = new Set(options.working ?? [])
  const service = createRepositoryRemoveService({
    ensureState: () => state,
    saveState,
    successResult: (): MutationResult => ({ ok: true }),
    failureResult: (error, cancelled): MutationResult => ({ ok: false, error, cancelled }),
    isThreadWorking: (threadId) => working.has(threadId),
    stopThreadProcesses
  })
  return { state, saveState, stopThreadProcesses, service }
}

describe('repository remove service', () => {
  it('removes the project with its threads and tasks and clears its selection', async () => {
    const { state, saveState, stopThreadProcesses, service } = setup()

    const result = await service.removeRepository('repo-1')

    expect(result.ok).toBe(true)
    expect(state.repositories.map((item) => item.id)).toEqual(['general', 'repo-2'])
    expect(state.threads.map((item) => item.id)).toEqual(['t3'])
    expect(state.ui).toEqual({ selectedRepositoryId: null, selectedThreadId: null })
    expect(stopThreadProcesses.mock.calls.map(([id]) => id)).toEqual(['t1', 't2'])
    expect(saveState).toHaveBeenCalledOnce()
  })

  it('keeps the selection when another project is selected', async () => {
    const { state, service } = setup()
    state.ui = { selectedRepositoryId: 'repo-2', selectedThreadId: 't3' }

    await service.removeRepository('repo-1')

    expect(state.ui).toEqual({ selectedRepositoryId: 'repo-2', selectedThreadId: 't3' })
  })

  it('refuses while a project thread is working', async () => {
    const { state, saveState, stopThreadProcesses, service } = setup({ working: ['t2'] })

    const result = await service.removeRepository('repo-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/working/)
    expect(state.repositories).toHaveLength(3)
    expect(state.threads).toHaveLength(3)
    expect(stopThreadProcesses).not.toHaveBeenCalled()
    expect(saveState).not.toHaveBeenCalled()
  })

  it('ignores working threads in other projects', async () => {
    const { service } = setup({ working: ['t3'] })

    expect((await service.removeRepository('repo-1')).ok).toBe(true)
  })

  it('refuses to remove the built-in project or an unknown project', async () => {
    const { state, saveState, service } = setup()

    expect((await service.removeRepository('general')).ok).toBe(false)
    expect((await service.removeRepository('missing')).ok).toBe(false)
    expect(state.repositories).toHaveLength(3)
    expect(saveState).not.toHaveBeenCalled()
  })
})
