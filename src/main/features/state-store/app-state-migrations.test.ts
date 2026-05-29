import { describe, expect, it } from 'vitest'
import { migrateAppState } from './app-state-migrations'

describe('app state migrations', () => {
  it('adds a null solution file path when migrating version 12 state', () => {
    const migrated = migrateAppState({
      version: 12,
      settings: {
        agentProviderId: 'copilot',
        globalFlagsInput: '',
        terminalFontFamilyInput: '',
        taskTagsInput: 'bug'
      },
      repositories: [
        {
          id: 'repo-1',
          name: 'Repo',
          path: 'C:\\repo',
          backend: { kind: 'native' },
          faviconPath: null,
          runCommand: null,
          newWorktreeSetupCommand: null,
          postWorktreeRemoveCommand: null,
          addedAt: '2026-01-01T00:00:00.000Z',
          tasks: []
        }
      ],
      threads: [],
      ui: {
        selectedRepositoryId: 'repo-1',
        selectedThreadId: null
      }
    })

    expect(migrated.version).toBe(13)
    expect(migrated.repositories[0]?.solutionFilePath).toBeNull()
  })
})
