import { join } from 'path'
import type {
  AgentLaunchRequest,
  AgentProviderId,
  RepositoryBackend,
  TerminalStatus
} from '../../shared/app-types'
import { createNativeBackend } from '../backends/repository-backend'
import type {
  LlmProvider,
  LlmProviderLaunchContext,
  LlmProviderLaunchPreparation
} from '../ports/llm-provider'
import { LLM_CLI_PROVIDER_SPECS, type LlmCliProviderSpec } from './cli-provider-specs'

export type HookFileReaderState = {
  filePath: string
  offset: number
  remainder: string
}

export type CodexSessionReaderState = {
  cwd: string
  launchStartedAt: number
  mode: AgentLaunchRequest['mode']
  resumeSessionId: string | null
  sessionId: string | null
  filePath: string | null
  offset: number
  remainder: string
  emittedSessionStart: boolean
}

export type AgentLaunchContext = LlmProviderLaunchContext
export type AgentLaunchPreparation = LlmProviderLaunchPreparation<
  HookFileReaderState,
  HookFileReaderState,
  CodexSessionReaderState
>
export type AgentProvider = LlmProvider<
  HookFileReaderState,
  HookFileReaderState,
  CodexSessionReaderState
>

export type CliAgentProviderDependencies = {
  createStatus: (
    providerId: AgentProviderId,
    backend: RepositoryBackend,
    spec: LlmCliProviderSpec
  ) => TerminalStatus
  buildCommand: (
    commandPath: string,
    displayName: string,
    args: string[]
  ) => AgentLaunchPreparation['command']
  ensureTaskmasterHookConfig: (cwd: string) => void
  getTaskmasterHookEventsDir: () => string
  createHookFileReader: (filePath: string) => HookFileReaderState
  createCodexSessionReader: (context: AgentLaunchContext) => CodexSessionReaderState | null
  hookFiles: {
    sessionStartEnvName: string
    userPromptEnvName: string
  }
}

function createCopilotCliProvider(dependencies: CliAgentProviderDependencies): AgentProvider {
  const spec = LLM_CLI_PROVIDER_SPECS.copilot

  return {
    id: 'copilot',
    getStatus: (backend = createNativeBackend()) =>
      dependencies.createStatus('copilot', backend, spec),
    prepareLaunch: (commandPath: string, context: AgentLaunchContext): AgentLaunchPreparation => {
      const args = spec.buildArgs(context.cwd, context.launch, context.rawArgs)

      if (context.backend.kind === 'wsl') {
        return {
          command: dependencies.buildCommand(commandPath, spec.displayName, args),
          env: {},
          sessionStartReader: null,
          userPromptReader: null,
          codexSessionReader: null
        }
      }

      dependencies.ensureTaskmasterHookConfig(context.cwd)
      const hookEventsDir = dependencies.getTaskmasterHookEventsDir()
      const sessionStartReader = context.threadId
        ? dependencies.createHookFileReader(
            join(hookEventsDir, `${context.terminalId}-session-start.jsonl`)
          )
        : null
      const userPromptReader = context.threadId
        ? dependencies.createHookFileReader(
            join(hookEventsDir, `${context.terminalId}-user-prompt.jsonl`)
          )
        : null

      return {
        command: dependencies.buildCommand(commandPath, spec.displayName, args),
        env: {
          ...(sessionStartReader
            ? {
                [dependencies.hookFiles.sessionStartEnvName]: sessionStartReader.filePath
              }
            : {}),
          ...(userPromptReader
            ? {
                [dependencies.hookFiles.userPromptEnvName]: userPromptReader.filePath
              }
            : {})
        },
        sessionStartReader,
        userPromptReader,
        codexSessionReader: null
      }
    }
  }
}

function createCodexCliProvider(dependencies: CliAgentProviderDependencies): AgentProvider {
  const spec = LLM_CLI_PROVIDER_SPECS.codex

  return {
    id: 'codex',
    getStatus: (backend = createNativeBackend()) =>
      dependencies.createStatus('codex', backend, spec),
    prepareLaunch: (commandPath: string, context: AgentLaunchContext): AgentLaunchPreparation => ({
      command: dependencies.buildCommand(
        commandPath,
        spec.displayName,
        spec.buildArgs(context.cwd, context.launch, context.rawArgs)
      ),
      env: {},
      sessionStartReader: null,
      userPromptReader: null,
      codexSessionReader: dependencies.createCodexSessionReader(context)
    })
  }
}

export function createCliAgentProviders(
  dependencies: CliAgentProviderDependencies
): Record<AgentProviderId, AgentProvider> {
  return {
    copilot: createCopilotCliProvider(dependencies),
    codex: createCodexCliProvider(dependencies)
  }
}
