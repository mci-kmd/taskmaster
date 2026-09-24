import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  MutationResult
} from '../../../shared/app-types'
import { createDefaultState, migrateAppState } from './app-state-migrations'
import { createPersistedStateStore } from './persisted-state-store'
import { createThreadStateService } from '../threads/thread-state-service'

const repository = (id: string): PersistedRepository => ({
  id,
  name: id,
  path: '/same/project',
  backend: { kind: 'native' },
  faviconPath: null,
  runCommand: null,
  solutionFilePath: null,
  newWorktreeSetupCommand: null,
  postWorktreeRemoveCommand: 'cleanup',
  addedAt: '2026-01-01T00:00:00.000Z',
  tasks: []
})
const thread = (id: string, repositoryId: string): PersistedThread => ({
  id,
  repositoryId,
  customTitle: id,
  latestCopilotTitle: null,
  lastUserMessage: 'keep this',
  mode: 'worktree',
  branchName: id,
  worktreePath: `/worktrees/${id}`,
  ownsBranch: true,
  ownsWorktree: true,
  resumeSessionId: `session-${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-02T00:00:00.000Z'
})
const directories: string[] = []
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)

function harness(): {
  store: ReturnType<typeof createPersistedStateStore>
  state: PersistedAppState
  threads: ReturnType<typeof createThreadStateService>
  options: Parameters<typeof createPersistedStateStore>[0]
  successResult: () => MutationResult
  failureResult: (error: string) => MutationResult
} {
  const dir = mkdtempSync(join(process.cwd(), '.test-inbox-state-'))
  directories.push(dir)
  const options = {
    getStorePath: () => join(dir, 'state.json'),
    createDefaultState,
    migrateState: migrateAppState
  }
  const store = createPersistedStateStore(options)
  const state = store.ensureState()
  state.repositories = [repository('shared')]
  state.threads = [thread('legacy', 'shared'), thread('active', 'shared'), thread('next', 'shared')]
  store.updateSelection('shared', 'legacy')
  const successResult = (): MutationResult => ({ ok: true })
  const failureResult = (error: string): MutationResult => ({ ok: false, error })
  const threads = createThreadStateService({
    ...store,
    successResult,
    failureResult,
    buildSelectionSnapshot: () => ({}) as never,
    normalizeCustomTitle: (value) => value?.trim() ?? null,
    normalizeTrackedText: (value) => value,
    normalizeCopilotTitle: (value) => value ?? null,
    nowIso: () => '2026-01-03T00:00:00.000Z'
  })
  return { store, state, threads, options, successResult, failureResult }
}

describe('unified thread state', () => {
  it('selects any thread in the shared list and restores selection after restart', () => {
    const { store, state, options } = harness()
    store.updateSelection('shared', 'active')
    store.saveState()
    expect(state.ui.selectedThreadId).toBe('active')
    const restored = createPersistedStateStore(options).ensureState()
    expect(restored.ui).toEqual(state.ui)
    expect(restored.repositories).toEqual(state.repositories)
    expect(restored.threads.map((item) => item.id)).toEqual(['legacy', 'active', 'next'])
  })

  it('settles either formerly project or inbox threads without altering session or branch data', () => {
    const { state, threads, options } = harness()
    const before = structuredClone(state.threads)
    expect(threads.updateThread({ threadId: 'legacy', settled: true }).ok).toBe(true)
    expect(state.threads[0]).toEqual({ ...before[0], settledAt: '2026-01-03T00:00:00.000Z' })
    expect(state.threads[1]).toEqual(before[1])
    expect(state.threads[2]).toEqual(before[2])
    expect(state.ui.selectedThreadId).toBe('active')
    expect(createPersistedStateStore(options).ensureState().threads[0].settledAt).toBeTruthy()
    threads.updateThreadLastUserMessage({ threadId: 'legacy', message: 'new activity' })
    expect(state.threads[0].settledAt).toBeTruthy()
    threads.updateThread({ threadId: 'legacy', settled: false })
    expect(state.threads[0].settledAt).toBeNull()
    expect(state.threads[0].resumeSessionId).toBe(before[0].resumeSessionId)
  })

  it('does not move selection when another thread settles', () => {
    const { state, threads } = harness()
    threads.updateThread({ threadId: 'active', settled: true })
    expect(state.ui.selectedThreadId).toBe('legacy')
  })

  it('does not let background session updates replace the current selection', () => {
    const { state, threads } = harness()
    threads.updateThreadResumeSession({
      threadId: 'active',
      sessionId: 'new-session',
      source: 'new'
    })
    expect(state.ui.selectedThreadId).toBe('legacy')
  })
})

describe('migration from mode-specific project configurations', () => {
  it('reopens a version 16 file with both views, then persists one unified list', () => {
    const { state, options } = harness()
    writeFileSync(
      options.getStorePath(),
      JSON.stringify({
        ...state,
        version: 16,
        threads: [
          { ...thread('legacy', 'shared'), viewMode: 'projects' },
          { ...thread('active', 'shared'), viewMode: 'inbox', settledAt: '2026-01-04T00:00:00Z' }
        ],
        ui: {
          viewMode: 'inbox',
          selectedRepositoryId: 'shared',
          selectedThreadId: 'active',
          modeSelections: {
            projects: { repositoryId: 'shared', threadId: 'legacy' },
            inbox: { repositoryId: 'shared', threadId: 'active' }
          }
        }
      })
    )

    const store = createPersistedStateStore(options)
    expect(store.ensureState().threads.map((item) => item.resumeSessionId)).toEqual([
      'session-legacy',
      'session-active'
    ])
    store.saveState()
    const restored = createPersistedStateStore(options).ensureState()
    expect(restored.version).toBe(17)
    expect(restored.ui.selectedThreadId).toBe('active')
    expect(restored.threads[1].settledAt).toBe('2026-01-04T00:00:00Z')
    expect(restored.threads.every((item) => !('viewMode' in item))).toBe(true)
  })

  it('shares duplicate projects while retaining both sets of threads and current selection', () => {
    const { state } = harness()
    const configured = { ...repository('original'), runCommand: 'bun dev' }
    const inboxCopy = {
      ...repository('inbox-copy'),
      viewMode: 'inbox',
      runCommand: 'different command',
      icon: 'globe'
    }
    const inboxOnly = { ...repository('inbox-only'), path: '/other/project', viewMode: 'inbox' }
    const settled = {
      ...thread('settled', 'inbox-copy'),
      viewMode: 'inbox',
      settledAt: '2026-01-04T00:00:00.000Z'
    }
    const migrated = migrateAppState({
      ...state,
      version: 16,
      repositories: [inboxCopy, inboxOnly, configured],
      threads: [
        { ...thread('legacy', 'original'), viewMode: 'projects' },
        settled,
        { ...thread('other', 'inbox-only'), viewMode: 'inbox' }
      ],
      ui: {
        viewMode: 'inbox',
        selectedRepositoryId: 'inbox-copy',
        selectedThreadId: 'settled',
        modeSelections: {
          projects: { repositoryId: 'original', threadId: 'legacy' },
          inbox: { repositoryId: 'inbox-copy', threadId: 'settled' }
        }
      }
    })
    expect(migrated.repositories).toHaveLength(2)
    expect(migrated.repositories[0]).toMatchObject({
      id: 'original',
      runCommand: 'bun dev',
      icon: 'globe'
    })
    expect(migrated.repositories.every((project) => !('viewMode' in project))).toBe(true)
    expect(migrated.version).toBe(17)
    expect(migrated.threads.map((item) => item.id)).toEqual(['legacy', 'settled', 'other'])
    expect(migrated.threads[0]).toMatchObject({ repositoryId: 'original' })
    expect(migrated.threads[1]).toMatchObject({
      repositoryId: 'original',
      settledAt: settled.settledAt,
      resumeSessionId: settled.resumeSessionId,
      worktreePath: settled.worktreePath,
      ownsBranch: true
    })
    expect(migrated.threads[2]).toMatchObject({ repositoryId: 'inbox-only' })
    expect(migrated.threads.every((item) => !('viewMode' in item))).toBe(true)
    expect(migrated.ui.selectedRepositoryId).toBe('original')
    expect(migrated.ui.selectedThreadId).toBe('settled')
    expect(migrated.ui).not.toHaveProperty('modeSelections')
    expect(migrated.ui).not.toHaveProperty('viewMode')
    expect(migrateAppState(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated)
  })

  it('falls back to saved inbox selection when current thread was removed', () => {
    const { state } = harness()
    const migrated = migrateAppState({
      ...state,
      version: 16,
      ui: {
        viewMode: 'projects',
        selectedRepositoryId: 'missing',
        selectedThreadId: 'missing',
        modeSelections: {
          inbox: { repositoryId: 'shared', threadId: 'active' }
        }
      }
    })
    expect(migrated.ui).toMatchObject({
      selectedRepositoryId: 'shared',
      selectedThreadId: 'active'
    })
  })

  it('prefers a valid current project selection over a saved inbox selection', () => {
    const { state } = harness()
    const migrated = migrateAppState({
      ...state,
      version: 16,
      settings: { ...state.settings, yoloEnabled: false },
      threads: [
        { ...thread('legacy', 'shared'), viewMode: 'projects' },
        { ...thread('active', 'shared'), viewMode: 'inbox' }
      ],
      ui: {
        viewMode: 'projects',
        selectedRepositoryId: 'shared',
        selectedThreadId: 'legacy',
        modeSelections: {
          inbox: { repositoryId: 'shared', threadId: 'active' }
        }
      }
    })

    expect(migrated.threads.map((item) => item.id)).toEqual(['legacy', 'active'])
    expect(migrated.threads.every((item) => !('viewMode' in item))).toBe(true)
    expect(migrated.ui.selectedThreadId).toBe('legacy')
    expect(migrated.settings.yoloEnabled).toBe(false)
  })
})
