import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  MutationResult
} from '../../../shared/app-types'
import { createDefaultState, migrateAppState } from './app-state-migrations'
import { createPersistedStateStore } from './persisted-state-store'
import { createSettingsService } from '../settings/settings-service'
import { createThreadStateService } from '../threads/thread-state-service'
import { createThreadCloseService } from '../threads/thread-close-service'

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
const thread = (id: string, repositoryId: string, inbox = false): PersistedThread => ({
  id,
  repositoryId,
  ...(inbox ? { viewMode: 'inbox' as const } : {}),
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
  settings: ReturnType<typeof createSettingsService>
  threads: ReturnType<typeof createThreadStateService>
  options: Parameters<typeof createPersistedStateStore>[0]
  successResult: () => MutationResult
  failureResult: (error: string) => MutationResult
} {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-state-'))
  directories.push(dir)
  const options = {
    getStorePath: () => join(dir, 'state.json'),
    createDefaultState,
    migrateState: migrateAppState
  }
  const store = createPersistedStateStore(options)
  const state = store.ensureState()
  state.repositories = [repository('shared')]
  state.threads = [
    thread('legacy', 'shared'),
    thread('active', 'shared', true),
    thread('next', 'shared', true)
  ]
  store.updateSelection('shared', 'legacy')
  const successResult = (): MutationResult => ({ ok: true })
  const failureResult = (error: string): MutationResult => ({ ok: false, error })
  const settings = createSettingsService({
    ...store,
    successResult,
    normalizeTerminalFontFamilyInput: (value) => value,
    clampSidebarWidth: (value) => value
  })
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
  return { store, state, settings, threads, options, successResult, failureResult }
}

describe('independent inbox state', () => {
  it('keeps legacy data in projects and restores each mode selection after restart', () => {
    const { store, state, settings, options } = harness()
    settings.updateUi({ viewMode: 'inbox' })
    expect(state.ui.selectedRepositoryId).toBe('shared')
    expect(state.ui.selectedThreadId).toBeNull()
    store.updateSelection('shared', 'active')
    settings.updateUi({ viewMode: 'projects' })
    expect(state.ui.selectedThreadId).toBe('legacy')
    settings.updateUi({ viewMode: 'inbox' })
    expect(state.ui.selectedThreadId).toBe('active')
    const restored = createPersistedStateStore(options).ensureState()
    expect(restored.ui).toEqual(state.ui)
    expect(restored.repositories).toEqual(state.repositories)
  })

  it('settles without altering session, branch, worktree, activity, or other mode data', () => {
    const { state, store, settings, threads, options } = harness()
    settings.updateUi({ viewMode: 'inbox' })
    store.updateSelection('shared', 'active')
    const before = structuredClone(state.threads)
    expect(threads.updateThread({ threadId: 'active', settled: true }).ok).toBe(true)
    expect(state.threads[1]).toEqual({ ...before[1], settledAt: '2026-01-03T00:00:00.000Z' })
    expect(state.threads[0]).toEqual(before[0])
    expect(state.threads[2]).toEqual(before[2])
    expect(state.ui.selectedThreadId).toBe('next')
    expect(createPersistedStateStore(options).ensureState().threads[1].settledAt).toBeTruthy()
    threads.updateThreadLastUserMessage({ threadId: 'active', message: 'new activity' })
    expect(state.threads[1].settledAt).toBeTruthy()
    threads.updateThread({ threadId: 'active', settled: false })
    expect(state.threads[1].settledAt).toBeNull()
    expect(state.threads[1].resumeSessionId).toBe(before[1].resumeSessionId)
  })

  it('does not settle project threads or move selection for a background settle', () => {
    const { state, threads } = harness()
    expect(threads.updateThread({ threadId: 'legacy', settled: true }).ok).toBe(false)
    threads.updateThread({ threadId: 'active', settled: true })
    expect(state.ui.selectedThreadId).toBe('legacy')
  })

  it('does not let a background session update in another mode replace the current selection', () => {
    const { state, store, threads, settings } = harness()
    settings.updateUi({ viewMode: 'inbox' })
    store.updateSelection('shared', 'active')
    settings.updateUi({ viewMode: 'projects' })
    threads.updateThreadResumeSession({
      threadId: 'active',
      sessionId: 'new-session',
      source: 'new'
    })
    expect(state.ui.selectedThreadId).toBe('legacy')
    settings.updateUi({ viewMode: 'inbox' })
    expect(state.ui.selectedThreadId).toBe('active')
  })

  it('rejects destructive close on inbox threads before stopping processes or prompting', async () => {
    const { store, successResult, failureResult } = harness()
    const killSessionsForThread = vi.fn()
    const stopThreadRunSession = vi.fn()
    const showMessageBox = vi.fn()
    const close = createThreadCloseService({
      ...store,
      successResult,
      failureResult,
      killSessionsForThread,
      stopThreadRunSession,
      showMessageBox
    })
    expect(await close.closeThread('active')).toMatchObject({ ok: false })
    expect(killSessionsForThread).not.toHaveBeenCalled()
    expect(stopThreadRunSession).not.toHaveBeenCalled()
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})

describe('migration from mode-specific project configurations', () => {
  it('shares duplicate projects while preserving thread modes, session IDs, settlement, and selections', () => {
    const { state } = harness()
    const configured = { ...repository('original'), runCommand: 'bun dev' }
    const inboxCopy = {
      ...repository('inbox-copy'),
      viewMode: 'inbox',
      runCommand: 'different command',
      icon: 'globe'
    }
    const inboxOnly = { ...repository('inbox-only'), path: '/other/project', viewMode: 'inbox' }
    const settled = { ...thread('settled', 'inbox-copy'), settledAt: '2026-01-04T00:00:00.000Z' }
    const migrated = migrateAppState({
      ...state,
      repositories: [inboxCopy, inboxOnly, configured],
      threads: [thread('legacy', 'original'), settled, thread('other', 'inbox-only')],
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
    expect(migrated.threads[0]).toMatchObject({ repositoryId: 'original', viewMode: 'projects' })
    expect(migrated.threads[1]).toEqual({ ...settled, repositoryId: 'original', viewMode: 'inbox' })
    expect(migrated.threads[2]).toMatchObject({ repositoryId: 'inbox-only', viewMode: 'inbox' })
    expect(migrated.ui.selectedRepositoryId).toBe('original')
    expect(migrated.ui.modeSelections?.inbox).toEqual({
      repositoryId: 'original',
      threadId: 'settled'
    })
    expect(migrateAppState(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated)
  })
})
