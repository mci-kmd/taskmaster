// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import InboxThreads from './InboxThreads'
import ProjectIcon from './ProjectIcon'
import NewThreadDialog from './dialogs/NewThreadDialog'

function thread(id: string, activity: string, settledAt?: string): ThreadSnapshot {
  return {
    id,
    repositoryId: 'Alpha',
    latestCopilotTitle: null,
    lastUserMessage: null,
    resumeSessionId: null,
    mode: 'active-branch',
    branchName: 'main',
    worktreePath: null,
    createdAt: activity,
    executionCwd: '/repo',
    backend: { kind: 'native' },
    isRunCommandRunning: false,
    customTitle: id,
    displayTitle: id,
    lastActivityAt: activity,
    settledAt,
    displayBranchName: 'main',
    cwd: '/repo'
  }
}
function repository(id: string, threads: ThreadSnapshot[]): RepositorySnapshot {
  return {
    id,
    name: id,
    path: `/${id}`,
    threads,
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01',
    lastActivityAt: '2026-01-01',
    tasks: [],
    currentBranch: 'main',
    primaryBranch: 'main',
    branchOptions: [],
    worktreeOptions: [],
    faviconUrl: null,
    icon: 'code',
    iconColor: '#7aa2f7'
  }
}
const repositories = [
  repository('Alpha', [
    thread('Older', '2026-01-01'),
    thread('Finished', '2026-03-01', '2026-03-02')
  ]),
  repository('Beta', [thread('Newest', '2026-02-01')])
]
const callbacks = (): Record<
  | 'onSelectRepository'
  | 'onSelectThread'
  | 'onNewThread'
  | 'onEditRepository'
  | 'onOpenRepositoryTasks'
  | 'onEditThread'
  | 'onSettleThread'
  | 'onCloseThread'
  | 'onConvertThreadToWorktree'
  | 'onContextMenu',
  Mock<(...args: unknown[]) => void>
> => ({
  onSelectRepository: vi.fn(),
  onSelectThread: vi.fn(),
  onNewThread: vi.fn(),
  onEditRepository: vi.fn(),
  onOpenRepositoryTasks: vi.fn(),
  onEditThread: vi.fn(),
  onSettleThread: vi.fn(),
  onCloseThread: vi.fn(),
  onConvertThreadToWorktree: vi.fn(),
  onContextMenu: vi.fn()
})
afterEach(cleanup)

describe('inbox', () => {
  it('includes threads from every project in one activity-ordered list', () => {
    const shared = repository('Shared', [
      thread('Project session', '2026-01-01'),
      thread('Inbox session', '2026-02-01')
    ])
    const handlers = callbacks()
    render(
      <InboxThreads
        repositories={[shared]}
        selectedRepository={shared}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    expect(
      within(screen.getByRole('list', { name: 'Active threads' }))
        .getAllByRole('listitem')
        .map((row) => row.textContent)
    ).toEqual([
      expect.stringContaining('Inbox session'),
      expect.stringContaining('Project session')
    ])
  })

  it('orders threads across projects, keeps settled threads collapsed, and supports restoring them', () => {
    const handlers = callbacks()
    render(
      <InboxThreads
        repositories={repositories}
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    const rows = within(screen.getByRole('list', { name: 'Active threads' })).getAllByRole(
      'listitem'
    )
    expect(rows[0].textContent).toContain('Newest')
    expect(rows[0].textContent).toContain('Beta')
    expect(rows[1].textContent).toContain('Older')
    expect(screen.getByText('Finished').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions for Newest' }))
    expect(handlers.onEditThread).not.toHaveBeenCalled()
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Edit', 'Convert to work tree', 'Settle thread', 'Close thread'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }))
    expect(handlers.onEditThread).toHaveBeenCalledWith('Newest')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settle Newest' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Newest', true)
    fireEvent.click(screen.getByRole('button', { name: /Settled threads/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Unsettle Finished' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Finished', false)
    fireEvent.click(screen.getByText('Finished'))
    expect(handlers.onSelectThread).toHaveBeenCalledWith('Finished')
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(handlers.onNewThread).toHaveBeenCalledWith('Alpha')
    fireEvent.click(screen.getByRole('combobox'))
    const option = screen.getByRole('option', { name: 'Beta' })
    expect(within(option).getByText('/Beta')).toBeTruthy()
    expect(option.querySelector('svg')).toBeTruthy()
    fireEvent.click(option)
    expect(handlers.onSelectRepository).toHaveBeenCalledWith('Beta')
    expect(handlers.onOpenRepositoryTasks).not.toHaveBeenCalled()
    const tasksButton = screen.getByRole('button', { name: 'Project tasks' })
    expect(tasksButton.nextElementSibling).toBe(
      screen.getByRole('button', { name: 'Edit project' })
    )
    fireEvent.click(tasksButton)
    expect(handlers.onOpenRepositoryTasks).toHaveBeenCalledWith('Alpha')
  })

  it('matches inbox context actions for active, settled, worktree, and converting threads', () => {
    const handlers = callbacks()
    const { rerender } = render(
      <InboxThreads
        repositories={repositories}
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    const openMenu = (title: string): HTMLElement => {
      fireEvent.click(screen.getByRole('button', { name: `Thread actions for ${title}` }))
      return screen.getByRole('menu')
    }
    fireEvent.contextMenu(screen.getByText('Newest'), { clientX: 10, clientY: 20 })
    expect(handlers.onContextMenu).toHaveBeenCalledWith(repositories[1].threads[0], 10, 20)
    let menu = openMenu('Newest')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Convert to work tree' }))
    expect(handlers.onConvertThreadToWorktree).toHaveBeenCalledWith('Newest')
    menu = openMenu('Newest')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Settle thread' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Newest', true)
    menu = openMenu('Newest')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Close thread' }))
    expect(handlers.onCloseThread).toHaveBeenCalledWith('Newest')

    fireEvent.click(screen.getByRole('button', { name: /Settled threads/ }))
    menu = openMenu('Finished')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Edit', 'Convert to work tree', 'Unsettle thread', 'Close thread'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unsettle thread' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Finished', false)

    const worktree = { ...thread('Worktree', '2026-04-01'), mode: 'worktree' as const }
    rerender(
      <InboxThreads
        repositories={[repository('Alpha', [worktree])]}
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    menu = openMenu('Worktree')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Edit', 'Settle thread', 'Close thread'])
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions for Worktree' }))
    rerender(
      <InboxThreads
        repositories={repositories}
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread
        closingThread={false}
        {...handlers}
      />
    )
    menu = openMenu('Newest')
    const converting = within(menu).getByRole('menuitem', { name: 'Converting...' })
    expect((converting as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(converting)
    expect(handlers.onConvertThreadToWorktree).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Close thread' })
    )
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Settle thread' })
    )
  })

  it('prefers a custom favicon and falls back to the colored project icon on failure', () => {
    const { container, rerender } = render(
      <ProjectIcon repository={{ ...repositories[0], faviconUrl: 'file:///icon.png' }} />
    )
    const image = container.querySelector('img')!
    expect(container.querySelector('svg')).toBeNull()
    fireEvent.error(image)
    expect(container.querySelector('svg')?.style.color).toBe('rgb(122, 162, 247)')
    rerender(<ProjectIcon repository={{ ...repositories[0], faviconUrl: 'file:///new.png' }} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('file:///new.png')
  })

  it('creates threads without an interface switch and retains branch/worktree controls', () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <NewThreadDialog
        open
        repository={repositories[0]}
        busy={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )
    expect(screen.queryByText('CLI')).toBeNull()
    expect(screen.getByText('Worktree')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'active-branch' }))
  })
})
