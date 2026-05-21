import type {
  AgentLaunchRequest,
  AgentProviderId,
  RepositoryBackend,
  TerminalStatus
} from '../../shared/app-types'
import type { BackendCommand } from '../backends/repository-backend'

export type LlmProviderLaunchContext = {
  cwd: string
  backend: RepositoryBackend
  terminalId: string
  threadId?: string
  launch?: AgentLaunchRequest
  rawArgs?: string[]
}

export type LlmProviderLaunchPreparation<
  SessionStartReader = unknown,
  UserPromptReader = unknown,
  ProviderSessionReader = unknown
> = {
  command: BackendCommand
  env: NodeJS.ProcessEnv
  sessionStartReader: SessionStartReader | null
  userPromptReader: UserPromptReader | null
  codexSessionReader: ProviderSessionReader | null
}

export type LlmProvider<
  SessionStartReader = unknown,
  UserPromptReader = unknown,
  ProviderSessionReader = unknown
> = {
  id: AgentProviderId
  getStatus: (backend?: RepositoryBackend) => TerminalStatus
  prepareLaunch: (
    commandPath: string,
    context: LlmProviderLaunchContext
  ) => LlmProviderLaunchPreparation<SessionStartReader, UserPromptReader, ProviderSessionReader>
}
