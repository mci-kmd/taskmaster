import { describe, expect, it, vi } from 'vitest'
import { createProjectTaskService } from './project-task-service'

describe('project task service', () => {
  it('creates validated repository tasks', () => {
    const saveState = vi.fn()
    const repository = { id: 'repo-1', tasks: [] as Array<{ id: string; title: string }> }
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: {
          yoloEnabled: true,
          terminalFontFamilyInput: '',
          taskTagsInput: 'bug'
        }
      }),
      findRepository: () => repository as never,
      saveState,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'task-1'
    })

    const result = service.createRepositoryTask({
      repositoryId: 'repo-1',
      title: '  Fix bug  ',
      description: '  Detail  ',
      tags: ['bug']
    })

    expect(result.ok).toBe(true)
    expect(repository.tasks[0]).toMatchObject({
      id: 'task-1',
      number: 1,
      title: 'Fix bug',
      description: 'Detail',
      tags: ['bug']
    })
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('updates existing repository tasks without saving unchanged values', () => {
    const saveState = vi.fn()
    const repository = {
      id: 'repo-1',
      tasks: [{ id: 'task-1', title: 'Task', description: 'Initial detail', tags: ['bug'] }]
    }
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: {
          yoloEnabled: true,
          terminalFontFamilyInput: '',
          taskTagsInput: 'bug\nenhancement'
        }
      }),
      findRepository: () => repository as never,
      saveState,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'task-2'
    })

    const unchanged = service.updateRepositoryTask({
      repositoryId: 'repo-1',
      taskId: 'task-1',
      title: 'Task',
      description: 'Initial detail',
      tags: ['bug']
    })
    const changed = service.updateRepositoryTask({
      repositoryId: 'repo-1',
      taskId: 'task-1',
      title: 'Updated task',
      description: 'More detail',
      tags: ['enhancement']
    })

    expect(unchanged.ok).toBe(true)
    expect(changed.ok).toBe(true)
    expect(repository.tasks[0]).toMatchObject({
      title: 'Updated task',
      description: 'More detail',
      tags: ['enhancement']
    })
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('allows project-level tags in addition to global tags', () => {
    const repository = {
      id: 'repo-1',
      taskTagsInput: 'backend\nBug',
      tasks: [] as Array<{ id: string; tags: string[] }>
    }
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: 'bug' }
      }),
      findRepository: () => repository as never,
      saveState: vi.fn(),
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'task-1'
    })

    const result = service.createRepositoryTask({
      repositoryId: 'repo-1',
      title: '',
      description: '',
      tags: ['bug', 'backend', 'other']
    })

    expect(result.ok).toBe(true)
    expect(repository.tasks[0]).toMatchObject({
      title: '',
      description: '',
      tags: ['bug', 'backend']
    })
  })

  it('numbers new tasks after the highest open or completed task number', () => {
    const repository = {
      id: 'repo-1',
      tasks: [{ id: 'a', number: 2 }] as Array<{ id: string; number: number }>,
      completedTasks: [{ id: 'b', number: 7 }]
    }
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }
      }),
      findRepository: () => repository as never,
      saveState: vi.fn(),
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'c'
    })

    service.createRepositoryTask({ repositoryId: 'repo-1', title: 'C', description: '', tags: [] })
    expect(repository.tasks[0]).toMatchObject({ id: 'c', number: 8 })
  })

  it('reorders repository tasks, keeping unknown tasks at the end', () => {
    const saveState = vi.fn()
    const repository = {
      id: 'repo-1',
      tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    }
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }
      }),
      findRepository: () => repository as never,
      saveState,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'x'
    })

    expect(
      service.reorderRepositoryTasks({ repositoryId: 'repo-1', taskIds: ['a', 'b', 'c'] }).ok
    ).toBe(true)
    expect(saveState).not.toHaveBeenCalled()

    service.reorderRepositoryTasks({ repositoryId: 'repo-1', taskIds: ['c', 'missing', 'a', 'c'] })
    expect(repository.tasks.map((task) => task.id)).toEqual(['c', 'a', 'b'])
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('moves completed tasks to completed history and reopens them', () => {
    const saveState = vi.fn()
    const repository: {
      id: string
      tasks: Array<{ id: string; title: string }>
      completedTasks?: Array<{ id: string; title: string; completedAt: string }>
    } = {
      id: 'repo-1',
      tasks: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' }
      ]
    }
    let now = '2026-01-02T00:00:00.000Z'
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }
      }),
      findRepository: () => repository as never,
      saveState,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => now,
      createId: () => 'x'
    })

    expect(service.completeRepositoryTask({ repositoryId: 'repo-1', taskId: 'a' }).ok).toBe(true)
    now = '2026-01-03T00:00:00.000Z'
    expect(service.completeRepositoryTask({ repositoryId: 'repo-1', taskId: 'b' }).ok).toBe(true)
    expect(service.completeRepositoryTask({ repositoryId: 'repo-1', taskId: 'b' }).ok).toBe(false)

    expect(repository.tasks).toEqual([])
    expect(repository.completedTasks).toEqual([
      { id: 'b', title: 'B', completedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'a', title: 'A', completedAt: '2026-01-02T00:00:00.000Z' }
    ])

    expect(service.reopenRepositoryTask({ repositoryId: 'repo-1', taskId: 'a' }).ok).toBe(true)
    expect(service.reopenRepositoryTask({ repositoryId: 'repo-1', taskId: 'a' }).ok).toBe(false)
    expect(repository.tasks).toEqual([{ id: 'a', title: 'A' }])
    expect(repository.completedTasks?.map((task) => task.id)).toEqual(['b'])
    expect(saveState).toHaveBeenCalledTimes(3)
  })
})
