// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RepositorySnapshot } from '../../../../shared/app-types'
import ThreadSetupPanel from './ThreadSetupPanel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const repository = {
  id: 'repo',
  name: 'Repo',
  currentBranch: 'feature/old',
  primaryBranch: 'main',
  branchOptions: [{ value: 'feature/old', kind: 'local', label: 'local' }],
  worktreeOptions: [{ branchName: 'feature/tree', path: '/repo/.worktrees/tree' }]
} as RepositorySnapshot

it('shows the trunk branch and switches the checkout mode right away', () => {
  const onChange = vi.fn()
  render(
    <ThreadSetupPanel
      setup={{ mode: 'trunk', branchName: null }}
      repository={repository}
      settingUp={false}
      onChange={onChange}
    />
  )
  expect(screen.getByText('main')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()

  fireEvent.click(screen.getByRole('radio', { name: 'Worktree' }))

  expect(onChange).toHaveBeenCalledWith({ mode: 'worktree', branchName: null })
  expect(screen.getByRole('combobox', { name: 'Worktree branch' })).toBeTruthy()
})

it('saves a typed branch name after a pause, or at once when focus leaves', () => {
  vi.useFakeTimers()
  const onChange = vi.fn()
  render(
    <ThreadSetupPanel
      setup={{ mode: 'branch', branchName: null }}
      repository={repository}
      settingUp={false}
      onChange={onChange}
    />
  )
  const input = screen.getByRole('combobox', { name: 'Branch' })

  fireEvent.change(input, { target: { value: 'feature/new' } })
  expect(onChange).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(500))
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'branch', branchName: 'feature/new' })

  fireEvent.change(input, { target: { value: 'feature/newer ' } })
  fireEvent.blur(input)
  expect(onChange).toHaveBeenLastCalledWith({ mode: 'branch', branchName: 'feature/newer' })
  expect(onChange).toHaveBeenCalledTimes(2)
})

it('locks the choice while the checkout is made', () => {
  render(
    <ThreadSetupPanel
      setup={{ mode: 'branch', branchName: 'fix' }}
      repository={repository}
      settingUp
      onChange={vi.fn()}
    />
  )
  expect(screen.getByRole('status').textContent).toBe('Setting up the checkout…')
  expect((screen.getByRole('combobox', { name: 'Branch' }) as HTMLInputElement).disabled).toBe(true)
  expect(
    (screen.getByRole('radio', { name: 'Trunk' }) as HTMLButtonElement).matches(':disabled')
  ).toBe(true)
})
