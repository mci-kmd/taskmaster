// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectTaskSnapshot, RepositorySnapshot } from '../../../shared/app-types'
import ProjectTaskManager from './ProjectTaskManager'

function task(id: string, title: string, description = ''): ProjectTaskSnapshot {
  return { id, title, description, tags: [], createdAt: '2026-01-01T00:00:00.000Z' }
}

function repository(tasks: ProjectTaskSnapshot[]): RepositorySnapshot {
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
    currentBranch: 'main',
    primaryBranch: 'main',
    branchOptions: [],
    worktreeOptions: [],
    faviconUrl: null
  }
}

function renderManager(
  tasks: ProjectTaskSnapshot[],
  overrides: Partial<React.ComponentProps<typeof ProjectTaskManager>> = {}
): React.ComponentProps<typeof ProjectTaskManager> {
  const props: React.ComponentProps<typeof ProjectTaskManager> = {
    repository: repository(tasks),
    taskTags: [],
    busy: false,
    onCreateTask: vi.fn(async () => true),
    onCompleteTask: vi.fn(async () => {}),
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
  afterEach(cleanup)

  it('shows untitled tasks and hides empty descriptions', () => {
    renderManager([task('a', '')])

    expect(taskTitles()).toEqual(['Untitled task'])
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
      expect(props.onCreateTask).toHaveBeenCalledWith({ title: '', description: '', tags: [] })
    )
  })
})
