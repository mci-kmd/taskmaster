import { describe, expect, it, vi } from 'vitest'
import { createSettingsService } from './settings-service'

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
