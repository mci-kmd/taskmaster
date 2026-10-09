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

  it('stores the theme when given and reports only actual changes', () => {
    const settings: PersistedSettings = {
      yoloEnabled: true,
      terminalFontFamilyInput: '',
      taskTagsInput: ''
    }
    const state = { settings, ui: { selectedRepositoryId: null, selectedThreadId: null } }
    const onThemeChange = vi.fn()
    const service = createSettingsService({
      ensureState: () => state,
      saveState: vi.fn(),
      successResult: () => ({ ok: true }),
      normalizeTerminalFontFamilyInput: (value) => value,
      clampSidebarWidth: (value) => value,
      onThemeChange
    })
    const base = { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }

    service.updateSettings({ ...base, theme: 'slate' })
    expect(state.settings.theme).toBe('slate')
    expect(onThemeChange).toHaveBeenLastCalledWith('slate')

    service.updateSettings(base)
    service.updateSettings({ ...base, theme: 'slate' })
    expect(state.settings.theme).toBe('slate')
    expect(onThemeChange).toHaveBeenCalledTimes(1)

    service.updateSettings({ ...base, theme: 'graphite' })
    expect(state.settings).not.toHaveProperty('theme')
    expect(onThemeChange).toHaveBeenLastCalledWith('graphite')

    service.updateSettings({ ...base, theme: 'neon' as never })
    expect(state.settings).not.toHaveProperty('theme')
    expect(onThemeChange).toHaveBeenCalledTimes(2)
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
