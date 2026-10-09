import type {
  MutationResult,
  PersistedAppState,
  UpdateSettingsInput,
  UpdateUiInput
} from '../../../shared/app-types'
import { normalizeTaskTagsInput } from '../../../shared/task-tags'
import { DEFAULT_THEME, isThemeId, type ThemeId } from '../../../shared/themes'
import { normalizeModelIds } from '../state-store/app-state-values'

type SettingsServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'settings' | 'ui'>
  saveState: () => void
  successResult: () => MutationResult
  normalizeTerminalFontFamilyInput: (input: string) => string
  clampSidebarWidth: (value: number) => number
  /** Applies a changed theme to the native window chrome. */
  onThemeChange?: (theme: ThemeId) => void
}

export function createSettingsService(dependencies: SettingsServiceDependencies): {
  updateSettings: (input: UpdateSettingsInput) => MutationResult
  updateUi: (input: UpdateUiInput) => MutationResult
} {
  return {
    updateSettings: (input: UpdateSettingsInput): MutationResult => {
      const state = dependencies.ensureState()
      state.settings.yoloEnabled = input.yoloEnabled
      state.settings.terminalFontFamilyInput = dependencies.normalizeTerminalFontFamilyInput(
        input.terminalFontFamilyInput
      )
      state.settings.taskTagsInput = normalizeTaskTagsInput(input.taskTagsInput)
      if (input.legacyCopilotModels !== undefined) {
        const legacy = normalizeModelIds(input.legacyCopilotModels) ?? []
        if (legacy.length) state.settings.legacyCopilotModels = legacy
        else delete state.settings.legacyCopilotModels
      }
      const themeChanged =
        input.theme !== undefined &&
        isThemeId(input.theme) &&
        input.theme !== (state.settings.theme ?? DEFAULT_THEME)
      if (input.theme !== undefined && isThemeId(input.theme)) {
        if (input.theme === DEFAULT_THEME) delete state.settings.theme
        else state.settings.theme = input.theme
      }
      dependencies.saveState()
      if (themeChanged && input.theme) dependencies.onThemeChange?.(input.theme)
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
