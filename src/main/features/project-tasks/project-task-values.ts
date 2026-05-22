import type { PersistedProjectTask, ProjectTaskTag } from '../../../shared/app-types'
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
  const title = normalizeTaskTitle(task.title) ?? 'Untitled task'
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

export function validateRepositoryTaskValues(input: {
  title: string
  description: string
  tags: ProjectTaskTag[]
  allowedTags: readonly ProjectTaskTag[]
}): ProjectTaskValidationResult {
  const title = normalizeTaskTitle(input.title)
  if (!title) {
    return { ok: false, error: 'Task title is required.' }
  }

  const description = normalizeTaskDescription(input.description)
  if (!description) {
    return { ok: false, error: 'Task description is required.' }
  }

  return {
    ok: true,
    title,
    description,
    tags: normalizeTaskTagsAgainstAllowed(input.tags, input.allowedTags)
  }
}
