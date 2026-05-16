import type { AgentProviderId } from './app-types'

export interface AgentProviderCapabilities {
  tracksSessionStart: boolean
  tracksUserPrompt: boolean
  canRetryMissingResumeSession: boolean
  usesCopilotTerminalStyling: boolean
  supportsClipboardImagePasteShortcut: boolean
  usesBackslashEnterForMultiline: boolean
}

export interface AgentProviderDescriptor {
  id: AgentProviderId
  label: string
  cliName: string
  capabilities: AgentProviderCapabilities
}

export const DEFAULT_AGENT_PROVIDER_ID: AgentProviderId = 'copilot'

export const AGENT_PROVIDERS: readonly AgentProviderDescriptor[] = [
  {
    id: 'copilot',
    label: 'Copilot',
    cliName: 'copilot',
    capabilities: {
      tracksSessionStart: true,
      tracksUserPrompt: true,
      canRetryMissingResumeSession: true,
      usesCopilotTerminalStyling: true,
      supportsClipboardImagePasteShortcut: true,
      usesBackslashEnterForMultiline: true
    }
  }
]

export function getAgentProviderDescriptor(
  providerId: AgentProviderId = DEFAULT_AGENT_PROVIDER_ID
): AgentProviderDescriptor {
  return (
    AGENT_PROVIDERS.find((provider) => provider.id === providerId) ??
    AGENT_PROVIDERS.find((provider) => provider.id === DEFAULT_AGENT_PROVIDER_ID)!
  )
}
