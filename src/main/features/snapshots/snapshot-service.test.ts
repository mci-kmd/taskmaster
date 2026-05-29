import { describe, expect, it } from 'vitest'
import { createSnapshotService } from './snapshot-service'

describe('snapshot service', () => {
  it('builds repository, thread, and settings snapshots from dependencies', () => {
    const state = {
      version: 13 as const,
      settings: {
        agentProviderId: 'copilot' as const,
        globalFlagsInput: '--model gpt-5',
        terminalFontFamilyInput: '',
        taskTagsInput: 'bug'
      },
      repositories: [
        {
          id: 'repo-1',
          name: 'Repo',
          path: 'C:\\repo',
          backend: { kind: 'native' as const },
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
          mode: 'active-branch' as const,
          branchName: 'main',
          worktreePath: null,
          sessionName: 'session',
          resumeSessionId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: '2026-01-01T00:00:00.000Z',
          hasLaunched: false
        }
      ],
      ui: {
        selectedRepositoryId: 'repo-1',
        selectedThreadId: 'thread-1',
        sidebarWidth: 9999
      }
    }

    const snapshots = createSnapshotService({
      ensureState: () => state,
      getRunningThreadIds: () => new Set(['thread-1']),
      getRunningRunThreadIds: () => new Set<string>(),
      getRepositoryGitState: () => ({
        currentBranch: 'main',
        primaryBranch: 'main',
        branchOptions: [],
        worktreeOptions: []
      }),
      refreshRepositoryGitState: async () => ({
        currentBranch: 'main',
        primaryBranch: 'main',
        branchOptions: [],
        worktreeOptions: []
      }),
      getThreadUiCwd: () => 'C:\\repo',
      getThreadExecutionCwd: () => 'C:\\repo',
      buildRepositoryFaviconUrl: () => null,
      parseGlobalFlags: (input) => input.split(' '),
      parseTaskTagsInput: (input) => input.split(' '),
      resolveTerminalFontFamily: () => 'monospace',
      sidebarWidth: {
        default: 268,
        min: 220,
        max: 560
      },
      sanitizeUserFacingMessage: (value) => value
    })

    const snapshot = snapshots.buildSnapshot()
    expect(snapshot.sidebarWidth).toBe(560)
    expect(snapshot.repositories[0]?.threads[0]).toMatchObject({
      id: 'thread-1',
      isRunning: true,
      cwd: 'C:\\repo'
    })
    expect(snapshot.settings.parsedGlobalFlags).toEqual(['--model', 'gpt-5'])
  })

  it('builds async refreshed snapshots without forcing sync git refreshes', async () => {
    const state = {
      version: 13 as const,
      settings: {
        agentProviderId: 'copilot' as const,
        globalFlagsInput: '',
        terminalFontFamilyInput: '',
        taskTagsInput: ''
      },
      repositories: [
        {
          id: 'repo-1',
          name: 'Repo',
          path: 'C:\\repo',
          backend: { kind: 'native' as const },
          faviconPath: null,
          runCommand: null,
          solutionFilePath: null,
          newWorktreeSetupCommand: null,
          postWorktreeRemoveCommand: null,
          addedAt: '2026-01-01T00:00:00.000Z',
          tasks: []
        }
      ],
      threads: [],
      ui: {
        selectedRepositoryId: null,
        selectedThreadId: null
      }
    }
    let syncRefreshCount = 0
    let asyncRefreshCount = 0

    const snapshots = createSnapshotService({
      ensureState: () => state,
      getRunningThreadIds: () => new Set<string>(),
      getRunningRunThreadIds: () => new Set<string>(),
      getRepositoryGitState: (_repository, refreshGit) => {
        if (refreshGit) {
          syncRefreshCount += 1
        }
        return {
          currentBranch: 'Loading...',
          primaryBranch: null,
          branchOptions: [],
          worktreeOptions: []
        }
      },
      refreshRepositoryGitState: async () => {
        asyncRefreshCount += 1
        return {
          currentBranch: 'main',
          primaryBranch: 'main',
          branchOptions: [],
          worktreeOptions: []
        }
      },
      getThreadUiCwd: () => 'C:\\repo',
      getThreadExecutionCwd: () => 'C:\\repo',
      buildRepositoryFaviconUrl: () => null,
      parseGlobalFlags: () => [],
      parseTaskTagsInput: () => [],
      resolveTerminalFontFamily: () => 'monospace',
      sidebarWidth: {
        default: 268,
        min: 220,
        max: 560
      },
      sanitizeUserFacingMessage: (value) => value
    })

    const initialSnapshot = snapshots.buildSnapshot()
    expect(initialSnapshot.repositories[0]?.currentBranch).toBe('Loading...')
    expect(syncRefreshCount).toBe(0)

    const refreshedSnapshot = await snapshots.buildSnapshotAsync({ refreshGit: true })
    expect(refreshedSnapshot.repositories[0]?.currentBranch).toBe('main')
    expect(syncRefreshCount).toBe(0)
    expect(asyncRefreshCount).toBe(1)
  })

  it('prioritizes startup git refreshes for repositories with recent thread activity', async () => {
    const state = {
      version: 13 as const,
      settings: {
        agentProviderId: 'copilot' as const,
        globalFlagsInput: '',
        terminalFontFamilyInput: '',
        taskTagsInput: ''
      },
      repositories: [
        {
          id: 'repo-dormant',
          name: 'Dormant',
          path: 'C:\\repo-dormant',
          backend: { kind: 'native' as const },
          faviconPath: null,
          runCommand: null,
          solutionFilePath: null,
          newWorktreeSetupCommand: null,
          postWorktreeRemoveCommand: null,
          addedAt: '2026-01-01T00:00:00.000Z',
          tasks: []
        },
        {
          id: 'repo-hot',
          name: 'Hot',
          path: 'C:\\repo-hot',
          backend: { kind: 'native' as const },
          faviconPath: null,
          runCommand: null,
          solutionFilePath: null,
          newWorktreeSetupCommand: null,
          postWorktreeRemoveCommand: null,
          addedAt: '2026-01-01T00:00:00.000Z',
          tasks: []
        },
        {
          id: 'repo-warm',
          name: 'Warm',
          path: 'C:\\repo-warm',
          backend: { kind: 'native' as const },
          faviconPath: null,
          runCommand: null,
          solutionFilePath: null,
          newWorktreeSetupCommand: null,
          postWorktreeRemoveCommand: null,
          addedAt: '2026-01-01T00:00:00.000Z',
          tasks: []
        },
        {
          id: 'repo-empty',
          name: 'Empty',
          path: 'C:\\repo-empty',
          backend: { kind: 'native' as const },
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
          id: 'thread-warm',
          repositoryId: 'repo-warm',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'active-branch' as const,
          branchName: 'warm',
          worktreePath: null,
          sessionName: 'session',
          resumeSessionId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: '2026-01-02T00:00:00.000Z',
          hasLaunched: false
        },
        {
          id: 'thread-hot',
          repositoryId: 'repo-hot',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'active-branch' as const,
          branchName: 'hot',
          worktreePath: null,
          sessionName: 'session',
          resumeSessionId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: '2026-01-03T00:00:00.000Z',
          hasLaunched: false
        },
        {
          id: 'thread-dormant',
          repositoryId: 'repo-dormant',
          customTitle: null,
          latestCopilotTitle: null,
          lastUserMessage: null,
          mode: 'active-branch' as const,
          branchName: 'dormant',
          worktreePath: null,
          sessionName: 'session',
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
    }
    const refreshOrder: string[] = []

    const snapshots = createSnapshotService({
      ensureState: () => state,
      getRunningThreadIds: () => new Set<string>(),
      getRunningRunThreadIds: () => new Set<string>(),
      getRepositoryGitState: () => ({
        currentBranch: 'Loading...',
        primaryBranch: null,
        branchOptions: [],
        worktreeOptions: []
      }),
      refreshRepositoryGitState: async (repository) => {
        refreshOrder.push(repository.id)
        return {
          currentBranch: repository.name,
          primaryBranch: 'main',
          branchOptions: [],
          worktreeOptions: []
        }
      },
      getThreadUiCwd: () => 'C:\\repo',
      getThreadExecutionCwd: () => 'C:\\repo',
      buildRepositoryFaviconUrl: () => null,
      parseGlobalFlags: () => [],
      parseTaskTagsInput: () => [],
      resolveTerminalFontFamily: () => 'monospace',
      sidebarWidth: {
        default: 268,
        min: 220,
        max: 560
      },
      sanitizeUserFacingMessage: (value) => value
    })

    await snapshots.buildSnapshotAsync({ refreshGit: true })

    expect(refreshOrder).toEqual(['repo-hot', 'repo-warm', 'repo-dormant', 'repo-empty'])
  })
})
