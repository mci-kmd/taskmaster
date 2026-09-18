import { describe, expect, it } from 'vitest'
import { migrateAppState } from './app-state-migrations'

describe('app state migrations', () => {
  it('defaults version 14 threads to the CLI interface', () => {
    const migrated = migrateAppState({
      version: 14,
      settings: {
        globalFlagsInput: '',
        terminalFontFamilyInput: '',
        taskTagsInput: 'bug'
      },
      repositories: [],
      threads: [
        {
          id: 'thread-1',
          repositoryId: 'repo-1',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'active-branch',
          branchName: 'main',
          worktreePath: null,
          sessionName: 'session-1',
          resumeSessionId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: '2026-01-01T00:00:00.000Z',
          hasLaunched: false
        }
      ],
      ui: {
        selectedRepositoryId: null,
        selectedThreadId: null
      }
    })

    expect(migrated.version).toBe(15)
    expect(migrated.threads[0]?.agentInterface).toBe('cli')
  })

  it('drops obsolete settings and converts legacy repository paths in version 13 state', () => {
    const migrated = migrateAppState({
      version: 13,
      settings: {
        obsoleteProvider: 'removed',
        globalFlagsInput: '--model gpt-5',
        terminalFontFamilyInput: '',
        taskTagsInput: 'bug'
      },
      repositories: [
        {
          id: 'repo-1',
          name: 'Repo',
          path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
          backend: {
            kind: 'wsl',
            distro: 'Ubuntu',
            windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
            linuxPath: '/home/me/repo'
          },
          faviconPath: null,
          runCommand: null,
          solutionFilePath: null,
          newWorktreeSetupCommand: null,
          postWorktreeRemoveCommand: null,
          addedAt: '2026-01-01T00:00:00.000Z',
          tasks: []
        }
      ],
      threads: [
        {
          id: 'thread-1',
          repositoryId: 'repo-1',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'worktree',
          branchName: 'feature',
          worktreePath: '/home/me/.taskmaster/worktrees/feature',
          sessionName: 'session-1',
          resumeSessionId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: '2026-01-01T00:00:00.000Z',
          hasLaunched: false
        }
      ],
      ui: {
        selectedRepositoryId: 'repo-1',
        selectedThreadId: null
      }
    })

    expect(migrated.version).toBe(15)
    expect(migrated.threads[0]?.agentInterface).toBe('cli')
    expect(migrated.settings).not.toHaveProperty('obsoleteProvider')
    expect(migrated.repositories[0]?.backend).toEqual({ kind: 'native' })
    expect(migrated.threads[0]?.worktreePath).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\.taskmaster\\worktrees\\feature'
    )
  })

  it('adds a null solution file path when migrating version 12 state', () => {
    const migrated = migrateAppState({
      version: 12,
      settings: {
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

    expect(migrated.version).toBe(15)
    expect(migrated.repositories[0]?.solutionFilePath).toBeNull()
  })
})
