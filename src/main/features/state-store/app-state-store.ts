import { join } from 'path'
import { app } from 'electron'
import { createPersistedStateStore, type PersistedStateStore } from './persisted-state-store'
import { createDefaultState, migrateAppState } from './app-state-migrations'
import { STORE_FILENAME } from './app-state-values'

export function createAppStateStore(): PersistedStateStore {
  return createPersistedStateStore({
    getStorePath: () => join(app.getPath('userData'), STORE_FILENAME),
    createDefaultState,
    migrateState: migrateAppState
  })
}
