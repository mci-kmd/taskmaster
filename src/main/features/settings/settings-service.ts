import type {
  MutationResult,
  PersistedAppState,
  UpdateSettingsInput,
  UpdateUiInput
} from '../../../shared/app-types'
import { normalizeTaskTagsInput } from '../../../shared/task-tags'

type SettingsServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'settings' | 'ui'>
  saveState: () => void
  successResult: () => MutationResult
  normalizeAgentProviderId: (value: string) => UpdateSettingsInput['agentProviderId']
  normalizeTerminalFontFamilyInput: (input: string) => string
  clampSidebarWidth: (value: number) => number
}

export function createSettingsService(dependencies: SettingsServiceDependencies): {
  updateSettings: (input: UpdateSettingsInput) => MutationResult
  updateUi: (input: UpdateUiInput) => MutationResult
} {
  return {
    updateSettings: (input: UpdateSettingsInput): MutationResult => {
      const state = dependencies.ensureState()
      state.settings.agentProviderId = dependencies.normalizeAgentProviderId(input.agentProviderId)
      state.settings.globalFlagsInput = input.globalFlagsInput.trim()
      state.settings.terminalFontFamilyInput = dependencies.normalizeTerminalFontFamilyInput(
        input.terminalFontFamilyInput
      )
      state.settings.taskTagsInput = normalizeTaskTagsInput(input.taskTagsInput)
      dependencies.saveState()
      return dependencies.successResult()
    },

    updateUi: (input: UpdateUiInput): MutationResult => {
      const state = dependencies.ensureState()
      if (typeof input.sidebarWidth === 'number') {
        state.ui.sidebarWidth = dependencies.clampSidebarWidth(input.sidebarWidth)
      }
      dependencies.saveState()
      return dependencies.successResult()
    }
  }
}
