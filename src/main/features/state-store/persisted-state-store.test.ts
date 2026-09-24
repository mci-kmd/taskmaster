import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedAppState } from '../../../shared/app-types'
import { createPersistedStateStore, normalizeSelection } from './persisted-state-store'
import { migrateAppState } from './app-state-migrations'

const tempDirs: string[] = []

function createState(): PersistedAppState {
  return {
    version: 16,
    settings: {
      yoloEnabled: true,
      terminalFontFamilyInput: '',
      taskTagsInput: ''
    },
    repositories: [],
    threads: [],
    ui: {
      selectedRepositoryId: null,
      selectedThreadId: null
    }
  }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('persisted state store', () => {
  it('preserves the global model and effort choice when reopening the state file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taskmaster-model-defaults-'))
    tempDirs.push(directory)
    const options = {
      getStorePath: () => join(directory, 'state.json'),
      createDefaultState: createState,
      migrateState: migrateAppState
    }
    const store = createPersistedStateStore(options)
    store.ensureState().settings.lastCopilotModelSelection = {
      model: 'chosen-model',
      reasoningEffort: 'high'
    }
    store.saveState()
    expect(
      createPersistedStateStore(options).ensureState().settings.lastCopilotModelSelection
    ).toEqual({ model: 'chosen-model', reasoningEffort: 'high' })
  })
  it('normalizes selection against current repositories and threads', () => {
    const state = createState()
    state.repositories.push({
      id: 'repo-1',
      name: 'repo',
      path: 'C:\\repo',
      backend: { kind: 'native' },
      faviconPath: null,
      runCommand: null,
      solutionFilePath: null,
      newWorktreeSetupCommand: null,
      postWorktreeRemoveCommand: null,
      addedAt: '2026-01-01T00:00:00.000Z',
      tasks: []
    })
    state.threads.push({
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
    })
    state.ui.selectedThreadId = 'thread-1'

    normalizeSelection(state)
    expect(state.ui.selectedRepositoryId).toBe('repo-1')
  })

  it('loads, updates, and saves persisted state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'taskmaster-state-store-'))
    tempDirs.push(directory)
    const storePath = join(directory, 'state.json')

    const store = createPersistedStateStore({
      getStorePath: () => storePath,
      createDefaultState: createState,
      migrateState: (parsed) => parsed as PersistedAppState
    })

    const state = store.ensureState()
    state.repositories.push({
      id: 'repo-1',
      name: 'repo',
      path: 'C:\\repo',
      backend: { kind: 'native' },
      faviconPath: null,
      runCommand: null,
      solutionFilePath: null,
      newWorktreeSetupCommand: null,
      postWorktreeRemoveCommand: null,
      addedAt: '2026-01-01T00:00:00.000Z',
      tasks: []
    })
    store.updateSelection('repo-1', null)
    store.saveState()

    const reloaded = createPersistedStateStore({
      getStorePath: () => storePath,
      createDefaultState: createState,
      migrateState: (parsed) => parsed as PersistedAppState
    })

    expect(reloaded.ensureState().ui.selectedRepositoryId).toBe('repo-1')
    expect(reloaded.findRepository('repo-1')?.name).toBe('repo')
  })
})
