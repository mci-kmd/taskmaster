import type { Tool, ToolResultObject } from '@github/copilot-sdk'
import type {
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  MutationResult,
  PersistedCompletedProjectTask,
  PersistedProjectTask,
  PersistedRepository,
  UpdateRepositoryTaskInput
} from '../../shared/app-types'
import { matchesTaskFilter } from '../../shared/task-filter'
import { mergeTaskTags, normalizeTaskTags } from '../../shared/task-tags'

export type ProjectTaskToolDependencies = {
  /** The project of the session's thread, looked up on every call. */
  resolveRepository: () => PersistedRepository | undefined
  getAllowedTags: (repositoryId: string) => string[]
  createTask: (input: CreateRepositoryTaskInput) => MutationResult
  updateTask: (input: UpdateRepositoryTaskInput) => MutationResult
  completeTask: (input: CompleteRepositoryTaskInput) => MutationResult
  onTasksChanged: () => void
}

export const PROJECT_TASK_TOOL_NAMES = {
  list: 'taskmaster_list_tasks',
  create: 'taskmaster_create_task',
  update: 'taskmaster_update_task',
  complete: 'taskmaster_complete_task'
} as const

const OWNERSHIP_NOTE =
  "These are the user's personal tasks for the current Taskmaster project: a to-do list " +
  'the user owns and manages, not a place for you to track your own work or plans. ' +
  'Only create, edit or complete tasks when the user explicitly asks you to. ' +
  'Tasks are referred to by their numeric id, written as #12.'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

type TaskStatus = 'open' | 'completed'

type TaskView = {
  id: number
  title: string
  description: string
  labels: string[]
  status: TaskStatus
  createdAt: string
  completedAt?: string
}

type Args = Record<string, unknown>

class ToolInputError extends Error {}

function toTaskView(
  task: PersistedProjectTask | PersistedCompletedProjectTask,
  status: TaskStatus
): TaskView {
  return {
    id: task.number,
    title: task.title,
    description: task.description,
    labels: [...task.tags],
    status,
    createdAt: task.createdAt,
    ...('completedAt' in task ? { completedAt: task.completedAt } : {})
  }
}

function success(value: unknown): ToolResultObject {
  return { textResultForLlm: JSON.stringify(value, null, 2), resultType: 'success' }
}

function failure(message: string): ToolResultObject {
  return { textResultForLlm: message, resultType: 'failure', error: message }
}

function asArgs(value: unknown): Args {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Args) : {}
}

function optionalString(args: Args, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be a string.`)
  return value
}

function optionalLabels(args: Args): string[] | undefined {
  const value = args.labels
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ToolInputError('"labels" must be an array of strings.')
  }
  return value as string[]
}

function requiredTaskNumber(args: Args): number {
  const value = args.id
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\s*#?\d+\s*$/.test(value)
        ? Number(value.replace('#', ''))
        : NaN
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ToolInputError('"id" must be a task number, e.g. 12.')
  }
  return parsed
}

/** Maps labels to the project's canonical spelling, rejecting ones that are not configured. */
function resolveLabels(labels: string[], allowed: readonly string[]): string[] {
  const allowedByKey = new Map(allowed.map((tag) => [tag.toLowerCase(), tag]))
  const requested = normalizeTaskTags(labels)
  const unknown = requested.filter((label) => !allowedByKey.has(label.toLowerCase()))
  if (unknown.length > 0) {
    throw new ToolInputError(
      `Unknown label(s): ${unknown.join(', ')}. ` +
        (allowed.length > 0
          ? `Available labels: ${allowed.join(', ')}.`
          : 'This project has no labels configured.') +
        ' Labels are configured by the user in Taskmaster settings.'
    )
  }
  return requested.map((label) => allowedByKey.get(label.toLowerCase())!)
}

function findTask(
  repository: PersistedRepository,
  number: number
):
  | { status: 'open'; task: PersistedProjectTask }
  | { status: 'completed'; task: PersistedCompletedProjectTask }
  | null {
  const open = (repository.tasks ?? []).find((task) => task.number === number)
  if (open) return { status: 'open', task: open }
  const completed = (repository.completedTasks ?? []).find((task) => task.number === number)
  return completed ? { status: 'completed', task: completed } : null
}

const OBJECT_SCHEMA = { type: 'object', additionalProperties: false } as const

const ID_SCHEMA = {
  type: 'integer',
  minimum: 1,
  description: 'The numeric task id (12 for task #12).'
} as const

export function createProjectTaskTools(dependencies: ProjectTaskToolDependencies): Tool[] {
  const run =
    (handler: (args: Args, repository: PersistedRepository) => ToolResultObject) =>
    (rawArgs: unknown): ToolResultObject => {
      const repository = dependencies.resolveRepository()
      if (!repository) return failure('The project for this session no longer exists.')
      try {
        return handler(asArgs(rawArgs), repository)
      } catch (error) {
        if (error instanceof ToolInputError) return failure(error.message)
        throw error
      }
    }

  const mutated = (result: MutationResult): string | null => {
    if (!result.ok) return result.error ?? 'The task could not be saved.'
    dependencies.onTasksChanged()
    return null
  }

  const listTasks: Tool = {
    name: PROJECT_TASK_TOOL_NAMES.list,
    description:
      `List and search the user's tasks for this project. ${OWNERSHIP_NOTE} ` +
      "Open tasks are returned in the user's priority order (highest first), completed tasks " +
      'most recently completed first. The result also lists the labels available in this project.',
    parameters: {
      ...OBJECT_SCHEMA,
      properties: {
        query: {
          type: 'string',
          description:
            'Case-insensitive text to find in the title or description, or "#12" to match a task id.'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only include tasks that have at least one of these labels.'
        },
        status: {
          type: 'string',
          enum: ['open', 'completed', 'all'],
          description: 'Which tasks to include. Defaults to "open".'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: `Maximum number of tasks to return. Defaults to ${DEFAULT_LIST_LIMIT}.`
        }
      }
    },
    skipPermission: true,
    handler: run((args, repository) => {
      const status = args.status ?? 'open'
      if (status !== 'open' && status !== 'completed' && status !== 'all') {
        throw new ToolInputError('"status" must be "open", "completed" or "all".')
      }
      const limit =
        args.limit === undefined || args.limit === null ? DEFAULT_LIST_LIMIT : Number(args.limit)
      if (!Number.isInteger(limit) || limit < 1) {
        throw new ToolInputError('"limit" must be a positive integer.')
      }
      const filter = {
        query: optionalString(args, 'query') ?? '',
        labels: optionalLabels(args) ?? []
      }
      const completed = [...(repository.completedTasks ?? [])].sort((left, right) =>
        right.completedAt.localeCompare(left.completedAt)
      )
      const candidates: TaskView[] = [
        ...(status === 'completed' ? [] : repository.tasks.map((task) => toTaskView(task, 'open'))),
        ...(status === 'open' ? [] : completed.map((task) => toTaskView(task, 'completed')))
      ]
      const matching = candidates.filter((task) =>
        matchesTaskFilter(
          { number: task.id, title: task.title, description: task.description, tags: task.labels },
          filter
        )
      )
      const tasks = matching.slice(0, Math.min(limit, MAX_LIST_LIMIT))
      return success({
        project: repository.name,
        status,
        availableLabels: dependencies.getAllowedTags(repository.id),
        matchingCount: matching.length,
        returnedCount: tasks.length,
        tasks
      })
    })
  }

  const createTask: Tool = {
    name: PROJECT_TASK_TOOL_NAMES.create,
    description:
      `Add a new open task to the user's task list for this project. ${OWNERSHIP_NOTE} ` +
      'New tasks are added at the top of the list.',
    parameters: {
      ...OBJECT_SCHEMA,
      properties: {
        title: { type: 'string', description: 'Short task title.' },
        description: { type: 'string', description: 'Optional details (plain text or Markdown).' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional labels. Must be labels available in this project.'
        }
      },
      required: ['title']
    },
    handler: run((args, repository) => {
      const title = optionalString(args, 'title')?.trim()
      if (!title) throw new ToolInputError('"title" is required.')
      const labels = resolveLabels(
        optionalLabels(args) ?? [],
        dependencies.getAllowedTags(repository.id)
      )
      const error = mutated(
        dependencies.createTask({
          repositoryId: repository.id,
          title,
          description: optionalString(args, 'description') ?? '',
          tags: labels
        })
      )
      if (error) return failure(error)
      const created = repository.tasks[0]
      return success({
        message: `Created task #${created.number}.`,
        task: toTaskView(created, 'open')
      })
    })
  }

  const updateTask: Tool = {
    name: PROJECT_TASK_TOOL_NAMES.update,
    description:
      `Edit an open task in the user's task list for this project. ${OWNERSHIP_NOTE} ` +
      'Only the fields you pass are changed; "labels" replaces all of the task\'s labels.',
    parameters: {
      ...OBJECT_SCHEMA,
      properties: {
        id: ID_SCHEMA,
        title: { type: 'string', description: 'New title.' },
        description: { type: 'string', description: 'New description. Pass "" to clear it.' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The complete new set of labels (pass [] to remove all). Must be labels available in this project.'
        }
      },
      required: ['id']
    },
    handler: run((args, repository) => {
      const number = requiredTaskNumber(args)
      const title = optionalString(args, 'title')
      const description = optionalString(args, 'description')
      const labels = optionalLabels(args)
      if (title === undefined && description === undefined && labels === undefined) {
        throw new ToolInputError('Pass at least one of "title", "description" or "labels".')
      }
      if (title !== undefined && !title.trim()) {
        throw new ToolInputError('"title" cannot be empty.')
      }
      const found = findTask(repository, number)
      if (!found) return failure(`There is no task #${number} in this project.`)
      if (found.status === 'completed') {
        return failure(`Task #${number} is completed. Only open tasks can be edited.`)
      }
      const { task } = found
      const tags =
        labels === undefined
          ? task.tags
          : resolveLabels(
              labels,
              mergeTaskTags(dependencies.getAllowedTags(repository.id), task.tags)
            )
      const error = mutated(
        dependencies.updateTask({
          repositoryId: repository.id,
          taskId: task.id,
          title: title ?? task.title,
          description: description ?? task.description,
          tags
        })
      )
      if (error) return failure(error)
      return success({ message: `Updated task #${number}.`, task: toTaskView(task, 'open') })
    })
  }

  const completeTask: Tool = {
    name: PROJECT_TASK_TOOL_NAMES.complete,
    description:
      `Mark an open task in the user's task list for this project as completed. ${OWNERSHIP_NOTE} ` +
      'Only complete a task when the user asks you to, for example "fix #12 and complete it".',
    parameters: {
      ...OBJECT_SCHEMA,
      properties: { id: ID_SCHEMA },
      required: ['id']
    },
    handler: run((args, repository) => {
      const number = requiredTaskNumber(args)
      const found = findTask(repository, number)
      if (!found) return failure(`There is no task #${number} in this project.`)
      if (found.status === 'completed') return failure(`Task #${number} is already completed.`)
      const error = mutated(
        dependencies.completeTask({ repositoryId: repository.id, taskId: found.task.id })
      )
      if (error) return failure(error)
      return success({ message: `Completed task #${number}.` })
    })
  }

  return [listTasks, createTask, updateTask, completeTask]
}
