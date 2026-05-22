import type { AgentProviderId, RepositoryBackend, TerminalStatus } from '../../shared/app-types'
import { getAgentProviderDescriptor } from '../../shared/agent-providers'
import {
  buildNativeCommand,
  normalizeRepositoryBackend,
  spawnSyncBackendCommand
} from '../backends/repository-backend'
import { getLlmCliProviderSpec } from '../providers/cli-provider-specs'
import { createCliAgentProviders, type AgentProvider } from '../providers/cli-agent-providers'
import { createCodexSessionReader } from './codex-cli'
import {
  createHookFileReader,
  ensureTaskmasterHookConfig,
  TASKMASTER_SESSION_START_FILE_ENV,
  TASKMASTER_USER_PROMPT_FILE_ENV
} from './copilot-hooks'
import { quoteCmdArgument, resolveCommandOnPath } from './command-utils'
import type { TerminalCommand } from './types'

type TerminalAgentRuntimeDependencies = {
  getDefaultCwd: () => string
  getTaskmasterHookEventsDir: () => string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function resolveCommandOnWslPath(commandName: string, backend: RepositoryBackend): string | null {
  if (backend.kind !== 'wsl') {
    return null
  }

  const result = spawnSyncBackendCommand(
    backend,
    buildNativeCommand('/bin/bash', [
      '-c',
      `type -P -a -- ${shellQuote(commandName)} | grep -v '^/mnt/' | head -n 1`
    ])
  )
  return result.ok && result.stdout ? result.stdout.split(/\r?\n/)[0] : null
}

function resolveProviderCommand(commandName: string, backend?: RepositoryBackend): string | null {
  const normalizedBackend = normalizeRepositoryBackend(backend)
  return normalizedBackend.kind === 'wsl'
    ? resolveCommandOnWslPath(commandName, normalizedBackend)
    : resolveCommandOnPath(commandName)
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
  getAgentProvider: (providerId?: AgentProviderId) => AgentProvider
  getAgentStatus: (provider: AgentProvider, backend?: RepositoryBackend) => TerminalStatus
} {
  function createAgentStatus(
    providerId: AgentProviderId,
    commandPath: string | null,
    backend: RepositoryBackend,
    messages: {
      unavailable: string
      available: string
    }
  ): TerminalStatus {
    const descriptor = getAgentProviderDescriptor(providerId)
    const defaultCwd = dependencies.getDefaultCwd()

    if (!commandPath) {
      return {
        available: false,
        providerId,
        label: descriptor.label,
        defaultCwd,
        message:
          backend.kind === 'wsl'
            ? `${messages.unavailable} Checked inside WSL distro "${backend.distro}".`
            : messages.unavailable
      }
    }

    return {
      available: true,
      providerId,
      label: descriptor.label,
      commandPath,
      defaultCwd,
      message:
        backend.kind === 'wsl'
          ? `${messages.available} Resolved inside WSL distro "${backend.distro}".`
          : messages.available
    }
  }

  const agentProviders = createCliAgentProviders({
    createStatus: (providerId, backend, spec) =>
      createAgentStatus(
        providerId,
        resolveProviderCommand(spec.cliName, backend),
        backend,
        spec.statusMessages
      ),
    buildCommand,
    ensureTaskmasterHookConfig,
    getTaskmasterHookEventsDir: dependencies.getTaskmasterHookEventsDir,
    createHookFileReader,
    createCodexSessionReader,
    hookFiles: {
      sessionStartEnvName: TASKMASTER_SESSION_START_FILE_ENV,
      userPromptEnvName: TASKMASTER_USER_PROMPT_FILE_ENV
    }
  })

  return {
    getAgentProvider: (providerId?: AgentProviderId): AgentProvider =>
      agentProviders[getLlmCliProviderSpec(providerId).id],
    getAgentStatus: (provider: AgentProvider, backend?: RepositoryBackend): TerminalStatus =>
      provider.getStatus(backend)
  }
}
