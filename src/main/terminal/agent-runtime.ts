import type { RepositoryBackend, TerminalStatus } from '../../shared/app-types'
import { COPILOT_LABEL } from '../../shared/copilot'
import { createNativeBackend } from '../backends/repository-backend'
import { createCopilotCliProvider, type AgentProvider } from '../providers/cli-agent-providers'
import {
  createHookFileReader,
  ensureTaskmasterHookConfig,
  TASKMASTER_SESSION_START_FILE_ENV,
  TASKMASTER_USER_PROMPT_FILE_ENV
} from './copilot-hooks'
import { quoteCmdArgument, resolveCommandOnPathAsync } from './command-utils'
import type { TerminalCommand } from './types'

type TerminalAgentRuntimeDependencies = {
  getDefaultCwd: () => string
  getTaskmasterHookEventsDir: () => string
}

function buildCommand(
  commandPath: string,
  displayName: string,
  args: string[] = []
): TerminalCommand {
  const displayCommand = [displayName, ...args].join(' ').trim()

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)) {
    const command = [quoteCmdArgument(commandPath), ...args.map(quoteCmdArgument)].join(' ')
    return {
      file: process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', command],
      displayCommand
    }
  }

  return {
    file: commandPath,
    args,
    displayCommand
  }
}

export function createTerminalAgentRuntime(dependencies: TerminalAgentRuntimeDependencies): {
  getAgentProvider: () => AgentProvider
  getAgentStatus: (provider: AgentProvider, backend?: RepositoryBackend) => Promise<TerminalStatus>
} {
  function createAgentStatus(
    commandPath: string | null,
    messages: {
      unavailable: string
      available: string
    }
  ): TerminalStatus {
    const defaultCwd = dependencies.getDefaultCwd()

    if (!commandPath) {
      return {
        available: false,
        label: COPILOT_LABEL,
        defaultCwd,
        message: messages.unavailable
      }
    }

    return {
      available: true,
      label: COPILOT_LABEL,
      commandPath,
      defaultCwd,
      message: messages.available
    }
  }

  const agentProvider = createCopilotCliProvider({
    createStatus: async (_backend, spec) =>
      createAgentStatus(await resolveCommandOnPathAsync(spec.cliName), spec.statusMessages),
    buildCommand,
    ensureTaskmasterHookConfig,
    getTaskmasterHookEventsDir: dependencies.getTaskmasterHookEventsDir,
    createHookFileReader,
    hookFiles: {
      sessionStartEnvName: TASKMASTER_SESSION_START_FILE_ENV,
      userPromptEnvName: TASKMASTER_USER_PROMPT_FILE_ENV
    }
  })

  return {
    getAgentProvider: (): AgentProvider => agentProvider,
    getAgentStatus: (
      provider: AgentProvider,
      backend?: RepositoryBackend
    ): Promise<TerminalStatus> => provider.getStatus(backend ?? createNativeBackend())
  }
}
