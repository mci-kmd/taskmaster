// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AppSnapshot, RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import { getViewSnapshot } from '../lib/view-snapshot'
import InboxThreads from './InboxThreads'
import ProjectIcon from './ProjectIcon'
import NewThreadDialog from './dialogs/NewThreadDialog'

function thread(id: string, activity: string, settledAt?: string): ThreadSnapshot {
  return {
    id,
    repositoryId: 'Alpha',
    viewMode: 'inbox',
    latestCopilotTitle: null,
    lastUserMessage: null,
    sessionName: id,
    resumeSessionId: null,
    mode: 'active-branch',
    branchName: 'main',
    worktreePath: null,
    createdAt: activity,
    hasLaunched: false,
    executionCwd: '/repo',
    backend: { kind: 'native' },
    isRunning: false,
    isRunCommandRunning: false,
    customTitle: id,
    displayTitle: id,
    lastActivityAt: activity,
    settledAt,
    displayBranchName: 'main',
    cwd: '/repo',
    agentInterface: 'custom'
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
  onContextMenu: vi.fn()
})
afterEach(cleanup)

describe('inbox', () => {
  it('shows the same project configuration in both modes with separate session lists', () => {
    const shared = repository('Shared', [
      { ...thread('Project session', '2026-01-01'), viewMode: undefined },
      thread('Inbox session', '2026-02-01')
    ])
    const snapshot: AppSnapshot = {
      repositories: [shared],
      sidebarWidth: 268,
      selectedRepositoryId: shared.id,
      selectedThreadId: null,
      settings: {
        globalFlagsInput: '',
        terminalFontFamilyInput: '',
        taskTagsInput: '',
        parsedGlobalFlags: [],
        parsedTaskTags: [],
        resolvedTerminalFontFamily: 'monospace'
      }
    }
    const projects = getViewSnapshot(snapshot, 'projects')
    const inbox = getViewSnapshot(snapshot, 'inbox')
    expect(projects.repositories[0].threads.map((item) => item.id)).toEqual(['Project session'])
    expect(inbox.repositories[0].threads.map((item) => item.id)).toEqual(['Inbox session'])
    expect(inbox.repositories[0].id).toBe(projects.repositories[0].id)
    shared.icon = 'globe'
    expect(getViewSnapshot(snapshot, 'projects').repositories[0].icon).toBe('globe')
    expect(getViewSnapshot(snapshot, 'inbox').repositories[0].icon).toBe('globe')
    expect(shared.threads).toHaveLength(2)
  })

  it('orders threads across projects, keeps settled threads collapsed, and supports restoring them', () => {
    const handlers = callbacks()
    render(
      <InboxThreads
        repositories={repositories}
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={new Map()}
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
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
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

  it('creates inbox threads with the custom interface and retains branch/worktree controls', () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <NewThreadDialog
        viewMode="inbox"
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
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ agentInterface: 'custom', mode: 'active-branch' })
    )
  })
})
