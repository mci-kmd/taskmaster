import type {
  PersistedAppState,
  PersistedRepository,
  PersistedSettings,
  PersistedThread
} from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { DEFAULT_TASK_TAGS_INPUT } from '../settings/settings-values'
import { normalizePersistedState, STATE_VERSION } from './app-state-values'

type LegacyThreadV1 = Omit<
  PersistedThread,
  'customTitle' | 'latestCopilotTitle' | 'lastUserMessage' | 'resumeSessionId'
> & {
  title: string
}
type LegacyThreadV2 = Omit<
  PersistedThread,
  'latestCopilotTitle' | 'lastUserMessage' | 'resumeSessionId'
>
type LegacyThreadV4 = Omit<PersistedThread, 'lastUserMessage' | 'resumeSessionId'>
type LegacyThreadV5 = Omit<PersistedThread, 'lastUserMessage'>
type LegacySettingsWithProvider = PersistedSettings & Record<string, unknown>
type LegacyRepositoryBackend =
  | PersistedRepository['backend']
  | {
      kind: 'wsl'
      distro: string
      windowsPath: string
      linuxPath: string
    }
type LegacyRepositoryV13 = Omit<PersistedRepository, 'backend'> & {
  backend: LegacyRepositoryBackend
}
type LegacyRepositoryV12 = Omit<PersistedRepository, 'backend' | 'solutionFilePath'> & {
  backend: LegacyRepositoryBackend
}
type LegacyRepositoryV11 = Omit<LegacyRepositoryV12, 'newWorktreeSetupCommand'>
type LegacyRepositoryV10 = Omit<LegacyRepositoryV12, 'backend' | 'newWorktreeSetupCommand'>
type LegacyRepositoryV8 = Omit<
  LegacyRepositoryV12,
  'backend' | 'newWorktreeSetupCommand' | 'postWorktreeRemoveCommand'
>
type LegacyRepositoryV7 = Omit<
  LegacyRepositoryV12,
  'backend' | 'newWorktreeSetupCommand' | 'postWorktreeRemoveCommand' | 'tasks'
>
type LegacyRepositoryV6 = Omit<
  LegacyRepositoryV12,
  'backend' | 'newWorktreeSetupCommand' | 'postWorktreeRemoveCommand' | 'runCommand' | 'tasks'
>
type LegacyRepositoryV3 = Omit<
  LegacyRepositoryV12,
  | 'backend'
  | 'newWorktreeSetupCommand'
  | 'postWorktreeRemoveCommand'
  | 'faviconPath'
  | 'runCommand'
  | 'tasks'
>
type LegacyAppStateV12 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 12
  settings: LegacySettingsWithProvider
  repositories: LegacyRepositoryV12[]
}
type LegacyAppStateV13 = Omit<PersistedAppState, 'version' | 'settings' | 'repositories'> & {
  version: 13
  settings: LegacySettingsWithProvider
  repositories: LegacyRepositoryV13[]
}
type LegacyAppStateV11 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 11
  settings: LegacySettingsWithProvider
  repositories: LegacyRepositoryV11[]
}
type LegacyAppStateV10 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 10
  settings: LegacySettingsWithProvider
  repositories: LegacyRepositoryV10[]
}
type LegacyAppStateV9 = Omit<PersistedAppState, 'version' | 'settings' | 'repositories'> & {
  version: 9
  settings: PersistedSettings
  repositories: LegacyRepositoryV10[]
}
type LegacyAppStateV8 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 8
  repositories: LegacyRepositoryV8[]
}
type LegacyAppStateV7 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 7
  repositories: LegacyRepositoryV7[]
}
type LegacyAppStateV6 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 6
  repositories: LegacyRepositoryV6[]
}
type LegacyAppStateV5 = Omit<PersistedAppState, 'version' | 'threads' | 'repositories'> & {
  version: 5
  repositories: LegacyRepositoryV6[]
  threads: LegacyThreadV5[]
}
type LegacyAppStateV4 = Omit<PersistedAppState, 'version' | 'threads' | 'repositories'> & {
  version: 4
  repositories: LegacyRepositoryV6[]
  threads: LegacyThreadV4[]
}
type LegacyAppStateV3 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 3
  repositories: LegacyRepositoryV3[]
}
type LegacyAppStateV2 = Omit<PersistedAppState, 'version' | 'threads'> & {
  version: 2
  repositories: LegacyRepositoryV3[]
  threads: LegacyThreadV2[]
}
type LegacyAppStateV1 = Omit<PersistedAppState, 'version' | 'threads'> & {
  version: 1
  repositories: LegacyRepositoryV3[]
  threads: LegacyThreadV1[]
}

type MigratedInput =
  | PersistedAppState
  | LegacyAppStateV13
  | LegacyAppStateV12
  | LegacyAppStateV11
  | LegacyAppStateV10
  | LegacyAppStateV9
  | LegacyAppStateV8
  | LegacyAppStateV7
  | LegacyAppStateV6
  | LegacyAppStateV5
  | LegacyAppStateV4
  | LegacyAppStateV3
  | LegacyAppStateV2
  | LegacyAppStateV1

export function createDefaultState(): PersistedAppState {
  return {
    version: STATE_VERSION,
    settings: {
      globalFlagsInput: '',
      terminalFontFamilyInput: '',
      taskTagsInput: DEFAULT_TASK_TAGS_INPUT
    },
    repositories: [],
    threads: [],
    ui: {
      selectedRepositoryId: null,
      selectedThreadId: null
    }
  }
}

function migrateSettings(
  settings: PersistedSettings | LegacySettingsWithProvider
): PersistedSettings {
  return {
    globalFlagsInput: settings.globalFlagsInput,
    terminalFontFamilyInput: settings.terminalFontFamilyInput,
    taskTagsInput: settings.taskTagsInput
  }
}

function migrateRepositoryBackend<
  Repository extends { path: string; backend: LegacyRepositoryBackend }
>(
  repository: Repository
): Omit<Repository, 'backend'> & { backend: PersistedRepository['backend'] } {
  return {
    ...repository,
    path: repository.backend.kind === 'wsl' ? repository.backend.windowsPath : repository.path,
    backend: createNativeBackend()
  }
}

function migrateThreadWorktreePaths<
  Repository extends { id: string; backend: LegacyRepositoryBackend }
>(repositories: Repository[], threads: PersistedThread[]): PersistedThread[] {
  const backendByRepositoryId = new Map(
    repositories.map((repository) => [repository.id, repository.backend])
  )

  return threads.map((thread) => {
    const backend = backendByRepositoryId.get(thread.repositoryId)
    if (backend?.kind !== 'wsl' || !thread.worktreePath?.startsWith('/')) {
      return thread
    }

    const suffix = thread.worktreePath.replaceAll('\\', '/').split('/').filter(Boolean).join('\\')
    return {
      ...thread,
      worktreePath: `\\\\wsl.localhost\\${backend.distro}${suffix ? `\\${suffix}` : ''}`
    }
  })
}

export function migrateAppState(parsed: unknown): PersistedAppState {
  const state = parsed as MigratedInput
  if (state.version === STATE_VERSION) {
    return normalizePersistedState(state)
  }

  if (state.version === 13) {
    const repositories = state.repositories.map(migrateRepositoryBackend)
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      settings: migrateSettings(state.settings),
      repositories,
      threads: migrateThreadWorktreePaths(state.repositories, state.threads)
    })
  }

  if (state.version === 12) {
    const repositories = state.repositories.map((repository) => ({
      ...migrateRepositoryBackend(repository),
      solutionFilePath: null
    }))
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      settings: migrateSettings(state.settings),
      repositories,
      threads: migrateThreadWorktreePaths(state.repositories, state.threads)
    })
  }

  if (state.version === 11) {
    const repositories = state.repositories.map((repository) => ({
      ...migrateRepositoryBackend(repository),
      solutionFilePath: null,
      newWorktreeSetupCommand: null
    }))
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      settings: migrateSettings(state.settings),
      repositories,
      threads: migrateThreadWorktreePaths(state.repositories, state.threads)
    })
  }

  if (state.version === 10) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      settings: migrateSettings(state.settings),
      repositories: state.repositories.map((repository) => ({
        ...repository,
        backend: createNativeBackend(),
        solutionFilePath: null,
        newWorktreeSetupCommand: null
      }))
    })
  }

  if (state.version === 9) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        backend: createNativeBackend(),
        solutionFilePath: null,
        newWorktreeSetupCommand: null
      }))
    })
  }

  if (state.version === 8) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        backend: createNativeBackend(),
        solutionFilePath: null,
        newWorktreeSetupCommand: null,
        postWorktreeRemoveCommand: null
      }))
    })
  }

  if (state.version === 7) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        backend: createNativeBackend(),
        solutionFilePath: null,
        newWorktreeSetupCommand: null,
        postWorktreeRemoveCommand: null,
        tasks: []
      }))
    })
  }

  if (state.version === 6) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        backend: createNativeBackend(),
        runCommand: null,
        solutionFilePath: null,
        newWorktreeSetupCommand: null,
        postWorktreeRemoveCommand: null,
        tasks: []
      }))
    })
  }

  const migratedRepositories = state.repositories.map((repository) => ({
    ...repository,
    backend: createNativeBackend(),
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    tasks: []
  }))

  if (state.version === 5) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: state.threads.map((thread) => ({
        ...thread,
        lastUserMessage: null
      }))
    })
  }

  if (state.version === 4) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: state.threads.map((thread) => ({
        ...thread,
        lastUserMessage: null,
        resumeSessionId: null
      }))
    })
  }

  if (state.version === 3) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: migratedRepositories
    })
  }

  if (state.version === 2) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: state.threads.map((thread) => ({
        ...thread,
        latestCopilotTitle: null,
        lastUserMessage: null,
        resumeSessionId: null
      }))
    })
  }

  if (state.version === 1) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: state.threads.map((thread) => {
        const trimmed = thread.title.trim()
        const looksAutoDerived = trimmed === '' || trimmed === thread.branchName
        const { title: _legacyTitle, ...rest } = thread
        void _legacyTitle
        return {
          ...rest,
          customTitle: looksAutoDerived ? null : trimmed,
          latestCopilotTitle: null,
          lastUserMessage: null,
          resumeSessionId: null
        }
      })
    })
  }

  throw new Error(`Unsupported state version: ${(state as { version: number }).version}`)
}
