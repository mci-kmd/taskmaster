import { homedir } from 'os'
import type {
  CopilotModelSelection,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositoryBackend
} from '../../../shared/app-types'
import { isSameModelSelection, normalizeCommitMessageModel } from '../../../shared/commit'
import {
  GENERAL_PROJECT_DEFAULTS,
  GENERAL_PROJECT_ID,
  isGeneralProject,
  normalizeGeneralProjectName
} from '../../../shared/general-project'
import { PROJECT_ICONS, PROJECT_ICON_COLORS } from '../../../shared/project-icons'
import { normalizeCopilotTitle } from '../../../shared/thread-title'
import { normalizeTaskTagsInput } from '../../../shared/task-tags'
import {
  assignTaskNumbers,
  normalizePersistedCompletedTasks,
  normalizePersistedTask
} from '../project-tasks/project-task-values'
import { normalizeRepositoryBackend } from '../../backends/repository-backend'
import {
  normalizeTerminalFontFamilyInput,
  DEFAULT_TASK_TAGS_INPUT
} from '../settings/settings-values'
import { normalizeRepositorySolutionFilePath } from '../repositories/repository-solution-file-service'
import {
  normalizeRepositoryPreviewUrl,
  normalizeRepositoryScript,
  normalizeRunCommand
} from '../repositories/repository-values'
import { normalizeTrackedText } from '../threads/thread-values'

export const STORE_FILENAME = 'taskmaster-state.json'
export const STATE_VERSION = 17 as const

function sameRepositoryBackend(
  left: RepositoryBackend,
  right: RepositoryBackend | undefined
): boolean {
  if (!right || left.kind !== right.kind) {
    return false
  }

  return true
}

export function normalizePersistedThread(thread: PersistedThread): PersistedThread {
  const latestCopilotTitle = normalizeCopilotTitle(thread.latestCopilotTitle)
  const lastUserMessage = normalizeTrackedText(thread.lastUserMessage ?? null)

  return latestCopilotTitle === thread.latestCopilotTitle &&
    lastUserMessage === thread.lastUserMessage
    ? thread
    : {
        ...thread,
        latestCopilotTitle,
        lastUserMessage
      }
}

export function createGeneralProject(
  addedAt: string,
  homePath: string = homedir()
): PersistedRepository {
  return {
    kind: 'general',
    id: GENERAL_PROJECT_ID,
    name: GENERAL_PROJECT_DEFAULTS.name,
    icon: GENERAL_PROJECT_DEFAULTS.icon,
    iconColor: GENERAL_PROJECT_DEFAULTS.iconColor,
    path: homePath,
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt,
    tasks: []
  }
}

/** Keeps only the settings the general project supports and follows the current home directory. */
function normalizeGeneralProject(
  repository: PersistedRepository,
  homePath: string
): PersistedRepository {
  const name = normalizeGeneralProjectName(repository.name) ?? GENERAL_PROJECT_DEFAULTS.name
  const icon = PROJECT_ICONS.some((item) => item.id === repository.icon)
    ? repository.icon
    : GENERAL_PROJECT_DEFAULTS.icon
  const iconColor = PROJECT_ICON_COLORS.some((item) => item.value === repository.iconColor)
    ? repository.iconColor
    : GENERAL_PROJECT_DEFAULTS.iconColor
  const { tasks, completedTasks } = assignTaskNumbers(
    Array.isArray(repository.tasks)
      ? repository.tasks.map((task) => normalizePersistedTask(task))
      : [],
    normalizePersistedCompletedTasks(repository.completedTasks)
  )
  const normalized: PersistedRepository = {
    ...createGeneralProject(repository.addedAt, homePath),
    id: repository.id,
    name,
    icon,
    iconColor,
    tasks,
    ...(completedTasks ? { completedTasks } : {})
  }
  return JSON.stringify(normalized) === JSON.stringify(repository) ? repository : normalized
}

export function ensureGeneralProject(
  repositories: PersistedRepository[],
  nowIso: () => string = () => new Date().toISOString(),
  homePath: string = homedir()
): PersistedRepository[] {
  const index = repositories.findIndex(isGeneralProject)
  if (index < 0) {
    return [createGeneralProject(nowIso(), homePath), ...repositories]
  }

  const general = normalizeGeneralProject(repositories[index], homePath)
  const duplicates = repositories.some(
    (repository, otherIndex) => otherIndex !== index && isGeneralProject(repository)
  )
  if (general === repositories[index] && !duplicates) {
    return repositories
  }

  return repositories.flatMap((repository, otherIndex) =>
    otherIndex === index ? [general] : isGeneralProject(repository) ? [] : [repository]
  )
}

export function normalizePersistedRepository(repository: PersistedRepository): PersistedRepository {
  if (isGeneralProject(repository)) {
    return repository
  }
  const backend = normalizeRepositoryBackend((repository as { backend?: unknown }).backend)
  const runCommand = normalizeRunCommand(repository.runCommand)
  const rawSolutionFilePath = (repository as { solutionFilePath?: unknown }).solutionFilePath
  const solutionFilePath = normalizeRepositorySolutionFilePath(
    typeof rawSolutionFilePath === 'string' || rawSolutionFilePath == null
      ? rawSolutionFilePath
      : null
  )
  const rawNewWorktreeSetupCommand = (repository as { newWorktreeSetupCommand?: unknown })
    .newWorktreeSetupCommand
  const newWorktreeSetupCommand = normalizeRepositoryScript(
    typeof rawNewWorktreeSetupCommand === 'string' || rawNewWorktreeSetupCommand == null
      ? rawNewWorktreeSetupCommand
      : null
  )
  const postWorktreeRemoveCommand = normalizeRepositoryScript(repository.postWorktreeRemoveCommand)
  const rawTaskTagsInput = (repository as { taskTagsInput?: unknown }).taskTagsInput
  const taskTagsInput =
    typeof rawTaskTagsInput === 'string' ? normalizeTaskTagsInput(rawTaskTagsInput) : undefined
  const rawPreviewUrl = (repository as { previewUrl?: unknown }).previewUrl
  const previewUrl = normalizeRepositoryPreviewUrl(rawPreviewUrl) ?? undefined
  const rawCommitMessageModel = (repository as { commitMessageModel?: unknown }).commitMessageModel
  const normalizedCommitMessageModel = normalizeCommitMessageModel(rawCommitMessageModel)
  const commitMessageModel =
    normalizedCommitMessageModel &&
    isSameModelSelection(
      normalizedCommitMessageModel,
      rawCommitMessageModel as CopilotModelSelection
    )
      ? (rawCommitMessageModel as CopilotModelSelection)
      : (normalizedCommitMessageModel ?? undefined)
  const rawAutoPush = (repository as { autoPushAfterCommit?: unknown }).autoPushAfterCommit
  const autoPushAfterCommit = rawAutoPush === true ? true : undefined
  const rawFavorite = (repository as { favorite?: unknown }).favorite
  const favorite = rawFavorite === true ? true : undefined
  const currentTasks = Array.isArray(repository.tasks) ? repository.tasks : []
  const rawCompletedTasks = (repository as { completedTasks?: unknown }).completedTasks
  const { tasks, completedTasks } = assignTaskNumbers(
    currentTasks.map((task) => normalizePersistedTask(task)),
    normalizePersistedCompletedTasks(rawCompletedTasks)
  )

  if (
    sameRepositoryBackend(backend, repository.backend) &&
    runCommand === repository.runCommand &&
    solutionFilePath === rawSolutionFilePath &&
    newWorktreeSetupCommand === repository.newWorktreeSetupCommand &&
    postWorktreeRemoveCommand === repository.postWorktreeRemoveCommand &&
    taskTagsInput === rawTaskTagsInput &&
    previewUrl === rawPreviewUrl &&
    commitMessageModel === rawCommitMessageModel &&
    autoPushAfterCommit === rawAutoPush &&
    favorite === rawFavorite &&
    completedTasks === rawCompletedTasks &&
    Array.isArray(repository.tasks) &&
    tasks.length === currentTasks.length &&
    tasks.every((task, index) => task === currentTasks[index])
  ) {
    return repository
  }

  const {
    taskTagsInput: _taskTagsInput,
    previewUrl: _previewUrl,
    commitMessageModel: _commitMessageModel,
    autoPushAfterCommit: _autoPushAfterCommit,
    favorite: _favorite,
    completedTasks: _completedTasks,
    ...rest
  } = repository
  void _taskTagsInput
  void _previewUrl
  void _commitMessageModel
  void _autoPushAfterCommit
  void _favorite
  void _completedTasks
  return {
    ...rest,
    backend,
    runCommand,
    solutionFilePath,
    newWorktreeSetupCommand,
    postWorktreeRemoveCommand,
    ...(previewUrl === undefined ? {} : { previewUrl }),
    ...(taskTagsInput === undefined ? {} : { taskTagsInput }),
    ...(commitMessageModel === undefined ? {} : { commitMessageModel }),
    ...(autoPushAfterCommit === undefined ? {} : { autoPushAfterCommit }),
    ...(favorite === undefined ? {} : { favorite }),
    tasks,
    ...(completedTasks === undefined ? {} : { completedTasks })
  }
}

export function normalizePersistedSettings(
  settings: PersistedAppState['settings']
): PersistedAppState['settings'] {
  const yoloEnabled = typeof settings.yoloEnabled === 'boolean' ? settings.yoloEnabled : true
  const terminalFontFamilyInput = normalizeTerminalFontFamilyInput(settings.terminalFontFamilyInput)
  const currentTaskTagsInput =
    typeof (settings as { taskTagsInput?: unknown }).taskTagsInput === 'string'
      ? (settings as { taskTagsInput: string }).taskTagsInput
      : undefined
  const taskTagsInput =
    currentTaskTagsInput === undefined
      ? DEFAULT_TASK_TAGS_INPUT
      : normalizeTaskTagsInput(currentTaskTagsInput)
  const favoriteCopilotModels = normalizeModelIds(settings.favoriteCopilotModels)
  const legacyCopilotModels = normalizeModelIds(settings.legacyCopilotModels)

  return yoloEnabled === settings.yoloEnabled &&
    terminalFontFamilyInput === settings.terminalFontFamilyInput &&
    taskTagsInput === currentTaskTagsInput &&
    favoriteCopilotModels === settings.favoriteCopilotModels &&
    legacyCopilotModels === settings.legacyCopilotModels
    ? settings
    : {
        ...settings,
        yoloEnabled,
        terminalFontFamilyInput,
        taskTagsInput,
        ...(favoriteCopilotModels ? { favoriteCopilotModels } : {}),
        ...(legacyCopilotModels ? { legacyCopilotModels } : {})
      }
}

export function normalizeModelIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  const models = [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item !== ''))
  ]
  return models.length === value.length ? (value as string[]) : models
}

export function normalizePersistedState(state: PersistedAppState): PersistedAppState {
  const settings = normalizePersistedSettings(state.settings)
  let didChange = settings !== state.settings
  const normalizedRepositories = state.repositories.map((repository) => {
    const normalizedRepository = normalizePersistedRepository(repository)
    if (normalizedRepository !== repository) {
      didChange = true
    }
    return normalizedRepository
  })
  const repositories = ensureGeneralProject(normalizedRepositories)
  if (repositories !== normalizedRepositories) {
    didChange = true
  }
  const threads = state.threads.map((thread) => {
    const normalizedThread = normalizePersistedThread(thread)
    if (normalizedThread !== thread) {
      didChange = true
    }
    return normalizedThread
  })

  return didChange
    ? {
        ...state,
        settings,
        repositories,
        threads
      }
    : state
}
