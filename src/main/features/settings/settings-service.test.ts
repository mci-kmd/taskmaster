import { describe, expect, it, vi } from 'vitest'
import { createSettingsService } from './settings-service'
import type { PersistedSettings } from '../../../shared/app-types'

describe('settings service', () => {
  it('normalizes and saves settings updates', () => {
    const saveState = vi.fn()
    const state = {
      settings: {
        yoloEnabled: true,
        terminalFontFamilyInput: '',
        taskTagsInput: ''
      },
      ui: {
        selectedRepositoryId: null,
        selectedThreadId: null
      }
    }
    const service = createSettingsService({
      ensureState: () => state,
      saveState,
      successResult: () => ({ ok: true }),
      normalizeTerminalFontFamilyInput: (value) => value.trim(),
      clampSidebarWidth: (value) => value
    })

    const result = service.updateSettings({
      yoloEnabled: false,
      terminalFontFamilyInput: '  JetBrains Mono  ',
      taskTagsInput: ' bug \n feature '
    })

    expect(result.ok).toBe(true)
    expect(state.settings).toMatchObject({
      yoloEnabled: false,
      terminalFontFamilyInput: 'JetBrains Mono',
      taskTagsInput: 'bug\nfeature'
    })
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('replaces legacy models only when given, dropping duplicates and empty lists', () => {
    const settings: PersistedSettings = {
      yoloEnabled: true,
      terminalFontFamilyInput: '',
      taskTagsInput: ''
    }
    const state = { settings, ui: { selectedRepositoryId: null, selectedThreadId: null } }
    const service = createSettingsService({
      ensureState: () => state,
      saveState: vi.fn(),
      successResult: () => ({ ok: true }),
      normalizeTerminalFontFamilyInput: (value) => value,
      clampSidebarWidth: (value) => value
    })
    const base = { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }

    service.updateSettings({ ...base, legacyCopilotModels: ['gpt-4', 'gpt-4', ''] })
    expect(state.settings.legacyCopilotModels).toEqual(['gpt-4'])
    service.updateSettings(base)
    expect(state.settings.legacyCopilotModels).toEqual(['gpt-4'])
    service.updateSettings({ ...base, legacyCopilotModels: [] })
    expect(state.settings).not.toHaveProperty('legacyCopilotModels')
  })

  it('clamps sidebar width on UI updates', () => {
    const saveState = vi.fn()
    const state = {
      settings: {
        yoloEnabled: true,
        terminalFontFamilyInput: '',
        taskTagsInput: ''
      },
      ui: {
        selectedRepositoryId: null,
        selectedThreadId: null,
        sidebarWidth: 200
      }
    }
    const service = createSettingsService({
      ensureState: () => state,
      saveState,
      successResult: () => ({ ok: true }),
      normalizeTerminalFontFamilyInput: (value) => value,
      clampSidebarWidth: () => 320
    })

    service.updateUi({ sidebarWidth: 999 })

    expect(state.ui.sidebarWidth).toBe(320)
    expect(saveState).toHaveBeenCalledTimes(1)
  })
})
