import type { PersistedAppState } from '../../../shared/app-types'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN
} from '../../../shared/app-types'
import {
  DEFAULT_AGENT_PROVIDER_ID,
  getAgentProviderDescriptor
} from '../../../shared/agent-providers'
import { DEFAULT_PROJECT_TASK_TAGS } from '../../../shared/task-tags'

export const DEFAULT_TERMINAL_FONT_FAMILY =
  "'CaskaydiaCove Nerd Font Mono', 'CaskaydiaMono Nerd Font', 'MesloLGM Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'SauceCodePro Nerd Font Mono', Consolas, 'Cascadia Mono', 'Cascadia Code', 'SFMono-Regular', Menlo, Monaco, 'Geist Mono Variable', monospace"
export const DEFAULT_TASK_TAGS_INPUT = DEFAULT_PROJECT_TASK_TAGS.join('\n')

export function normalizeTerminalFontFamilyInput(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export function normalizeAgentProviderId(
  value: unknown
): PersistedAppState['settings']['agentProviderId'] {
  if (typeof value !== 'string') {
    return DEFAULT_AGENT_PROVIDER_ID
  }

  return getAgentProviderDescriptor(value as PersistedAppState['settings']['agentProviderId']).id
}

export function resolveTerminalFontFamily(settings: PersistedAppState['settings']): string {
  return (
    normalizeTerminalFontFamilyInput(settings.terminalFontFamilyInput) ||
    DEFAULT_TERMINAL_FONT_FAMILY
  )
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return SIDEBAR_WIDTH_DEFAULT
  }

  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)))
}
