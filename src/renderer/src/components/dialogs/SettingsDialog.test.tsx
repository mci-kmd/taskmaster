// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const settings: AppSettingsSnapshot = {
  yoloEnabled: true,
  terminalFontFamilyInput: '',
  resolvedTerminalFontFamily: 'monospace',
  taskTagsInput: 'bug',
  parsedTaskTags: ['bug']
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof SettingsDialog>> = {}
): React.ComponentProps<typeof SettingsDialog> {
  const allProps: React.ComponentProps<typeof SettingsDialog> = {
    onClose: vi.fn(),
    onSave: vi.fn(async () => ({ ok: true })),
    open: true,
    settings,
    ...props
  }
  render(<SettingsDialog {...allProps} />)
  return allProps
}

it('shows automatic approval enabled by default and saves a toggle immediately', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Copilot' }))
  const approval = screen.getByRole('checkbox', { name: 'Approve requests automatically' })
  expect(approval).toHaveProperty('checked', true)
  expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  await user.click(approval)

  expect(props.onSave).toHaveBeenCalledWith({
    yoloEnabled: false,
    terminalFontFamilyInput: '',
    taskTagsInput: 'bug',
    legacyCopilotModels: [],
    theme: 'graphite'
  })
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved')
})

it('saves text after a pause in typing', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Terminal' }))
  await user.type(screen.getByLabelText('Font family'), 'Iosevka')
  expect(props.onSave).not.toHaveBeenCalled()

  await act(() => vi.advanceTimersByTimeAsync(500))

  expect(props.onSave).toHaveBeenCalledTimes(1)
  expect(props.onSave).toHaveBeenCalledWith(
    expect.objectContaining({ terminalFontFamilyInput: 'Iosevka' })
  )
})

it('saves text when the field loses focus', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Tasks' }))
  const tags = screen.getByLabelText('Task tags')
  await user.type(tags, ', docs')
  expect(screen.getByRole('list', { name: 'Tag preview' }).textContent).toBe('bugdocs')
  await user.tab()

  expect(props.onSave).toHaveBeenCalledTimes(1)
  expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ taskTagsInput: 'bug, docs' }))
})

it('flushes a pending edit when closed with Escape', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Terminal' }))
  await user.type(screen.getByLabelText('Font family'), 'Iosevka')
  await user.keyboard('{Escape}')

  expect(props.onClose).toHaveBeenCalled()
  expect(props.onSave).toHaveBeenCalledWith(
    expect.objectContaining({ terminalFontFamilyInput: 'Iosevka' })
  )
})

it('shows a rejected value inline and keeps saving other settings from the last valid values', async () => {
  const user = userEvent.setup()
  const onSave = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: 'Font family is invalid.' })
    .mockResolvedValue({ ok: true })
  renderDialog({ onSave })

  await user.click(screen.getByRole('tab', { name: 'Terminal' }))
  const font = screen.getByLabelText('Font family')
  await user.type(font, 'Bad')
  await user.tab()

  expect(await screen.findByText('Font family is invalid.')).toBeTruthy()
  expect(font.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('status').textContent).toBe('1 change not saved')
  expect(screen.getByRole('img', { name: 'Has unsaved changes' })).toBeTruthy()

  await user.click(screen.getByRole('tab', { name: 'Copilot' }))
  await user.click(screen.getByRole('checkbox', { name: 'Approve requests automatically' }))

  expect(onSave).toHaveBeenLastCalledWith({
    yoloEnabled: false,
    terminalFontFamilyInput: '',
    taskTagsInput: 'bug',
    legacyCopilotModels: [],
    theme: 'graphite'
  })
})

it('navigates sections with the arrow keys', async () => {
  const user = userEvent.setup()
  renderDialog()

  const appearance = screen.getByRole('tab', { name: 'Appearance' })
  expect(document.activeElement).toBe(appearance)
  expect(appearance.getAttribute('aria-selected')).toBe('true')

  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Copilot' }))
  await user.keyboard('{ArrowDown}')

  const terminal = screen.getByRole('tab', { name: 'Terminal' })
  expect(document.activeElement).toBe(terminal)
  expect(screen.getByRole('tabpanel', { name: 'Terminal' })).toBeTruthy()
  expect(screen.getByLabelText('Font family')).toBeTruthy()

  await user.keyboard('{End}')
  expect(screen.getByRole('tab', { name: 'Tasks' }).getAttribute('aria-selected')).toBe('true')
})

it('marks models as legacy as soon as they are picked', async () => {
  const user = userEvent.setup()
  const props = renderDialog({ settings: { ...settings, legacyCopilotModels: ['retired-model'] } })

  await user.click(screen.getByRole('tab', { name: 'Copilot' }))
  const picker = screen.getByRole('combobox', { name: 'Legacy models' })
  await vi.waitFor(() => expect(picker.textContent).toBe('retired-model'))
  await user.click(picker)
  await user.click(screen.getByRole('option', { name: 'GPT-4.1' }))
  expect(props.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ legacyCopilotModels: ['retired-model', 'gpt-4.1'] })
  )
  await user.click(screen.getByRole('option', { name: 'retired-model' }))
  expect(props.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ legacyCopilotModels: ['gpt-4.1'] })
  )
})

it('opens on Appearance and saves a picked theme immediately', async () => {
  const user = userEvent.setup()
  const props = renderDialog({ settings: { ...settings, theme: 'slate' } })

  const picker = screen.getByRole('radiogroup', { name: 'Theme' })
  const slate = within(picker).getByRole('radio', { name: /Slate/ })
  expect(slate.getAttribute('aria-checked')).toBe('true')
  expect(within(picker).getAllByRole('radio')).toHaveLength(5)

  await user.click(within(picker).getByRole('radio', { name: /Porcelain/ }))

  expect(props.onSave).toHaveBeenCalledTimes(1)
  expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ theme: 'porcelain' }))
  expect(
    within(picker)
      .getByRole('radio', { name: /Porcelain/ })
      .getAttribute('aria-checked')
  ).toBe('true')
  expect(slate.getAttribute('aria-checked')).toBe('false')
})

it('selects themes with the arrow keys', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  const picker = screen.getByRole('radiogroup', { name: 'Theme' })
  const graphite = within(picker).getByRole('radio', { name: /Graphite/ })
  expect(graphite.getAttribute('aria-checked')).toBe('true')
  expect(graphite.tabIndex).toBe(0)

  await user.tab()
  expect(document.activeElement).toBe(graphite)
  await user.keyboard('{ArrowRight}')

  const slate = within(picker).getByRole('radio', { name: /Slate/ })
  expect(document.activeElement).toBe(slate)
  expect(slate.getAttribute('aria-checked')).toBe('true')
  expect(props.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'slate' }))

  await user.keyboard('{ArrowLeft}{ArrowLeft}')
  const porcelain = within(picker).getByRole('radio', { name: /Porcelain/ })
  expect(document.activeElement).toBe(porcelain)
  expect(props.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'porcelain' }))
})

it('keeps the dialog mounted while closing and resets drafts when it reopens', async () => {
  const user = userEvent.setup()
  const props = {
    onClose: vi.fn(),
    onSave: vi.fn(async () => ({ ok: false, error: 'Font family is invalid.' })),
    settings
  }
  const { rerender } = render(<SettingsDialog open {...props} />)

  await user.click(screen.getByRole('tab', { name: 'Terminal' }))
  await user.type(screen.getByLabelText('Font family'), 'Bad')
  await user.tab()
  expect(await screen.findByText('Font family is invalid.')).toBeTruthy()

  rerender(<SettingsDialog open={false} {...props} />)
  expect(screen.queryByRole('dialog')).toBeNull()

  rerender(<SettingsDialog open {...props} />)
  expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true')
  await user.click(screen.getByRole('tab', { name: 'Terminal' }))
  expect(screen.getByLabelText('Font family')).toHaveProperty('value', '')
  expect(screen.queryByText('Font family is invalid.')).toBeNull()
})
