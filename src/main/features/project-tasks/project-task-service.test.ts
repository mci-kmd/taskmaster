import { describe, expect, it, vi } from 'vitest'
import { createProjectTaskService } from './project-task-service'

describe('project task service', () => {
  it('creates validated repository tasks', () => {
    const saveState = vi.fn()
    const repository = { id: 'repo-1', tasks: [] as Array<{ id: string; title: string }> }
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: {
          agentProviderId: 'copilot',
          globalFlagsInput: '',
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
          agentProviderId: 'copilot',
          globalFlagsInput: '',
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
})
