import { PROJECT_ICONS, PROJECT_ICON_COLORS } from '../../../shared/project-icons'
import type {
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PickRepositoryFaviconResult,
  PickRepositorySolutionFileResult,
  RepositoryBackend,
  UpdateRepositoryInput
} from '../../../shared/app-types'
import { normalizeTaskTagsInput } from '../../../shared/task-tags'

type FilePickerResult = {
  canceled: boolean
  filePaths: string[]
}

type ConfirmInitializeRepositoryResult = {
  confirmed: boolean
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
  selectRepositoryDirectory: () => Promise<FilePickerResult>
  confirmInitializeRepository: (path: string) => Promise<ConfirmInitializeRepositoryResult>
  pickRepositoryFaviconFile: (repository: PersistedRepository) => Promise<FilePickerResult>
  pickRepositorySolutionFile: (repository: PersistedRepository) => Promise<FilePickerResult>
  createNativeBackend: () => RepositoryBackend
  resolveGitRoot: (path: string, backend: RepositoryBackend) => string | null
  initializeGitRepository: (path: string, backend: RepositoryBackend) => void
  isSameRepositoryPath: (
    leftPath: string,
    leftBackend: RepositoryBackend,
    rightPath: string,
    rightBackend: RepositoryBackend
  ) => boolean
  getBasename: (path: string, backend: RepositoryBackend) => string
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
  validateRepositorySolutionFileInput: (
    repositoryPath: string,
    value: string | null
  ) => { ok: true; path: string | null } | { ok: false; error: string }
  validateRepositorySolutionFileAbsolutePath: (
    repositoryPath: string,
    value: string
  ) => PickRepositorySolutionFileResult
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
  pickRepositorySolutionFile: (repositoryId: string) => Promise<PickRepositorySolutionFileResult>
} {
  return {
    addRepository: async (): Promise<MutationResult> => {
      const dialogResult = await dependencies.selectRepositoryDirectory()
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return dependencies.failureResult('Repository selection cancelled.', true)
      }

      const selectedPath = dialogResult.filePaths[0]
      const selectedBackend = dependencies.createNativeBackend()
      let gitRoot = dependencies.resolveGitRoot(selectedPath, selectedBackend)
      if (!gitRoot) {
        const confirmation = await dependencies.confirmInitializeRepository(selectedPath)
        if (!confirmation.confirmed) {
          return dependencies.failureResult('Repository initialization cancelled.', true)
        }

        try {
          dependencies.initializeGitRepository(selectedPath, selectedBackend)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return dependencies.failureResult(`Failed to initialize git repository: ${message}`)
        }

        gitRoot = dependencies.resolveGitRoot(selectedPath, selectedBackend)
        if (!gitRoot) {
          return dependencies.failureResult('Failed to initialize git repository.')
        }
      }

      const backend = selectedBackend
      const repositoryPath = gitRoot

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
        solutionFilePath: null,
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

      if (input.icon !== undefined && !PROJECT_ICONS.some((icon) => icon.id === input.icon)) {
        return dependencies.failureResult('Invalid project icon.')
      }
      if (
        input.iconColor !== undefined &&
        !PROJECT_ICON_COLORS.some((color) => color.value === input.iconColor)
      ) {
        return dependencies.failureResult('Invalid project icon color.')
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

      const solutionFileValidation = dependencies.validateRepositorySolutionFileInput(
        repository.path,
        input.solutionFilePath
      )
      if (!solutionFileValidation.ok) {
        return dependencies.failureResult(solutionFileValidation.error)
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

      const taskTagsInput =
        input.taskTagsInput === undefined
          ? (repository.taskTagsInput ?? '')
          : normalizeTaskTagsInput(input.taskTagsInput)

      if (
        (input.icon === undefined || input.icon === repository.icon) &&
        (input.iconColor === undefined || input.iconColor === repository.iconColor) &&
        repository.faviconPath === faviconValidation.path &&
        repository.runCommand === runCommandValidation.command &&
        repository.solutionFilePath === solutionFileValidation.path &&
        repository.newWorktreeSetupCommand === newWorktreeSetupCommandValidation.command &&
        repository.postWorktreeRemoveCommand === postWorktreeRemoveCommandValidation.command &&
        (repository.taskTagsInput ?? '') === taskTagsInput
      ) {
        return dependencies.successResult()
      }

      if (input.icon !== undefined) repository.icon = input.icon
      if (input.iconColor !== undefined) repository.iconColor = input.iconColor
      repository.faviconPath = faviconValidation.path
      repository.runCommand = runCommandValidation.command
      repository.solutionFilePath = solutionFileValidation.path
      repository.newWorktreeSetupCommand = newWorktreeSetupCommandValidation.command
      repository.postWorktreeRemoveCommand = postWorktreeRemoveCommandValidation.command
      if (input.taskTagsInput !== undefined) repository.taskTagsInput = taskTagsInput
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
    },

    pickRepositorySolutionFile: async (
      repositoryId: string
    ): Promise<PickRepositorySolutionFileResult> => {
      const repository = dependencies.findRepository(repositoryId)
      if (!repository) {
        return { ok: false, error: 'Repository not found.' }
      }

      const dialogResult = await dependencies.pickRepositorySolutionFile(repository)
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { ok: false, cancelled: true }
      }

      return dependencies.validateRepositorySolutionFileAbsolutePath(
        repository.path,
        dialogResult.filePaths[0]
      )
    }
  }
}
