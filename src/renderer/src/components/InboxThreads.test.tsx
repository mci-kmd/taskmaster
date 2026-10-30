// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import InboxThreads from './InboxThreads'
import ProjectIcon from './ProjectIcon'

function thread(id: string, activity: string, settledAt?: string): ThreadSnapshot {
  return {
    id,
    repositoryId: 'Alpha',
    latestCopilotTitle: null,
    lastUserMessage: null,
    resumeSessionId: null,
    mode: 'active-branch',
    projectKind: 'repository',
    branchName: 'main',
    worktreePath: null,
    createdAt: activity,
    executionCwd: '/repo',
    backend: { kind: 'native' },
    isRunCommandRunning: false,
    commitPhase: null,
    previewUrl: null,
    commitAutoPush: false,
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
  | 'onConvertThreadToWorktree',
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
  onConvertThreadToWorktree: vi.fn()
})
afterEach(cleanup)

describe('inbox', () => {
  it('links the work items a thread is linked to from its card', () => {
    const linked = {
      ...thread('Linked', '2026-04-01'),
      workItems: [
        {
          provider: 'github' as const,
          url: 'https://github.com/octo/app/issues/12',
          container: 'octo/app',
          number: 12,
          title: 'Crash on start'
        },
        {
          provider: 'azure-devops' as const,
          url: 'https://dev.azure.com/contoso/Web/_workitems/edit/345',
          container: 'contoso/Web',
          number: 345
        }
      ]
    }
    const projects = [repository('Alpha', [linked, thread('Plain', '2026-01-01')])]
    const handlers = callbacks()
    render(
      <InboxThreads
        repositories={projects}
        selectedRepository={projects[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    const links = within(screen.getByRole('list', { name: 'Linked work items' })).getAllByRole(
      'link'
    )
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['#12', 'https://github.com/octo/app/issues/12'],
      ['#345', 'https://dev.azure.com/contoso/Web/_workitems/edit/345']
    ])
    expect(links[0].getAttribute('aria-label')).toBe('Open issue octo/app#12 · Crash on start')
    expect(links[1].getAttribute('target')).toBe('_blank')
    expect(screen.getAllByRole('list', { name: 'Linked work items' })).toHaveLength(1)
    fireEvent.click(links[0])
    expect(handlers.onSelectThread).not.toHaveBeenCalled()
  })

  it('shows linked tasks of the project and opens them in the task list', () => {
    const linked = { ...thread('Linked', '2026-04-01'), taskNumbers: [7, 99, 3] }
    const project = {
      ...repository('Alpha', [linked]),
      tasks: [
        {
          id: 't7',
          number: 7,
          title: 'Fix login',
          description: '',
          tags: [],
          createdAt: '2026-01-01'
        }
      ],
      completedTasks: [
        {
          id: 't3',
          number: 3,
          title: 'Old work',
          description: '',
          tags: [],
          createdAt: '2026-01-01',
          completedAt: '2026-02-01'
        }
      ]
    }
    const handlers = callbacks()
    render(
      <InboxThreads
        repositories={[project]}
        selectedRepository={project}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    const chips = within(screen.getByRole('list', { name: 'Linked work items' })).getAllByRole(
      'button'
    )
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Open Task #7 · Fix login',
      'Open Task #3 · Old work (completed)'
    ])
    expect(chips[1].hasAttribute('data-completed')).toBe(true)
    fireEvent.click(chips[0])
    expect(handlers.onOpenRepositoryTasks).toHaveBeenCalledWith('Alpha', 7)
    expect(handlers.onSelectThread).not.toHaveBeenCalled()
  })

  it('lists favorite projects first and toggles favorites from the project picker', () => {
    const onToggleRepositoryFavorite = vi.fn()
    const projects = [
      repository('Alpha', []),
      { ...repository('Beta', []), favorite: true },
      repository('Gamma', [])
    ]
    render(
      <InboxThreads
        repositories={projects}
        selectedRepository={projects[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
        onToggleRepositoryFavorite={onToggleRepositoryFavorite}
      />
    )
    const picker = screen.getByRole('combobox', { name: 'Project for new thread' })
    fireEvent.click(picker)
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))
    ).toEqual(['Beta', 'Alpha', 'Gamma'])
    expect(screen.getByRole('group', { name: 'Favorites' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add Gamma to favorites' }))
    expect(onToggleRepositoryFavorite).toHaveBeenLastCalledWith('Gamma', true)
    // Alpha is selected, so the highlight starts there.
    fireEvent.keyDown(picker, { key: 'ArrowUp' })
    fireEvent.keyDown(picker, { key: '*' })
    expect(onToggleRepositoryFavorite).toHaveBeenLastCalledWith('Beta', false)
  })

  it('shows generated titles and regenerates them from the thread menu', () => {
    const onRegenerateTitle = vi.fn()
    const titled = repository('Titled', [
      { ...thread('Generated', '2026-02-01'), customTitle: null, generatedTitle: 'Fix login' }
    ])
    const { rerender } = render(
      <InboxThreads
        repositories={[titled]}
        selectedRepository={titled}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
        onRegenerateTitle={onRegenerateTitle}
      />
    )
    fireEvent.contextMenu(screen.getByText('Fix login'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate title' }))
    expect(onRegenerateTitle).toHaveBeenCalledWith('Generated')
    rerender(
      <InboxThreads
        repositories={[titled]}
        selectedRepository={titled}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
        regeneratingTitleIds={new Set(['Generated'])}
      />
    )
    fireEvent.contextMenu(screen.getByText('Fix login'))
    expect(
      screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Writing title...' }).disabled
    ).toBe(true)
  })

  it('shows when a thread is committing or running its app', () => {
    const busy = repository('Busy', [
      { ...thread('Committing', '2026-02-01'), commitPhase: 'hook' },
      { ...thread('Serving', '2026-01-01'), isRunCommandRunning: true }
    ])
    render(
      <InboxThreads
        repositories={[busy]}
        selectedRepository={busy}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
      />
    )
    const [committing, serving] = within(
      screen.getByRole('list', { name: 'Active threads' })
    ).getAllByRole('listitem')
    expect(within(committing).getByTitle('Running pre-commit hook…').textContent).toBe('Committing')
    expect(within(committing).queryByRole('img', { name: 'App running' })).toBeNull()
    expect(within(serving).getByRole('img', { name: 'App running' })).toBeTruthy()
    expect(within(serving).queryByText('Committing')).toBeNull()
  })

  it('shows the last model family and checkout mode where the hover actions appear', () => {
    const mixed = repository('Mixed', [
      {
        ...thread('Worktree', '2026-03-01'),
        mode: 'worktree' as const,
        lastModel: { id: 'claude-opus-5.5', name: 'Claude Opus 5.5' }
      },
      thread('Local', '2026-02-01'),
      {
        ...thread('General', '2026-01-01'),
        projectKind: 'general' as const,
        lastModel: { id: 'gpt-5.5', name: 'GPT-5.5' }
      }
    ])
    render(
      <InboxThreads
        repositories={[mixed]}
        selectedRepository={mixed}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
      />
    )
    const [worktree, local, general] = within(
      screen.getByRole('list', { name: 'Active threads' })
    ).getAllByRole('listitem')
    const indicators = (row: HTMLElement): string[] =>
      [...row.querySelectorAll('.tm-inbox-indicators [role="img"]')].map(
        (element) => element.getAttribute('aria-label') ?? ''
      )
    expect(indicators(worktree)).toEqual(['Last model: Claude Opus 5.5', 'Worktree checkout'])
    expect(
      worktree.querySelector('.tm-inbox-side .tm-inbox-actions [aria-label="Settle Worktree"]')
    ).toBeTruthy()
    expect(worktree.querySelector('[data-indicator="model"]')?.getAttribute('data-family')).toBe(
      'Claude'
    )
    expect(indicators(local)).toEqual(['Local branch checkout'])
    expect(indicators(general)).toEqual(['Last model: GPT-5.5'])
  })

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

  it('sinks suspended threads to one line and suspends or unsuspends from the row', () => {
    const onSuspendThread = vi.fn()
    const handlers = callbacks()
    const projects = [
      repository('Alpha', [
        { ...thread('Parked', '2026-03-01'), suspendedAt: '2026-03-02' },
        thread('Busy', '2026-02-01'),
        thread('Quiet', '2026-01-01'),
        { ...thread('Parked older', '2026-01-15'), suspendedAt: '2026-03-03' }
      ])
    ]
    render(
      <InboxThreads
        repositories={projects}
        selectedRepository={projects[0]}
        selectedThread={null}
        sessions={new Map([['Busy', { copilotStatus: 'working' } as never]])}
        convertingThread={false}
        closingThread={false}
        {...handlers}
        onSuspendThread={onSuspendThread}
      />
    )
    const rows = within(screen.getByRole('list', { name: 'Active threads' })).getAllByRole(
      'listitem'
    )
    expect(rows.map((row) => row.getAttribute('data-thread-id'))).toEqual([
      'Busy',
      'Quiet',
      'Parked',
      'Parked older'
    ])
    expect(rows.map((row) => row.hasAttribute('data-suspended'))).toEqual([
      false,
      false,
      true,
      true
    ])
    const parked = rows[2]
    expect(
      within(parked)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([null, 'Settle Parked', 'Unsuspend Parked'])
    expect(parked.querySelector('.tm-inbox-row-subtitle')).toBeNull()
    fireEvent.click(within(parked).getByText('Parked'))
    expect(handlers.onSelectThread).toHaveBeenCalledWith('Parked')
    fireEvent.click(within(parked).getByRole('button', { name: 'Unsuspend Parked' }))
    expect(onSuspendThread).toHaveBeenCalledWith('Parked', false)
    fireEvent.click(within(parked).getByRole('button', { name: 'Settle Parked' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Parked', true)

    const busySuspend = screen.getByRole<HTMLButtonElement>('button', { name: 'Suspend Busy' })
    expect(busySuspend.disabled).toBe(true)
    expect(busySuspend.title).toBe('Wait for Copilot to finish before suspending')
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Quiet' }))
    expect(onSuspendThread).toHaveBeenCalledWith('Quiet', true)
    expect(screen.queryByRole('button', { name: /Thread actions for/ })).toBeNull()
  })

  it('snoozes from a submenu, stacks snoozed threads above settled ones, and marks awakened threads', () => {
    const handlers = callbacks()
    const onSnoozeThread = vi.fn()
    const onCustomSnoozeThread = vi.fn()
    const projects = [
      repository('Alpha', [
        thread('Quiet', '2026-01-01'),
        { ...thread('Woken', '2025-12-01'), awakenedAt: '2026-02-01T00:00:00.000Z' },
        { ...thread('Later', '2026-03-01'), snoozedUntil: '2099-01-02T08:00:00.000Z' },
        { ...thread('Sooner', '2026-03-02'), snoozedUntil: '2099-01-01T08:00:00.000Z' },
        thread('Finished', '2026-03-01', '2026-03-02')
      ])
    ]
    render(
      <InboxThreads
        repositories={projects}
        selectedRepository={projects[0]}
        selectedThread={null}
        sessions={new Map()}
        convertingThread={false}
        closingThread={false}
        {...handlers}
        onSnoozeThread={onSnoozeThread}
        onCustomSnoozeThread={onCustomSnoozeThread}
      />
    )
    // Waking from a snooze counts as activity, so the awakened thread comes first.
    const active = within(screen.getByRole('list', { name: 'Active threads' })).getAllByRole(
      'listitem'
    )
    expect(active.map((row) => row.getAttribute('data-thread-id'))).toEqual(['Woken', 'Quiet'])
    const badge = active[0].querySelector('[data-status="awakened"]')
    expect(badge?.textContent).toBe('Awakened')

    const toggles = screen
      .getAllByRole('button', { expanded: false })
      .filter((button) => button.className.includes('tm-inbox-shelf-toggle'))
    expect(toggles.map((button) => button.textContent)).toEqual([
      'Snoozed threads 2',
      'Settled threads 1'
    ])
    const snoozed = screen.getByRole('list', { name: 'Snoozed threads', hidden: true })
    expect(
      within(snoozed)
        .getAllByRole('listitem', { hidden: true })
        .map((row) => row.getAttribute('data-thread-id'))
    ).toEqual(['Sooner', 'Later'])
    fireEvent.click(toggles[0])
    fireEvent.click(within(snoozed).getByRole('button', { name: 'Unsnooze Later' }))
    expect(onSnoozeThread).toHaveBeenCalledWith('Later', null)

    fireEvent.contextMenu(screen.getByText('Quiet'))
    const menu = screen.getByRole('menu', { name: 'Thread actions for Quiet' })
    const snooze = within(menu).getByRole('menuitem', { name: 'Snooze' })
    expect(snooze.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.keyDown(snooze, { key: 'ArrowRight' })
    const submenu = screen.getByRole('menu', { name: 'Snooze' })
    expect(
      within(submenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['1 hour', 'Tomorrow', 'Next week', 'Custom...'])
    expect(document.activeElement).toBe(within(submenu).getByRole('menuitem', { name: '1 hour' }))
    fireEvent.keyDown(submenu, { key: 'ArrowLeft' })
    expect(screen.queryByRole('menu', { name: 'Snooze' })).toBeNull()
    expect(document.activeElement).toBe(snooze)

    fireEvent.click(snooze)
    const before = Date.now()
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Snooze' })).getByRole('menuitem', {
        name: '1 hour'
      })
    )
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSnoozeThread).toHaveBeenCalledWith('Quiet', expect.any(String))
    const until = Date.parse(onSnoozeThread.mock.calls.at(-1)?.[1] as string)
    expect(until - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000)
    expect(until - before).toBeLessThanOrEqual(60 * 60 * 1000 + 1000)

    fireEvent.contextMenu(screen.getByText('Quiet'))
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Snooze' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom...' }))
    expect(onCustomSnoozeThread).toHaveBeenCalledWith('Quiet')

    fireEvent.contextMenu(screen.getByText('Later'))
    const snoozedMenu = screen.getByRole('menu', { name: 'Thread actions for Later' })
    expect(within(snoozedMenu).getByRole('menuitem', { name: 'Snooze again' })).toBeTruthy()
    fireEvent.click(within(snoozedMenu).getByRole('menuitem', { name: 'Unsnooze' }))
    expect(onSnoozeThread).toHaveBeenLastCalledWith('Later', null)
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
    fireEvent.contextMenu(screen.getByText('Newest'))
    expect(handlers.onEditThread).not.toHaveBeenCalled()
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual([
      'Edit',
      'Regenerate title',
      'Fork thread',
      'Convert to work tree',
      'Snooze',
      'Settle thread',
      'Close thread'
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }))
    expect(handlers.onEditThread).toHaveBeenCalledWith('Newest')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settle Newest' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Newest', true)
    fireEvent.click(screen.getByRole('button', { name: /Settled threads/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Unsettle Finished' }))
    expect(handlers.onSettleThread).toHaveBeenCalledWith('Finished', false)
    expect(screen.queryByRole('button', { name: 'Suspend Finished' })).toBeNull()
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
      fireEvent.contextMenu(screen.getByText(title))
      return screen.getByRole('menu')
    }
    // Right-clicking a thread opens the same menu where the pointer is.
    fireEvent.contextMenu(screen.getByText('Newest'), { clientX: 10, clientY: 20 })
    let menu = screen.getByRole('menu', { name: 'Thread actions for Newest' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }))
    expect(handlers.onEditThread).toHaveBeenCalledWith('Newest')
    expect(screen.queryByRole('menu')).toBeNull()
    menu = openMenu('Newest')
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
    ).toEqual([
      'Edit',
      'Regenerate title',
      'Fork thread',
      'Convert to work tree',
      'Unsettle thread',
      'Close thread'
    ])
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
    ).toEqual([
      'Edit',
      'Regenerate title',
      'Fork thread',
      'Snooze',
      'Settle thread',
      'Close thread'
    ])
    fireEvent.keyDown(menu, { key: 'Escape' })
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

  it('keeps a right-click menu in step with its thread and closes it when the thread goes', () => {
    const handlers = callbacks()
    const view = (props: {
      repositories: typeof repositories
      convertingThread: boolean
    }): React.JSX.Element => (
      <InboxThreads
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={new Map()}
        closingThread={false}
        {...handlers}
        {...props}
      />
    )
    const { rerender } = render(view({ repositories, convertingThread: false }))
    fireEvent.contextMenu(screen.getByText('Newest'))
    const menu = screen.getByRole('menu', { name: 'Thread actions for Newest' })
    expect(within(menu).getByRole('menuitem', { name: 'Convert to work tree' })).toBeTruthy()

    const close = within(menu).getByRole('menuitem', { name: 'Close thread' })
    close.focus()
    // A refreshed snapshot brings new thread objects.
    rerender(view({ repositories: structuredClone(repositories), convertingThread: true }))
    expect(within(menu).getByRole('menuitem', { name: 'Converting...' })).toBeTruthy()
    // An update keeps keyboard focus where it was.
    expect(document.activeElement).toBe(close)

    const withoutNewest = repositories.map((repository) => ({
      ...repository,
      threads: repository.threads.filter((thread) => thread.id !== 'Newest')
    }))
    rerender(view({ repositories: withoutNewest, convertingThread: false }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows done and input states as status pills', () => {
    const handlers = callbacks()
    const session = (copilotStatus: 'done' | 'input') =>
      ({
        phase: 'running',
        exitCode: null,
        errorMessage: null,
        runtimeTitle: null,
        lastUserMessage: null,
        copilotStatus,
        copilotPhase: copilotStatus === 'done' ? 'idle' : 'running'
      }) as const
    render(
      <InboxThreads
        repositories={repositories}
        selectedRepository={repositories[0]}
        selectedThread={null}
        sessions={
          new Map([
            ['Newest', session('done')],
            ['Older', session('input')]
          ])
        }
        convertingThread={false}
        closingThread={false}
        {...handlers}
      />
    )
    const rows = within(screen.getByRole('list', { name: 'Active threads' })).getAllByRole(
      'listitem'
    )
    const done = within(rows[0]).getByText('Done')
    expect(done.getAttribute('data-status')).toBe('done')
    expect(done.className).toContain('tm-status-badge')
    const input = within(rows[1]).getByText('Needs input')
    expect(input.getAttribute('data-status')).toBe('input')
    expect(input.className).toContain('tm-status-badge')
  })

  it('prefers a custom favicon and falls back to the colored project icon on failure', () => {
    const { container, rerender } = render(
      <ProjectIcon repository={{ ...repositories[0], faviconUrl: 'file:///icon.png' }} />
    )
    const image = container.querySelector('img')!
    expect(container.querySelector('svg')).toBeNull()
    fireEvent.error(image)
    // Stored colors render through theme tokens so they suit every theme.
    expect(container.querySelector('svg')?.style.color).toBe('var(--color-accent)')
    rerender(<ProjectIcon repository={{ ...repositories[0], faviconUrl: 'file:///new.png' }} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('file:///new.png')
  })

  it('labels live, error and idle statuses', () => {
    const live = repository('Live', [
      thread('Running', '2026-03-01'),
      thread('Broken', '2026-02-01'),
      thread('Quiet', '2026-01-01')
    ])
    const status = (copilotStatus: 'working' | 'error') =>
      ({
        phase: 'running',
        exitCode: null,
        errorMessage: null,
        runtimeTitle: null,
        lastUserMessage: null,
        copilotStatus
      }) as const
    render(
      <InboxThreads
        repositories={[live]}
        selectedRepository={live}
        selectedThread={live.threads[0]}
        sessions={
          new Map([
            ['Running', status('working')],
            ['Broken', status('error')]
          ])
        }
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
      />
    )
    const [running, broken, quiet] = within(
      screen.getByRole('list', { name: 'Active threads' })
    ).getAllByRole('listitem')
    expect(within(running).getByText('Working').getAttribute('data-status')).toBe('working')
    expect(within(broken).getByText('Error').getAttribute('data-status')).toBe('error')
    expect(within(quiet).getByText('Idle').getAttribute('data-status')).toBe('idle')
    expect(running.querySelector('[data-selected]')).toBeTruthy()
    expect(broken.querySelector('[data-selected]')).toBeNull()
  })

  it('marks only working threads for de-emphasis', () => {
    const live = repository('Live', [
      thread('Busy', '2026-03-01'),
      thread('Asking', '2026-02-01'),
      thread('Quiet', '2026-01-01')
    ])
    const status = (copilotStatus: 'working' | 'input') =>
      ({
        phase: 'running',
        exitCode: null,
        errorMessage: null,
        runtimeTitle: null,
        lastUserMessage: null,
        copilotStatus
      }) as const
    render(
      <InboxThreads
        repositories={[live]}
        selectedRepository={live}
        selectedThread={null}
        sessions={
          new Map([
            ['Busy', status('working')],
            ['Asking', status('input')]
          ])
        }
        convertingThread={false}
        closingThread={false}
        {...callbacks()}
      />
    )
    const rows = within(screen.getByRole('list', { name: 'Active threads' })).getAllByRole(
      'listitem'
    )
    expect(rows.map((row) => Boolean(row.querySelector('[data-working]')))).toEqual([
      true,
      false,
      false
    ])
  })

  it('animates a settled thread out of the active list before removing it', () => {
    vi.useFakeTimers()
    const animate = vi.fn(() => ({ cancel: vi.fn() }))
    const originalAnimate = Element.prototype.animate
    const originalGetAnimations = Element.prototype.getAnimations
    Element.prototype.animate = animate as unknown as Element['animate']
    Element.prototype.getAnimations = () => []
    try {
      const props = {
        selectedRepository: repositories[0],
        selectedThread: null,
        sessions: new Map(),
        convertingThread: false,
        closingThread: false,
        ...callbacks()
      }
      const { rerender } = render(<InboxThreads repositories={repositories} {...props} />)
      const settledNewest = [
        repositories[0],
        repository('Beta', [{ ...repositories[1].threads[0], settledAt: '2026-03-03' }])
      ]
      rerender(<InboxThreads repositories={settledNewest} {...props} />)
      const activeList = screen.getByRole('list', { name: 'Active threads' })
      const leaving = activeList.querySelector('[data-thread-id="Newest"]')
      expect(leaving?.hasAttribute('data-exiting')).toBe(true)
      expect(leaving?.hasAttribute('inert')).toBe(true)
      expect(animate).toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(activeList.querySelector('[data-thread-id="Newest"]')).toBeNull()
      expect(
        screen
          .getByRole('list', { name: 'Settled threads', hidden: true })
          .querySelector('[data-thread-id="Newest"]')
      ).toBeTruthy()
    } finally {
      Element.prototype.animate = originalAnimate
      Element.prototype.getAnimations = originalGetAnimations
      vi.useRealTimers()
    }
  })
})
