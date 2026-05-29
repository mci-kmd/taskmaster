import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositoryBackend
} from '../../../shared/app-types'
import { normalizeCopilotTitle } from '../../../shared/thread-title'
import { normalizeTaskTagsInput } from '../../../shared/task-tags'
import { normalizePersistedTask } from '../project-tasks/project-task-values'
import { normalizeRepositoryBackend } from '../../backends/repository-backend'
import {
  normalizeAgentProviderId,
  normalizeTerminalFontFamilyInput,
  DEFAULT_TASK_TAGS_INPUT
} from '../settings/settings-values'
import { normalizeRepositorySolutionFilePath } from '../repositories/repository-solution-file-service'
import { normalizeRepositoryScript, normalizeRunCommand } from '../repositories/repository-values'
import { normalizeTrackedText } from '../threads/thread-values'

export const STORE_FILENAME = 'taskmaster-state.json'
export const STATE_VERSION = 13 as const

function sameRepositoryBackend(
  left: RepositoryBackend,
  right: RepositoryBackend | undefined
): boolean {
  if (!right || left.kind !== right.kind) {
    return false
  }

  return left.kind === 'native'
    ? true
    : right.kind === 'wsl' &&
        left.distro === right.distro &&
        left.windowsPath === right.windowsPath &&
        left.linuxPath === right.linuxPath
}

export function normalizePersistedThread(thread: PersistedThread): PersistedThread {
  const latestCopilotTitle = normalizeCopilotTitle(thread, thread.latestCopilotTitle)
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

export function normalizePersistedRepository(repository: PersistedRepository): PersistedRepository {
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
  const currentTasks = Array.isArray(repository.tasks) ? repository.tasks : []
  const tasks = currentTasks.map((task) => normalizePersistedTask(task))

  return sameRepositoryBackend(backend, repository.backend) &&
    runCommand === repository.runCommand &&
    solutionFilePath === rawSolutionFilePath &&
    newWorktreeSetupCommand === repository.newWorktreeSetupCommand &&
    postWorktreeRemoveCommand === repository.postWorktreeRemoveCommand &&
    Array.isArray(repository.tasks) &&
    tasks.length === currentTasks.length &&
    tasks.every((task, index) => task === currentTasks[index])
    ? repository
    : {
        ...repository,
        backend,
        runCommand,
        solutionFilePath,
        newWorktreeSetupCommand,
        postWorktreeRemoveCommand,
        tasks
      }
}

export function normalizePersistedSettings(
  settings: PersistedAppState['settings']
): PersistedAppState['settings'] {
  const agentProviderId = normalizeAgentProviderId(
    (settings as { agentProviderId?: unknown }).agentProviderId
  )
  const terminalFontFamilyInput = normalizeTerminalFontFamilyInput(settings.terminalFontFamilyInput)
  const currentTaskTagsInput =
    typeof (settings as { taskTagsInput?: unknown }).taskTagsInput === 'string'
      ? (settings as { taskTagsInput: string }).taskTagsInput
      : undefined
  const taskTagsInput =
    currentTaskTagsInput === undefined
      ? DEFAULT_TASK_TAGS_INPUT
      : normalizeTaskTagsInput(currentTaskTagsInput)

  return agentProviderId === (settings as { agentProviderId?: unknown }).agentProviderId &&
    terminalFontFamilyInput === settings.terminalFontFamilyInput &&
    taskTagsInput === currentTaskTagsInput
    ? settings
    : {
        ...settings,
        agentProviderId,
        terminalFontFamilyInput,
        taskTagsInput
      }
}

export function normalizePersistedState(state: PersistedAppState): PersistedAppState {
  const settings = normalizePersistedSettings(state.settings)
  let didChange = settings !== state.settings
  const repositories = state.repositories.map((repository) => {
    const normalizedRepository = normalizePersistedRepository(repository)
    if (normalizedRepository !== repository) {
      didChange = true
    }
    return normalizedRepository
  })
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
