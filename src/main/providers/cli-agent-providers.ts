import { join } from 'path'
import type { RepositoryBackend, TerminalStatus } from '../../shared/app-types'
import { createNativeBackend } from '../backends/repository-backend'
import type {
  LlmProvider,
  LlmProviderLaunchContext,
  LlmProviderLaunchPreparation
} from '../ports/llm-provider'
import { COPILOT_CLI_PROVIDER_SPEC, type LlmCliProviderSpec } from './cli-provider-specs'

export type HookFileReaderState = {
  filePath: string
  offset: number
  remainder: string
}

export type AgentLaunchContext = LlmProviderLaunchContext
export type AgentLaunchPreparation = LlmProviderLaunchPreparation<
  HookFileReaderState,
  HookFileReaderState
>
export type AgentProvider = LlmProvider<HookFileReaderState, HookFileReaderState>

export type CliAgentProviderDependencies = {
  createStatus: (backend: RepositoryBackend, spec: LlmCliProviderSpec) => Promise<TerminalStatus>
  buildCommand: (
    commandPath: string,
    displayName: string,
    args: string[]
  ) => AgentLaunchPreparation['command']
  ensureTaskmasterHookConfig: (cwd: string) => void
  getTaskmasterHookEventsDir: () => string
  createHookFileReader: (filePath: string) => HookFileReaderState
  hookFiles: {
    sessionStartEnvName: string
    userPromptEnvName: string
  }
}

export function createCopilotCliProvider(
  dependencies: CliAgentProviderDependencies
): AgentProvider {
  const spec = COPILOT_CLI_PROVIDER_SPEC

  return {
    getStatus: (backend = createNativeBackend()) => dependencies.createStatus(backend, spec),
    prepareLaunch: (commandPath: string, context: AgentLaunchContext): AgentLaunchPreparation => {
      const args = spec.buildArgs(context.cwd, context.launch, context.rawArgs)

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
        userPromptReader
      }
    }
  }
}
