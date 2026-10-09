import type { Tool, ToolInvocation, ToolResultObject } from '@github/copilot-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { PersistedRepository } from '../../shared/app-types'
import { createProjectTaskService } from '../features/project-tasks/project-task-service'
import { createProjectTaskTools, PROJECT_TASK_TOOL_NAMES } from './project-task-tools'

function setup(): {
  repository: PersistedRepository
  onTasksChanged: ReturnType<typeof vi.fn>
  call: (name: string, args: unknown) => ToolResultObject
  tools: Tool[]
} {
  const repository: PersistedRepository = {
    id: 'repo-1',
    name: 'Alpha',
    path: '/repos/alpha',
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    taskTagsInput: 'backend',
    tasks: [
      {
        id: 'uuid-2',
        number: 2,
        title: 'Fix login bug',
        description: 'Users get logged out',
        tags: ['bug'],
        createdAt: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'uuid-1',
        number: 1,
        title: 'Add export',
        description: '',
        tags: ['feature', 'backend'],
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    completedTasks: [
      {
        id: 'uuid-3',
        number: 3,
        title: 'Old login cleanup',
        description: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-03T00:00:00.000Z'
      }
    ]
  }
  let ids = 0
  const service = createProjectTaskService({
    ensureState: () => ({
      settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: 'bug\nfeature' }
    }),
    findRepository: (id) => (id === repository.id ? repository : undefined),
    saveState: vi.fn(),
    successResult: () => ({ ok: true }),
    failureResult: (error) => ({ ok: false, error }),
    nowIso: () => '2026-02-01T00:00:00.000Z',
    createId: () => `new-${++ids}`
  })
  const onTasksChanged = vi.fn()
  const tools = createProjectTaskTools({
    resolveRepository: () => repository,
    getAllowedTags: service.getRepositoryTaskTags,
    createTask: service.createRepositoryTask,
    updateTask: service.updateRepositoryTask,
    completeTask: service.completeRepositoryTask,
    onTasksChanged
  })
  const call = (name: string, args: unknown): ToolResultObject => {
    const tool = tools.find((item) => item.name === name)!
    return tool.handler!(args, {} as ToolInvocation) as ToolResultObject
  }
  return { repository, onTasksChanged, call, tools }
}

function parse(result: ToolResultObject): Record<string, unknown> {
  expect(result.resultType).toBe('success')
  return JSON.parse(result.textResultForLlm) as Record<string, unknown>
}

describe('project task tools', () => {
  it('describes tasks as user-owned and only skips permission for listing', () => {
    const { tools } = setup()
    expect(tools.map((tool) => tool.name)).toEqual(Object.values(PROJECT_TASK_TOOL_NAMES))
    for (const tool of tools) {
      expect(tool.description).toContain("user's personal tasks")
      expect(tool.description).toContain('explicitly asks')
    }
    expect(tools.map((tool) => Boolean(tool.skipPermission))).toEqual([true, false, false, false])
  })

  it('lists open tasks in priority order with available labels', () => {
    const { call } = setup()
    const result = parse(call(PROJECT_TASK_TOOL_NAMES.list, {}))
    expect(result).toMatchObject({
      project: 'Alpha',
      status: 'open',
      availableLabels: ['bug', 'feature', 'backend'],
      matchingCount: 2
    })
    expect((result.tasks as Array<{ id: number }>).map((task) => task.id)).toEqual([2, 1])
  })

  it('filters by query, task number, labels and status', () => {
    const { call } = setup()
    const ids = (args: unknown): number[] =>
      (parse(call(PROJECT_TASK_TOOL_NAMES.list, args)).tasks as Array<{ id: number }>).map(
        (task) => task.id
      )
    expect(ids({ query: 'LOGIN' })).toEqual([2])
    expect(ids({ query: 'login', status: 'all' })).toEqual([2, 3])
    expect(ids({ query: '#1' })).toEqual([1])
    expect(ids({ labels: ['Backend', 'bug'] })).toEqual([2, 1])
    expect(ids({ status: 'completed' })).toEqual([3])
    expect(ids({ status: 'all', limit: 1 })).toEqual([2])
    expect(call(PROJECT_TASK_TOOL_NAMES.list, { status: 'done' }).resultType).toBe('failure')
  })

  it('creates tasks with the next number and canonical labels', () => {
    const { call, repository, onTasksChanged } = setup()
    const result = parse(
      call(PROJECT_TASK_TOOL_NAMES.create, { title: ' New thing ', labels: ['BUG'] })
    )
    expect(result.task).toMatchObject({ id: 4, title: 'New thing', labels: ['bug'] })
    expect(repository.tasks[0]).toMatchObject({ id: 'new-1', number: 4 })
    expect(onTasksChanged).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown labels and missing titles without changing tasks', () => {
    const { call, repository, onTasksChanged } = setup()
    const unknown = call(PROJECT_TASK_TOOL_NAMES.create, { title: 'X', labels: ['urgent'] })
    expect(unknown.resultType).toBe('failure')
    expect(unknown.textResultForLlm).toContain('Available labels: bug, feature, backend')
    expect(call(PROJECT_TASK_TOOL_NAMES.create, { title: '  ' }).resultType).toBe('failure')
    expect(repository.tasks).toHaveLength(2)
    expect(onTasksChanged).not.toHaveBeenCalled()
  })

  it('updates only the fields passed, replacing labels', () => {
    const { call, repository } = setup()
    parse(call(PROJECT_TASK_TOOL_NAMES.update, { id: 1, labels: ['bug'] }))
    expect(repository.tasks[1]).toMatchObject({
      title: 'Add export',
      description: '',
      tags: ['bug']
    })
    const result = parse(call(PROJECT_TASK_TOOL_NAMES.update, { id: '#1', description: 'CSV' }))
    expect(result.task).toMatchObject({ id: 1, description: 'CSV', labels: ['bug'] })
    expect(call(PROJECT_TASK_TOOL_NAMES.update, { id: 1 }).resultType).toBe('failure')
    expect(call(PROJECT_TASK_TOOL_NAMES.update, { id: 3, title: 'x' }).textResultForLlm).toContain(
      'completed'
    )
    expect(call(PROJECT_TASK_TOOL_NAMES.update, { id: 9, title: 'x' }).textResultForLlm).toContain(
      'no task #9'
    )
  })

  it('completes open tasks by number', () => {
    const { call, repository } = setup()
    parse(call(PROJECT_TASK_TOOL_NAMES.complete, { id: 2 }))
    expect(repository.tasks.map((task) => task.number)).toEqual([1])
    expect(repository.completedTasks?.[0]).toMatchObject({ number: 2 })
    expect(call(PROJECT_TASK_TOOL_NAMES.complete, { id: 2 }).textResultForLlm).toContain(
      'already completed'
    )
    expect(call(PROJECT_TASK_TOOL_NAMES.complete, { id: 'abc' }).resultType).toBe('failure')
  })
})
