import { describe, expect, it, vi } from 'vitest'
import { createRepositoryService } from './repository-service'

describe('repository service', () => {
  it('updates repository settings when validated values change', () => {
    const saveState = vi.fn()
    const repository = {
      id: 'repo-1',
      path: 'C:\\repo',
      backend: { kind: 'native' as const },
      faviconPath: null,
      runCommand: null,
      newWorktreeSetupCommand: null,
      postWorktreeRemoveCommand: null
    }

    const service = createRepositoryService({
      ensureState: () => ({ repositories: [repository as never] }),
      findRepository: () => repository as never,
      saveState,
      updateSelection: () => {},
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      createId: () => 'repo-2',
      nowIso: () => '2026-01-01T00:00:00.000Z',
      platform: 'win32',
      selectRepositoryDirectory: async () => ({ canceled: true, filePaths: [] }),
      pickRepositoryFaviconFile: async () => ({ canceled: true, filePaths: [] }),
      parseWslUncPath: () => null,
      createNativeBackend: () => ({ kind: 'native' }),
      resolveGitRoot: () => null,
      isSameRepositoryPath: () => false,
      getBasename: () => 'repo',
      toUiPath: (_backend, path) => path,
      validateRepositoryFaviconInput: () => ({ ok: true, path: 'icons\\repo.ico' }),
      validateRepositoryFaviconAbsolutePath: () => ({ ok: true, path: 'icons\\repo.ico' }),
      validateRepositoryRunCommandInput: () => ({ ok: true, command: 'bun run dev' }),
      validateRepositoryNewWorktreeSetupCommandInput: () => ({ ok: true, command: 'setup' }),
      validateRepositoryPostWorktreeRemoveCommandInput: () => ({ ok: true, command: 'cleanup' })
    })

    const result = service.updateRepository({
      repositoryId: 'repo-1',
      faviconPath: 'icons\\repo.ico',
      runCommand: 'bun run dev',
      newWorktreeSetupCommand: 'setup',
      postWorktreeRemoveCommand: 'cleanup'
    })

    expect(result.ok).toBe(true)
    expect(repository).toMatchObject({
      faviconPath: 'icons\\repo.ico',
      runCommand: 'bun run dev',
      newWorktreeSetupCommand: 'setup',
      postWorktreeRemoveCommand: 'cleanup'
    })
    expect(saveState).toHaveBeenCalledTimes(1)
  })
})
