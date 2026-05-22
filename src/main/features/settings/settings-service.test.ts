import { describe, expect, it, vi } from 'vitest'
import { createSettingsService } from './settings-service'

describe('settings service', () => {
  it('normalizes and saves settings updates', () => {
    const saveState = vi.fn()
    const state = {
      settings: {
        agentProviderId: 'copilot' as const,
        globalFlagsInput: '',
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
      normalizeAgentProviderId: () => 'codex',
      normalizeTerminalFontFamilyInput: (value) => value.trim(),
      clampSidebarWidth: (value) => value
    })

    const result = service.updateSettings({
      agentProviderId: 'copilot',
      globalFlagsInput: '  --model gpt-5  ',
      terminalFontFamilyInput: '  JetBrains Mono  ',
      taskTagsInput: ' bug \n feature '
    })

    expect(result.ok).toBe(true)
    expect(state.settings).toMatchObject({
      agentProviderId: 'codex',
      globalFlagsInput: '--model gpt-5',
      terminalFontFamilyInput: 'JetBrains Mono',
      taskTagsInput: 'bug\nfeature'
    })
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('clamps sidebar width on UI updates', () => {
    const saveState = vi.fn()
    const state = {
      settings: {
        agentProviderId: 'copilot' as const,
        globalFlagsInput: '',
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
      normalizeAgentProviderId: (value) => value as 'copilot',
      normalizeTerminalFontFamilyInput: (value) => value,
      clampSidebarWidth: () => 320
    })

    service.updateUi({ sidebarWidth: 999 })

    expect(state.ui.sidebarWidth).toBe(320)
    expect(saveState).toHaveBeenCalledTimes(1)
  })
})
