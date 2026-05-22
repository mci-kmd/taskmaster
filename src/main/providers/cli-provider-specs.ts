import type { AgentLaunchRequest, AgentProviderId } from '../../shared/app-types'
import { DEFAULT_AGENT_PROVIDER_ID, getAgentProviderDescriptor } from '../../shared/agent-providers'
import { buildCodexArgs, buildCopilotArgs } from './agent-launch-args'

export type LlmCliProviderSpec = {
  id: AgentProviderId
  cliName: string
  displayName: string
  statusMessages: {
    unavailable: string
    available: string
  }
  buildArgs: (cwd: string, launch?: AgentLaunchRequest, rawArgs?: string[]) => string[]
}

export const LLM_CLI_PROVIDER_SPECS: Record<AgentProviderId, LlmCliProviderSpec> = {
  copilot: {
    id: 'copilot',
    cliName: 'copilot',
    displayName: 'copilot',
    statusMessages: {
      unavailable: 'Copilot CLI was not found on PATH. Install it and run `copilot login` first.',
      available:
        'Copilot CLI found. If interactive startup fails, run `copilot login` in a shell first.'
    },
    buildArgs: (_cwd, launch, rawArgs) => buildCopilotArgs(launch, rawArgs)
  },
  codex: {
    id: 'codex',
    cliName: 'codex',
    displayName: 'codex',
    statusMessages: {
      unavailable: 'Codex CLI was not found on PATH. Install it and run `codex login` first.',
      available:
        'Codex CLI found. If interactive startup fails, run `codex login` in a shell first.'
    },
    buildArgs: (cwd, launch, rawArgs) => buildCodexArgs(cwd, launch, rawArgs)
  }
}

export function getLlmCliProviderSpec(providerId?: AgentProviderId): LlmCliProviderSpec {
  return (
    LLM_CLI_PROVIDER_SPECS[providerId ?? DEFAULT_AGENT_PROVIDER_ID] ??
    LLM_CLI_PROVIDER_SPECS[DEFAULT_AGENT_PROVIDER_ID]
  )
}

export function getLlmProviderLabel(providerId: AgentProviderId): string {
  return getAgentProviderDescriptor(providerId).label
}
