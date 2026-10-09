// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompletedProjectTaskSnapshot,
  ProjectTaskSnapshot,
  RepositorySnapshot
} from '../../../shared/app-types'
import ProjectTaskManager from './ProjectTaskManager'

let nextTaskNumber = 1

function task(
  id: string,
  title: string,
  description = '',
  tags: string[] = []
): ProjectTaskSnapshot {
  return {
    id,
    number: nextTaskNumber++,
    title,
    description,
    tags,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function completed(id: string, title: string, completedAt: string): CompletedProjectTaskSnapshot {
  return { ...task(id, title), completedAt }
}

function repository(
  tasks: ProjectTaskSnapshot[],
  completedTasks?: CompletedProjectTaskSnapshot[]
): RepositorySnapshot {
  return {
    id: 'repo',
    name: 'repo',
    path: '/repo',
    threads: [],
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01',
    lastActivityAt: '2026-01-01',
    tasks,
    completedTasks,
    currentBranch: 'main',
    primaryBranch: 'main',
    branchOptions: [],
    worktreeOptions: [],
    faviconUrl: null
  }
}

function renderManager(
  tasks: ProjectTaskSnapshot[],
  overrides: Partial<React.ComponentProps<typeof ProjectTaskManager>> = {},
  completedTasks?: CompletedProjectTaskSnapshot[]
): React.ComponentProps<typeof ProjectTaskManager> {
  const props: React.ComponentProps<typeof ProjectTaskManager> = {
    repository: repository(tasks, completedTasks),
    taskTags: [],
    busy: false,
    onCreateTask: vi.fn(async () => true),
    onCompleteTask: vi.fn(async () => {}),
    onReopenTask: vi.fn(async () => {}),
    onUpdateTask: vi.fn(async () => true),
    onReorderTasks: vi.fn(async () => {}),
    ...overrides
  }
  render(<ProjectTaskManager {...props} />)
  return props
}

function taskTitles(): string[] {
  return screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent ?? '')
}

describe('ProjectTaskManager', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows untitled tasks and hides empty descriptions', () => {
    renderManager([task('a', '')])

    expect(taskTitles()).toEqual(['Untitled task'])
  })

  it('shows task numbers', () => {
    renderManager([{ ...task('a', 'First'), number: 42 }])

    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('reorders tasks with the keyboard on the drag handle', () => {
    const props = renderManager([task('a', 'First'), task('b', 'Second'), task('c', 'Third')])

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder task Third' }), {
      key: 'ArrowUp'
    })

    expect(props.onReorderTasks).toHaveBeenCalledWith(['a', 'c', 'b'])
    expect(taskTitles()).toEqual(['First', 'Third', 'Second'])
  })

  it('reorders tasks by dragging', () => {
    const props = renderManager([task('a', 'First'), task('b', 'Second'), task('c', 'Third')])
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      setDragImage: vi.fn()
    }
    const cards = screen.getAllByTestId('project-task')
    for (const card of cards) {
      card.getBoundingClientRect = () =>
        ({ top: 0, height: 100, bottom: 100, left: 0, right: 100, width: 100 }) as DOMRect
    }

    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder task First' }), {
      dataTransfer
    })
    fireEvent.dragOver(cards[2], { dataTransfer, clientY: 90 })
    fireEvent.drop(cards[2], { dataTransfer })

    expect(props.onReorderTasks).toHaveBeenCalledWith(['b', 'c', 'a'])
    expect(taskTitles()).toEqual(['Second', 'Third', 'First'])
  })

  it('allows creating a task without any text', async () => {
    const props = renderManager([])

    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    fireEvent.click(screen.getByTitle('Create task'))

    await vi.waitFor(() =>
      expect(props.onCreateTask).toHaveBeenCalledWith({
        title: '',
        description: '',
        tags: [],
        githubIssue: ''
      })
    )
  })

  it('shows a linked GitHub issue that opens in the browser', () => {
    renderManager([
      { ...task('a', 'First'), githubIssueUrl: 'https://github.com/octo/app/issues/34' }
    ])

    const link = screen.getByRole('link', { name: 'Linked GitHub issue octo/app#34' })
    expect(link.getAttribute('href')).toBe('https://github.com/octo/app/issues/34')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.textContent).toBe('#34')
    expect(link.getAttribute('title')).toContain('octo/app#34')
    expect(link.getAttribute('title')).toContain('https://github.com/octo/app/issues/34')
  })

  it('sets, validates and clears the GitHub issue link when editing', async () => {
    const props = renderManager([task('a', 'First')])

    fireEvent.click(screen.getByTitle('Edit task'))
    const input = screen.getByRole('textbox', { name: 'GitHub issue' })
    fireEvent.change(input, { target: { value: 'not an issue' } })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByTitle('Save task changes') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: ' octo/app#5 ' } })
    fireEvent.click(screen.getByTitle('Save task changes'))
    await vi.waitFor(() =>
      expect(props.onUpdateTask).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: 'a', githubIssue: 'octo/app#5' })
      )
    )

    cleanup()
    const linked = renderManager([
      { ...task('b', 'Second'), githubIssueUrl: 'https://github.com/octo/app/issues/5' }
    ])
    fireEvent.click(screen.getByTitle('Edit task'))
    expect((screen.getByRole('textbox', { name: 'GitHub issue' }) as HTMLInputElement).value).toBe(
      'https://github.com/octo/app/issues/5'
    )
    fireEvent.click(screen.getByTitle('Remove GitHub issue link'))
    fireEvent.click(screen.getByTitle('Save task changes'))
    await vi.waitFor(() =>
      expect(linked.onUpdateTask).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: 'b', githubIssue: '' })
      )
    )
  })

  it('filters by title or description after a 300ms debounce and highlights matches', () => {
    vi.useFakeTimers()
    renderManager([
      task('a', 'Fix login', ''),
      task('b', 'Write docs', 'Explain the LOGIN flow'),
      task('c', 'Refactor', '')
    ])

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'login' }
    })
    act(() => vi.advanceTimersByTime(299))
    expect(taskTitles()).toEqual(['Fix login', 'Write docs', 'Refactor'])

    act(() => vi.advanceTimersByTime(1))
    expect(taskTitles()).toEqual(['Fix login', 'Write docs'])
    expect(screen.getByText('2 of 3 tasks')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual([
      'login',
      'LOGIN'
    ])
  })

  it('filters by label and clears the whole search and filter', () => {
    vi.useFakeTimers()
    renderManager(
      [task('a', 'Crash', '', ['bug']), task('b', 'New page', '', ['feature']), task('c', 'Other')],
      { taskTags: ['bug', 'feature'] }
    )

    fireEvent.click(screen.getByRole('button', { name: 'bug' }))
    expect(taskTitles()).toEqual(['Crash'])
    fireEvent.click(screen.getByRole('button', { name: 'feature' }))
    expect(taskTitles()).toEqual(['Crash', 'New page'])

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'page' } })
    act(() => vi.advanceTimersByTime(300))
    expect(taskTitles()).toEqual(['New page'])

    fireEvent.click(screen.getByTitle('Clear search and label filters'))
    expect(taskTitles()).toEqual(['Crash', 'New page', 'Other'])
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'bug' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a no-match state with a clear action', () => {
    vi.useFakeTimers()
    renderManager([task('a', 'First')])

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    act(() => vi.advanceTimersByTime(300))

    expect(screen.getByText('No open tasks match your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(taskTitles()).toEqual(['First'])
  })

  it('reorders within a filtered list relative to the full task order', () => {
    vi.useFakeTimers()
    const props = renderManager([
      task('a', 'Alpha match'),
      task('b', 'Hidden'),
      task('c', 'Gamma match')
    ])

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'match' } })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder task Gamma match' }), {
      key: 'ArrowUp'
    })

    expect(props.onReorderTasks).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('shows completed tasks most recent first, searchable, and reopenable', () => {
    vi.useFakeTimers()
    const props = renderManager([task('open', 'Open task')], {}, [
      completed('old', 'Old fix', '2026-01-02T00:00:00.000Z'),
      completed('new', 'New fix', '2026-01-05T00:00:00.000Z'),
      completed('mid', 'Mid docs', '2026-01-03T00:00:00.000Z')
    ])

    fireEvent.click(screen.getByRole('button', { name: '3 completed tasks' }))

    expect(screen.getByRole('heading', { name: 'Completed tasks' })).toBeTruthy()
    expect(taskTitles()).toEqual(['New fix', 'Mid docs', 'Old fix'])

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fix' } })
    act(() => vi.advanceTimersByTime(300))
    expect(taskTitles()).toEqual(['New fix', 'Old fix'])

    fireEvent.click(screen.getAllByRole('button', { name: 'Reopen' })[1])
    expect(props.onReopenTask).toHaveBeenCalledWith('old')

    fireEvent.click(screen.getByTitle('Back to open tasks'))
    expect(screen.getByRole('heading', { name: 'Open tasks' })).toBeTruthy()
  })

  it('hides the completed tasks link when nothing has been completed', () => {
    renderManager([task('a', 'First')])

    expect(screen.queryByRole('button', { name: /completed task/ })).toBeNull()
  })
})
