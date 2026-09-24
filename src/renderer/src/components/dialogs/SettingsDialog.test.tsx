// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog'

afterEach(cleanup)

it('shows automatic approval enabled by default and saves a changed toggle', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn(async () => true)
  render(
    <SettingsDialog
      busy={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      open
      settings={{
        yoloEnabled: true,
        terminalFontFamilyInput: '',
        resolvedTerminalFontFamily: 'monospace',
        taskTagsInput: 'bug',
        parsedTaskTags: ['bug']
      }}
    />
  )

  const approval = screen.getByRole('checkbox', { name: 'Approve requests automatically' })
  expect(approval).toHaveProperty('checked', true)
  expect(screen.queryByText('Global Copilot flags')).toBeNull()
  await user.click(approval)
  await user.click(screen.getByRole('button', { name: 'Save settings' }))

  expect(onSubmit).toHaveBeenCalledWith({
    yoloEnabled: false,
    terminalFontFamilyInput: '',
    taskTagsInput: 'bug'
  })
})
