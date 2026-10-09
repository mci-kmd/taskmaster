// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppSettingsSnapshot } from '../../../../shared/app-types'
import SettingsDialog from './SettingsDialog'

const copilot = vi.hoisted(() => ({
  listModels: vi.fn(async () => ({
    models: [
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        supportsVision: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null
      },
      {
        id: 'gpt-6-luna',
        name: 'Luna 6',
        supportsVision: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null
      }
    ]
  }))
}))
vi.mock('../../shared/api/client', () => ({ getRendererApi: () => ({ copilot }) }))

afterEach(cleanup)

const settings: AppSettingsSnapshot = {
  yoloEnabled: true,
  terminalFontFamilyInput: '',
  resolvedTerminalFontFamily: 'monospace',
  taskTagsInput: 'bug',
  parsedTaskTags: ['bug']
}

it('shows automatic approval enabled by default and saves a changed toggle', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn(async () => true)
  render(
    <SettingsDialog busy={false} onClose={vi.fn()} onSubmit={onSubmit} open settings={settings} />
  )

  const approval = screen.getByRole('checkbox', { name: 'Approve requests automatically' })
  expect(approval).toHaveProperty('checked', true)
  expect(screen.queryByText('Global Copilot flags')).toBeNull()
  await user.click(approval)
  await user.click(screen.getByRole('button', { name: 'Save settings' }))

  expect(onSubmit).toHaveBeenCalledWith({
    yoloEnabled: false,
    terminalFontFamilyInput: '',
    taskTagsInput: 'bug',
    legacyCopilotModels: []
  })
})

it('marks models as legacy', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn(async () => true)
  render(
    <SettingsDialog
      busy={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      open
      settings={{ ...settings, legacyCopilotModels: ['retired-model'] }}
    />
  )

  const picker = screen.getByRole('combobox', { name: 'Legacy models' })
  await vi.waitFor(() => expect(picker.textContent).toBe('retired-model'))
  await user.click(picker)
  await user.click(screen.getByRole('option', { name: 'GPT-4.1' }))
  await user.click(screen.getByRole('option', { name: 'retired-model' }))
  await user.click(screen.getByRole('button', { name: 'Save settings' }))

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ legacyCopilotModels: ['gpt-4.1'] })
  )
})
