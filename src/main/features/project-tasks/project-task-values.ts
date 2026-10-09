import type {
  PersistedCompletedProjectTask,
  PersistedProjectTask,
  ProjectTaskTag
} from '../../../shared/app-types'
import { GITHUB_ISSUE_INPUT_HINT, parseGitHubIssueReference } from '../../../shared/github-issue'
import { normalizeTaskTags, normalizeTaskTagsAgainstAllowed } from '../../../shared/task-tags'

export type ProjectTaskValidationResult =
  | {
      ok: true
      title: string
      description: string
      tags: ProjectTaskTag[]
      /** Canonical issue URL, or undefined when no link was given. */
      githubIssueUrl: string | undefined
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
  const githubIssueUrl =
    task.githubIssueUrl === undefined
      ? undefined
      : parseGitHubIssueReference(task.githubIssueUrl)?.url

  if (
    title === task.title &&
    description === task.description &&
    Array.isArray(task.tags) &&
    sameTaskTags(tags, currentTags) &&
    githubIssueUrl === task.githubIssueUrl
  ) {
    return task
  }

  const { githubIssueUrl: _previousIssueUrl, ...rest } = task
  void _previousIssueUrl
  return {
    ...rest,
    title,
    description,
    tags,
    ...(githubIssueUrl ? { githubIssueUrl } : {})
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

function isTaskNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function getNextTaskNumber(
  tasks: readonly PersistedProjectTask[],
  completedTasks: readonly PersistedProjectTask[] = []
): number {
  let max = 0
  for (const task of [...tasks, ...completedTasks]) {
    if (isTaskNumber(task.number) && task.number > max) max = task.number
  }
  return max + 1
}

/**
 * Gives every open and completed task a unique number, keeping valid existing ones.
 * Tasks without one (or with a duplicate) are numbered oldest first after the current maximum.
 * Returns the same arrays when nothing changed.
 */
export function assignTaskNumbers(
  tasks: PersistedProjectTask[],
  completedTasks: PersistedCompletedProjectTask[] | undefined
): {
  tasks: PersistedProjectTask[]
  completedTasks: PersistedCompletedProjectTask[] | undefined
} {
  const used = new Set<number>()
  const missing: PersistedProjectTask[] = []
  for (const task of [...tasks, ...(completedTasks ?? [])]) {
    if (isTaskNumber(task.number) && !used.has(task.number)) {
      used.add(task.number)
    } else {
      missing.push(task)
    }
  }
  if (missing.length === 0) {
    return { tasks, completedTasks }
  }

  let next = getNextTaskNumber(tasks, completedTasks)
  const assigned = new Map<PersistedProjectTask, number>()
  const byAge = [...missing].sort((left, right) =>
    String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  )
  for (const task of byAge) {
    assigned.set(task, next++)
  }
  const renumber = <T extends PersistedProjectTask>(task: T): T => {
    const number = assigned.get(task)
    return number === undefined ? task : { ...task, number }
  }
  return { tasks: tasks.map(renumber), completedTasks: completedTasks?.map(renumber) }
}

export function validateRepositoryTaskValues(input: {
  title: string
  description: string
  tags: ProjectTaskTag[]
  allowedTags: readonly ProjectTaskTag[]
  githubIssue?: string
}): ProjectTaskValidationResult {
  let githubIssueUrl: string | undefined
  if (input.githubIssue?.trim()) {
    const reference = parseGitHubIssueReference(input.githubIssue)
    if (!reference) {
      return { ok: false, error: `Invalid GitHub issue link. ${GITHUB_ISSUE_INPUT_HINT}` }
    }
    githubIssueUrl = reference.url
  }

  return {
    ok: true,
    title: normalizeTaskTitle(input.title) ?? '',
    description: normalizeTaskDescription(input.description) ?? '',
    tags: normalizeTaskTagsAgainstAllowed(input.tags, input.allowedTags),
    githubIssueUrl
  }
}
