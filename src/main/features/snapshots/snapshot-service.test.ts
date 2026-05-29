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
})
