import type {
  PersistedCompletedProjectTask,
  PersistedProjectTask,
  ProjectTaskTag
} from '../../../shared/app-types'
import { normalizeTaskTags, normalizeTaskTagsAgainstAllowed } from '../../../shared/task-tags'

export type ProjectTaskValidationResult =
  | {
      ok: true
      title: string
      description: string
      tags: ProjectTaskTag[]
    }
  | {
      ok: false
      error: string
    }

export function normalizeTaskTitle(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function normalizeTaskDescription(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function sameTaskTags(
  left: readonly ProjectTaskTag[],
  right: readonly ProjectTaskTag[]
): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

export function normalizePersistedTask(task: PersistedProjectTask): PersistedProjectTask {
  const title = normalizeTaskTitle(task.title) ?? ''
  const description = normalizeTaskDescription(task.description) ?? ''
  const currentTags = Array.isArray(task.tags) ? task.tags : []
  const tags = normalizeTaskTags(currentTags)

  return title === task.title &&
    description === task.description &&
    Array.isArray(task.tags) &&
    sameTaskTags(tags, currentTags)
    ? task
    : {
        ...task,
        title,
        description,
        tags
      }
}

export function normalizePersistedCompletedTask(
  task: PersistedCompletedProjectTask
): PersistedCompletedProjectTask {
  const normalized = normalizePersistedTask(task)
  const completedAt = typeof task.completedAt === 'string' ? task.completedAt : task.createdAt
  return normalized === task && completedAt === task.completedAt
    ? task
    : { ...normalized, completedAt }
}

/** Returns the same array when nothing changed, and undefined when absent or invalid. */
export function normalizePersistedCompletedTasks(
  value: unknown
): PersistedCompletedProjectTask[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const tasks = value as PersistedCompletedProjectTask[]
  const normalized = tasks.map((task) => normalizePersistedCompletedTask(task))
  return normalized.every((task, index) => task === tasks[index]) ? tasks : normalized
}

export function validateRepositoryTaskValues(input: {
  title: string
  description: string
  tags: ProjectTaskTag[]
  allowedTags: readonly ProjectTaskTag[]
}): ProjectTaskValidationResult {
  return {
    ok: true,
    title: normalizeTaskTitle(input.title) ?? '',
    description: normalizeTaskDescription(input.description) ?? '',
    tags: normalizeTaskTagsAgainstAllowed(input.tags, input.allowedTags)
  }
}
