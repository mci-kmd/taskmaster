import type { AgentLaunchRequest } from '../../shared/app-types'
import { COPILOT_CLI_NAME } from '../../shared/copilot'
import { buildCopilotArgs } from './agent-launch-args'

export type LlmCliProviderSpec = {
  cliName: string
  displayName: string
  statusMessages: {
    unavailable: string
    available: string
  }
  buildArgs: (cwd: string, launch?: AgentLaunchRequest, rawArgs?: string[]) => string[]
}

export const COPILOT_CLI_PROVIDER_SPEC: LlmCliProviderSpec = {
  cliName: COPILOT_CLI_NAME,
  displayName: 'copilot',
  statusMessages: {
    unavailable: 'Copilot CLI was not found on PATH. Install it and run `copilot login` first.',
    available:
      'Copilot CLI found. If interactive startup fails, run `copilot login` in a shell first.'
  },
  buildArgs: (_cwd, launch, rawArgs) => buildCopilotArgs(launch, rawArgs)
}
