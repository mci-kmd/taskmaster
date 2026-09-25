import { describe, expect, it, vi } from 'vitest'
import { createRepositoryService } from './repository-service'
import type { PersistedRepository } from '../../../shared/app-types'

function createTestRepository(overrides: Partial<PersistedRepository> = {}): PersistedRepository {
  return {
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
    tasks: [],
    ...overrides
  }
}

function createTestRepositoryService(
  overrides: Partial<Parameters<typeof createRepositoryService>[0]> = {}
): ReturnType<typeof createRepositoryService> {
  const repositories = overrides.ensureState?.().repositories ?? []

  return createRepositoryService({
    ensureState: () => ({ repositories }),
    findRepository: () => repositories[0],
    saveState: () => {},
    updateSelection: () => {},
    successResult: () => ({ ok: true }),
    failureResult: (error, cancelled) => ({ ok: false, error, cancelled }),
    createId: () => 'repo-2',
    nowIso: () => '2026-01-01T00:00:00.000Z',
    selectRepositoryDirectory: async () => ({ canceled: true, filePaths: [] }),
    confirmInitializeRepository: async () => ({ confirmed: false }),
    pickRepositoryFaviconFile: async () => ({ canceled: true, filePaths: [] }),
    pickRepositorySolutionFile: async () => ({ canceled: true, filePaths: [] }),
    createNativeBackend: () => ({ kind: 'native' }),
    resolveGitRoot: () => null,
    initializeGitRepository: () => {},
    isSameRepositoryPath: () => false,
    getBasename: () => 'repo',
    validateRepositoryFaviconInput: () => ({ ok: true, path: null }),
    validateRepositoryFaviconAbsolutePath: () => ({ ok: true, path: 'icons\\repo.ico' }),
    validateRepositoryRunCommandInput: () => ({ ok: true, command: null }),
    validateRepositorySolutionFileInput: () => ({ ok: true, path: null }),
    validateRepositorySolutionFileAbsolutePath: () => ({ ok: true, path: 'Taskmaster.slnx' }),
    validateRepositoryNewWorktreeSetupCommandInput: () => ({ ok: true, command: null }),
    validateRepositoryPostWorktreeRemoveCommandInput: () => ({ ok: true, command: null }),
    ...overrides
  })
}

describe('repository service', () => {
  it('reuses the configured project when its folder is added from inbox', async () => {
    const project = createTestRepository({ icon: 'code', runCommand: 'bun dev' })
    const state = {
      repositories: [project],
      ui: { selectedRepositoryId: null, selectedThreadId: null, viewMode: 'inbox' as const }
    }
    const select = vi.fn()
    const service = createTestRepositoryService({
      ensureState: () => state,
      updateSelection: select,
      selectRepositoryDirectory: async () => ({ canceled: false, filePaths: [project.path] }),
      resolveGitRoot: () => project.path,
      isSameRepositoryPath: () => true
    })
    await service.addRepository()
    expect(state.repositories).toEqual([project])
    expect(select).toHaveBeenCalledWith(project.id, null)
    expect(project).toMatchObject({ icon: 'code', runCommand: 'bun dev' })
  })

  it('saves icon-only edits and rejects unknown icon or color values', () => {
    const repository = createTestRepository()
    const service = createTestRepositoryService({ findRepository: () => repository })
    const input = {
      repositoryId: repository.id,
      faviconPath: null,
      runCommand: null,
      solutionFilePath: null,
      newWorktreeSetupCommand: null,
      postWorktreeRemoveCommand: null
    }
    expect(service.updateRepository({ ...input, icon: 'code', iconColor: '#7aa2f7' }).ok).toBe(true)
    expect(repository).toMatchObject({ icon: 'code', iconColor: '#7aa2f7' })
    expect(service.updateRepository({ ...input, icon: 'unknown' }).ok).toBe(false)
    expect(service.updateRepository({ ...input, iconColor: 'unknown' }).ok).toBe(false)
    expect(repository.icon).toBe('code')
  })

  it('saves normalized project task tags and skips unchanged tags', () => {
    const saveState = vi.fn()
    const repository = createTestRepository()
    const service = createTestRepositoryService({ findRepository: () => repository, saveState })
    const input = {
      repositoryId: repository.id,
      faviconPath: null,
      runCommand: null,
      solutionFilePath: null,
      newWorktreeSetupCommand: null,
      postWorktreeRemoveCommand: null
    }

    expect(service.updateRepository({ ...input, taskTagsInput: ' backend, ui\nUI ' }).ok).toBe(true)
    expect(repository.taskTagsInput).toBe('backend\nui')
    expect(service.updateRepository({ ...input, taskTagsInput: 'backend\nui' }).ok).toBe(true)
    expect(service.updateRepository(input).ok).toBe(true)
    expect(repository.taskTagsInput).toBe('backend\nui')
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('updates repository settings when validated values change', () => {
    const saveState = vi.fn()
    const repository = createTestRepository()

    const service = createTestRepositoryService({
      ensureState: () => ({ repositories: [repository] }),
      findRepository: () => repository,
      saveState,
      validateRepositoryFaviconInput: () => ({ ok: true, path: 'icons\\repo.ico' }),
      validateRepositoryRunCommandInput: () => ({ ok: true, command: 'bun run dev' }),
      validateRepositorySolutionFileInput: () => ({ ok: true, path: 'Taskmaster.slnx' }),
      validateRepositoryNewWorktreeSetupCommandInput: () => ({ ok: true, command: 'setup' }),
      validateRepositoryPostWorktreeRemoveCommandInput: () => ({ ok: true, command: 'cleanup' })
    })

    const result = service.updateRepository({
      repositoryId: 'repo-1',
      faviconPath: 'icons\\repo.ico',
      runCommand: 'bun run dev',
      solutionFilePath: 'Taskmaster.slnx',
      newWorktreeSetupCommand: 'setup',
      postWorktreeRemoveCommand: 'cleanup'
    })

    expect(result.ok).toBe(true)
    expect(repository).toMatchObject({
      faviconPath: 'icons\\repo.ico',
      runCommand: 'bun run dev',
      solutionFilePath: 'Taskmaster.slnx',
      newWorktreeSetupCommand: 'setup',
      postWorktreeRemoveCommand: 'cleanup'
    })
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('returns a validated solution path from the picker', async () => {
    const repository = createTestRepository()

    const service = createTestRepositoryService({
      ensureState: () => ({ repositories: [repository] }),
      findRepository: () => repository,
      pickRepositorySolutionFile: async () => ({
        canceled: false,
        filePaths: ['C:\\repo\\Taskmaster.slnx']
      })
    })

    await expect(service.pickRepositorySolutionFile('repo-1')).resolves.toEqual({
      ok: true,
      path: 'Taskmaster.slnx'
    })
  })

  it('asks to initialize a selected folder that is not a git repository', async () => {
    const repositories: PersistedRepository[] = []
    const saveState = vi.fn()
    const updateSelection = vi.fn()
    const confirmInitializeRepository = vi.fn(async () => ({ confirmed: true }))
    const initializeGitRepository = vi.fn()
    const resolveGitRoot = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('C:\\repo')

    const service = createTestRepositoryService({
      ensureState: () => ({ repositories }),
      saveState,
      updateSelection,
      selectRepositoryDirectory: async () => ({ canceled: false, filePaths: ['C:\\repo'] }),
      confirmInitializeRepository,
      resolveGitRoot,
      initializeGitRepository
    })

    await expect(service.addRepository()).resolves.toEqual({ ok: true })

    expect(confirmInitializeRepository).toHaveBeenCalledWith('C:\\repo')
    expect(initializeGitRepository).toHaveBeenCalledWith('C:\\repo', { kind: 'native' })
    expect(repositories).toHaveLength(1)
    expect(updateSelection).toHaveBeenCalledWith('repo-2', null)
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('does not add the project when git initialization is cancelled', async () => {
    const repositories: PersistedRepository[] = []
    const saveState = vi.fn()
    const initializeGitRepository = vi.fn()

    const service = createTestRepositoryService({
      ensureState: () => ({ repositories }),
      saveState,
      selectRepositoryDirectory: async () => ({ canceled: false, filePaths: ['C:\\repo'] }),
      confirmInitializeRepository: async () => ({ confirmed: false }),
      resolveGitRoot: () => null,
      initializeGitRepository
    })

    await expect(service.addRepository()).resolves.toEqual({
      ok: false,
      error: 'Repository initialization cancelled.',
      cancelled: true
    })
    expect(initializeGitRepository).not.toHaveBeenCalled()
    expect(repositories).toHaveLength(0)
    expect(saveState).not.toHaveBeenCalled()
  })
})
