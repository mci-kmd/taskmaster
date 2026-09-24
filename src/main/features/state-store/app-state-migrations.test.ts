import { describe, expect, it } from 'vitest'
import { createDefaultState, migrateAppState } from './app-state-migrations'

describe('app state migrations', () => {
  it('enables automatic approvals by default but preserves an explicit off setting', () => {
    const initial = createDefaultState()
    expect(initial.settings.yoloEnabled).toBe(true)
    expect(
      migrateAppState({
        ...initial,
        settings: { ...initial.settings, yoloEnabled: false }
      }).settings.yoloEnabled
    ).toBe(false)
  })

  it('discards version 14 terminal threads without migrating their sessions', () => {
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

    expect(migrated.version).toBe(16)
    expect(migrated.threads).toEqual([])
    expect(migrated.settings.yoloEnabled).toBe(true)
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

    expect(migrated.version).toBe(16)
    expect(migrated.threads).toEqual([])
    expect(migrated.settings).not.toHaveProperty('obsoleteProvider')
    expect(migrated.repositories[0]?.backend).toEqual({ kind: 'native' })
    expect(migrated.settings.yoloEnabled).toBe(true)
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

    expect(migrated.version).toBe(16)
    expect(migrated.repositories[0]?.solutionFilePath).toBeNull()
  })

  it('retains SDK sessions but drops CLI threads and obsolete flags from version 15', () => {
    const migrated = migrateAppState({
      version: 15,
      settings: {
        globalFlagsInput: '--model old',
        terminalFontFamilyInput: '',
        taskTagsInput: 'bug',
        lastCopilotModelSelection: { model: 'gpt-5', reasoningEffort: null }
      },
      repositories: [],
      threads: [
        {
          id: 'cli',
          agentInterface: 'cli',
          resumeSessionId: 'old-session',
          repositoryId: 'repo',
          mode: 'active-branch',
          branchName: 'main',
          worktreePath: null,
          sessionName: 'cli',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:00Z',
          hasLaunched: true
        },
        {
          id: 'sdk',
          agentInterface: 'custom',
          resumeSessionId: 'sdk-session',
          repositoryId: 'repo',
          mode: 'active-branch',
          branchName: 'main',
          worktreePath: null,
          sessionName: 'sdk',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:00Z',
          hasLaunched: true
        }
      ],
      ui: {
        selectedRepositoryId: null,
        selectedThreadId: 'cli',
        modeSelections: {
          projects: { repositoryId: 'repo', threadId: 'cli' },
          inbox: { repositoryId: 'repo', threadId: 'sdk' }
        }
      }
    })

    expect(migrated.threads).toHaveLength(1)
    expect(migrated.threads[0]).toMatchObject({ id: 'sdk', resumeSessionId: 'sdk-session' })
    expect(migrated.threads[0]).not.toHaveProperty('agentInterface')
    expect(migrated.threads[0]).not.toHaveProperty('sessionName')
    expect(migrated.ui.selectedThreadId).toBeNull()
    expect(migrated.ui.modeSelections).toEqual({
      projects: { repositoryId: 'repo', threadId: null },
      inbox: { repositoryId: 'repo', threadId: 'sdk' }
    })
    expect(migrated.settings).toEqual({
      yoloEnabled: true,
      terminalFontFamilyInput: '',
      taskTagsInput: 'bug',
      lastCopilotModelSelection: { model: 'gpt-5', reasoningEffort: null }
    })
  })
})
