import type {
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PickRepositoryFaviconResult,
  RepositoryBackend,
  UpdateRepositoryInput
} from '../../../shared/app-types'

type FilePickerResult = {
  canceled: boolean
  filePaths: string[]
}

type RepositoryServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'repositories'>
  findRepository: (repositoryId: string) => PersistedRepository | undefined
  saveState: () => void
  updateSelection: (repositoryId: string | null, threadId: string | null) => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  createId: () => string
  nowIso: () => string
  platform: NodeJS.Platform
  selectRepositoryDirectory: () => Promise<FilePickerResult>
  pickRepositoryFaviconFile: (repository: PersistedRepository) => Promise<FilePickerResult>
  parseWslUncPath: (path: string) => RepositoryBackend | null
  createNativeBackend: () => RepositoryBackend
  resolveGitRoot: (path: string, backend: RepositoryBackend) => string | null
  isSameRepositoryPath: (
    leftPath: string,
    leftBackend: RepositoryBackend,
    rightPath: string,
    rightBackend: RepositoryBackend
  ) => boolean
  getBasename: (path: string, backend: RepositoryBackend) => string
  toUiPath: (backend: RepositoryBackend, executionPath: string) => string
  validateRepositoryFaviconInput: (
    repositoryPath: string,
    faviconPath: string | null
  ) => { ok: true; path: string | null } | { ok: false; error: string }
  validateRepositoryFaviconAbsolutePath: (
    repositoryPath: string,
    faviconPath: string
  ) => PickRepositoryFaviconResult
  validateRepositoryRunCommandInput: (
    value: string | null
  ) => { ok: true; command: string | null } | { ok: false }
  validateRepositoryNewWorktreeSetupCommandInput: (
    value: string | null
  ) => { ok: true; command: string | null } | { ok: false }
  validateRepositoryPostWorktreeRemoveCommandInput: (
    value: string | null
  ) => { ok: true; command: string | null } | { ok: false }
}

export function createRepositoryService(dependencies: RepositoryServiceDependencies): {
  addRepository: () => Promise<MutationResult>
  updateRepository: (input: UpdateRepositoryInput) => MutationResult
  pickRepositoryFavicon: (repositoryId: string) => Promise<PickRepositoryFaviconResult>
} {
  return {
    addRepository: async (): Promise<MutationResult> => {
      const dialogResult = await dependencies.selectRepositoryDirectory()
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return dependencies.failureResult('Repository selection cancelled.', true)
      }

      const selectedPath = dialogResult.filePaths[0]
      const selectedWslBackend =
        dependencies.platform === 'win32' ? dependencies.parseWslUncPath(selectedPath) : null
      const selectedExecutionPath =
        selectedWslBackend?.kind === 'wsl' ? selectedWslBackend.linuxPath : selectedPath
      const selectedBackend = selectedWslBackend ?? dependencies.createNativeBackend()
      const gitRoot = dependencies.resolveGitRoot(selectedExecutionPath, selectedBackend)
      if (!gitRoot) {
        return dependencies.failureResult('Selected folder is not inside a git repository.')
      }

      const backend =
        selectedBackend.kind === 'wsl'
          ? {
              kind: 'wsl' as const,
              distro: selectedBackend.distro,
              windowsPath: dependencies.toUiPath(selectedBackend, gitRoot),
              linuxPath: gitRoot
            }
          : selectedBackend
      const repositoryPath = backend.kind === 'wsl' ? backend.windowsPath : gitRoot

      const state = dependencies.ensureState()
      const existing = state.repositories.find((repository) =>
        dependencies.isSameRepositoryPath(
          repository.path,
          repository.backend,
          repositoryPath,
          backend
        )
      )
      if (existing) {
        dependencies.updateSelection(existing.id, null)
        dependencies.saveState()
        return dependencies.successResult()
      }

      state.repositories.push({
        id: dependencies.createId(),
        name: dependencies.getBasename(gitRoot, backend),
        path: repositoryPath,
        backend,
        faviconPath: null,
        runCommand: null,
        newWorktreeSetupCommand: null,
        postWorktreeRemoveCommand: null,
        addedAt: dependencies.nowIso(),
        tasks: []
      })
      dependencies.updateSelection(
        state.repositories[state.repositories.length - 1]?.id ?? null,
        null
      )
      dependencies.saveState()
      return dependencies.successResult()
    },

    updateRepository: (input: UpdateRepositoryInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const faviconValidation = dependencies.validateRepositoryFaviconInput(
        repository.path,
        input.faviconPath
      )
      if (!faviconValidation.ok) {
        return dependencies.failureResult(faviconValidation.error)
      }

      const runCommandValidation = dependencies.validateRepositoryRunCommandInput(input.runCommand)
      if (!runCommandValidation.ok) {
        return dependencies.failureResult('Run command is invalid.')
      }

      const newWorktreeSetupCommandValidation =
        dependencies.validateRepositoryNewWorktreeSetupCommandInput(input.newWorktreeSetupCommand)
      if (!newWorktreeSetupCommandValidation.ok) {
        return dependencies.failureResult('New worktree setup script is invalid.')
      }

      const postWorktreeRemoveCommandValidation =
        dependencies.validateRepositoryPostWorktreeRemoveCommandInput(
          input.postWorktreeRemoveCommand
        )
      if (!postWorktreeRemoveCommandValidation.ok) {
        return dependencies.failureResult('Post-worktree-remove script is invalid.')
      }

      if (
        repository.faviconPath === faviconValidation.path &&
        repository.runCommand === runCommandValidation.command &&
        repository.newWorktreeSetupCommand === newWorktreeSetupCommandValidation.command &&
        repository.postWorktreeRemoveCommand === postWorktreeRemoveCommandValidation.command
      ) {
        return dependencies.successResult()
      }

      repository.faviconPath = faviconValidation.path
      repository.runCommand = runCommandValidation.command
      repository.newWorktreeSetupCommand = newWorktreeSetupCommandValidation.command
      repository.postWorktreeRemoveCommand = postWorktreeRemoveCommandValidation.command
      dependencies.saveState()
      return dependencies.successResult()
    },

    pickRepositoryFavicon: async (repositoryId: string): Promise<PickRepositoryFaviconResult> => {
      const repository = dependencies.findRepository(repositoryId)
      if (!repository) {
        return { ok: false, error: 'Repository not found.' }
      }

      const dialogResult = await dependencies.pickRepositoryFaviconFile(repository)
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { ok: false, cancelled: true }
      }

      return dependencies.validateRepositoryFaviconAbsolutePath(
        repository.path,
        dialogResult.filePaths[0]
      )
    }
  }
}
