import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread
} from '../../../shared/app-types'

export function normalizeSelection(state: PersistedAppState): void {
  const repositoryIds = new Set(state.repositories.map((repository) => repository.id))
  const threadsById = new Map(state.threads.map((thread) => [thread.id, thread] as const))

  if (state.ui.selectedRepositoryId && !repositoryIds.has(state.ui.selectedRepositoryId)) {
    state.ui.selectedRepositoryId = null
  }

  if (state.ui.selectedThreadId && !threadsById.has(state.ui.selectedThreadId)) {
    state.ui.selectedThreadId = null
  }

  if (state.ui.selectedThreadId) {
    state.ui.selectedRepositoryId = threadsById.get(state.ui.selectedThreadId)?.repositoryId ?? null
  }

  if (!state.ui.selectedRepositoryId && state.repositories.length > 0) {
    state.ui.selectedRepositoryId = state.repositories[0].id
  }
}

type PersistedStateStoreOptions = {
  getStorePath: () => string
  createDefaultState: () => PersistedAppState
  migrateState: (parsed: unknown) => PersistedAppState
}

export type PersistedStateStore = {
  ensureState: () => PersistedAppState
  saveState: () => void
  updateSelection: (repositoryId: string | null, threadId: string | null) => void
  findThread: (threadId: string) => PersistedThread | undefined
  findRepository: (repositoryId: string) => PersistedRepository | undefined
}

export function createPersistedStateStore(
  options: PersistedStateStoreOptions
): PersistedStateStore {
  let persistedState: PersistedAppState | null = null

  const ensureState = (): PersistedAppState => {
    if (persistedState) {
      return persistedState
    }

    const storePath = options.getStorePath()
    if (!existsSync(storePath)) {
      persistedState = options.createDefaultState()
      return persistedState
    }

    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as unknown
    const migrated = options.migrateState(parsed)
    persistedState = migrated
    normalizeSelection(migrated)
    return migrated
  }

  const saveState = (): void => {
    const state = ensureState()
    normalizeSelection(state)

    const storePath = options.getStorePath()
    mkdirSync(dirname(storePath), { recursive: true })

    const tempPath = `${storePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, null, 2))

    if (existsSync(storePath)) {
      unlinkSync(storePath)
    }

    renameSync(tempPath, storePath)
  }

  return {
    ensureState,
    saveState,
    updateSelection: (repositoryId: string | null, threadId: string | null): void => {
      const state = ensureState()
      state.ui.selectedRepositoryId = repositoryId
      state.ui.selectedThreadId = threadId
    },
    findThread: (threadId: string): PersistedThread | undefined => {
      return ensureState().threads.find((thread) => thread.id === threadId)
    },
    findRepository: (repositoryId: string): PersistedRepository | undefined => {
      return ensureState().repositories.find((repository) => repository.id === repositoryId)
    }
  }
}
