import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedAppState } from '../../../shared/app-types'
import { createPersistedStateStore, normalizeSelection } from './persisted-state-store'

const tempDirs: string[] = []

function createState(): PersistedAppState {
  return {
    version: 12,
    settings: {
      agentProviderId: 'copilot',
      globalFlagsInput: '',
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
  it('normalizes selection against current repositories and threads', () => {
    const state = createState()
    state.repositories.push({
      id: 'repo-1',
      name: 'repo',
      path: 'C:\\repo',
      backend: { kind: 'native' },
      faviconPath: null,
      runCommand: null,
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
      sessionName: 'session',
      resumeSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      hasLaunched: false
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
