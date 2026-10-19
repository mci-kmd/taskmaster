// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { RepositoryWorktreeStatus } from '../../../../shared/app-types'
import WorktreeOverview from './WorktreeOverview'

afterEach(cleanup)

function worktree(extra: Partial<RepositoryWorktreeStatus>): RepositoryWorktreeStatus {
  return {
    path: '/repo',
    branchName: 'main',
    isMain: false,
    hasLocalBranch: true,
    hasRemoteBranch: false,
    hasLocalChanges: false,
    locked: false,
    missing: false,
    threadTitles: [],
    ...extra
  }
}

const main = worktree({ isMain: true, hasRemoteBranch: true })
const pushed = worktree({ path: '/wt/pushed', branchName: 'pushed', hasRemoteBranch: true })
const dirty = worktree({ path: '/wt/dirty', branchName: 'dirty', hasLocalChanges: true })
const stale = worktree({ path: '/wt/stale', branchName: 'stale' })

it('lists worktrees and only enables clean up for local, clean ones', async () => {
  const onListWorktrees = vi.fn(async () => ({
    ok: true as const,
    worktrees: [main, pushed, dirty, stale]
  }))
  render(
    <WorktreeOverview
      onCleanupWorktree={vi.fn()}
      onListWorktrees={onListWorktrees}
      repositoryId="repo-1"
    />
  )

  const list = await screen.findByRole('list', { name: 'Worktrees' })
  expect(onListWorktrees).toHaveBeenCalledWith('repo-1')
  const pushedRow = within(list).getByRole('listitem', { name: 'pushed' })
  expect(within(pushedRow).getByText('Remote branch')).toBeTruthy()
  const dirtyRow = within(list).getByRole('listitem', { name: 'dirty' })
  expect(within(dirtyRow).getByText('Uncommitted changes')).toBeTruthy()

  const button = (name: string): HTMLButtonElement =>
    screen.getByRole('button', { name: `Clean up ${name}` })
  expect(button('main').disabled).toBe(true)
  expect(button('pushed').disabled).toBe(true)
  expect(button('pushed').title).toBe('The branch exists on the remote.')
  expect(button('dirty').disabled).toBe(true)
  expect(button('stale').disabled).toBe(false)
})

it('cleans up a worktree after confirming and reloads the list', async () => {
  const user = userEvent.setup()
  const onListWorktrees = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, worktrees: [main, stale] })
    .mockResolvedValueOnce({ ok: true, worktrees: [main] })
  const onCleanupWorktree = vi.fn(async () => ({ ok: true }))
  render(
    <WorktreeOverview
      onCleanupWorktree={onCleanupWorktree}
      onListWorktrees={onListWorktrees}
      repositoryId="repo-1"
    />
  )

  await user.click(await screen.findByRole('button', { name: 'Clean up stale' }))
  expect(onCleanupWorktree).not.toHaveBeenCalled()
  const confirm = screen.getByRole('group', { name: 'Confirm clean up' })
  expect(within(confirm).getByText(/deletes the local branch stale/u)).toBeTruthy()
  await user.click(within(confirm).getByRole('button', { name: 'Clean up' }))

  expect(onCleanupWorktree).toHaveBeenCalledWith({ repositoryId: 'repo-1', path: '/wt/stale' })
  expect(onListWorktrees).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('listitem', { name: 'stale' })).toBeNull()
})

it('shows a failed clean up and refreshes on demand', async () => {
  const user = userEvent.setup()
  const onListWorktrees = vi.fn(async () => ({ ok: true as const, worktrees: [stale] }))
  render(
    <WorktreeOverview
      onCleanupWorktree={vi.fn(async () => ({ ok: false, error: 'git said no' }))}
      onListWorktrees={onListWorktrees}
      repositoryId="repo-1"
    />
  )

  await user.click(await screen.findByRole('button', { name: 'Clean up stale' }))
  await user.click(screen.getByRole('button', { name: 'Clean up' }))
  expect((await screen.findByRole('alert')).textContent).toBe('git said no')

  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(onListWorktrees).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('alert')).toBeNull()
})
