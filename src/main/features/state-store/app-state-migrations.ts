import type {
  PersistedAppState,
  PersistedRepository,
  PersistedThread
} from '../../../shared/app-types'
import { DEFAULT_AGENT_PROVIDER_ID } from '../../../shared/agent-providers'
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
type LegacySettingsV9 = Omit<PersistedAppState['settings'], 'agentProviderId'>
type LegacyRepositoryV12 = Omit<PersistedRepository, 'solutionFilePath'>
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
  repositories: LegacyRepositoryV12[]
}
type LegacyAppStateV11 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 11
  repositories: LegacyRepositoryV11[]
}
type LegacyAppStateV10 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 10
  repositories: LegacyRepositoryV10[]
}
type LegacyAppStateV9 = Omit<PersistedAppState, 'version' | 'settings' | 'repositories'> & {
  version: 9
  settings: LegacySettingsV9
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
      agentProviderId: DEFAULT_AGENT_PROVIDER_ID,
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

export function migrateAppState(parsed: unknown): PersistedAppState {
  const state = parsed as MigratedInput
  if (state.version === STATE_VERSION) {
    return normalizePersistedState(state)
  }

  if (state.version === 12) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        solutionFilePath: null
      }))
    })
  }

  if (state.version === 11) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        solutionFilePath: null,
        newWorktreeSetupCommand: null
      }))
    })
  }

  if (state.version === 10) {
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

  if (state.version === 9) {
    return normalizePersistedState({
      ...state,
      version: STATE_VERSION,
      settings: {
        ...state.settings,
        agentProviderId: DEFAULT_AGENT_PROVIDER_ID
      },
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
