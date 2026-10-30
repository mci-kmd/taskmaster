import type {
  PersistedCompletedProjectTask,
  PersistedProjectTask,
  ProjectTaskAttachment,
  ProjectTaskAttachmentInput,
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
      /** Undefined when the input did not list attachments. */
      attachments?: ProjectTaskAttachmentInput[]
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isTaskAttachment(value: unknown): value is ProjectTaskAttachment {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Partial<Record<keyof ProjectTaskAttachment, unknown>>
  return (
    isNonEmptyString(attachment.id) &&
    typeof attachment.displayName === 'string' &&
    isNonEmptyString(attachment.path) &&
    (attachment.mimeType === undefined || typeof attachment.mimeType === 'string')
  )
}

/**
 * Keeps valid attachments with unique ids. Returns the same array when nothing changed, and
 * undefined when absent, empty or invalid.
 */
export function normalizeTaskAttachments(value: unknown): ProjectTaskAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = new Set<string>()
  const attachments = value.filter((item): item is ProjectTaskAttachment => {
    if (!isTaskAttachment(item) || ids.has(item.id)) return false
    ids.add(item.id)
    return true
  })
  if (attachments.length === 0) return undefined
  return attachments.length === value.length ? (value as ProjectTaskAttachment[]) : attachments
}

function parseTaskAttachmentInput(value: unknown): ProjectTaskAttachmentInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (input.kind === 'existing') {
    return isNonEmptyString(input.id) ? { kind: 'existing', id: input.id } : null
  }
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : ''
  if (input.kind === 'file') {
    return isNonEmptyString(input.path) ? { kind: 'file', path: input.path, displayName } : null
  }
  if (input.kind === 'blob') {
    return typeof input.data === 'string' && typeof input.mimeType === 'string'
      ? { kind: 'blob', data: input.data, mimeType: input.mimeType, displayName }
      : null
  }
  return null
}

/** Undefined when no attachments were given, or null when any of them is malformed. */
export function parseTaskAttachmentInputs(
  value: unknown
): ProjectTaskAttachmentInput[] | undefined | null {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return null
  const inputs = value.map(parseTaskAttachmentInput)
  return inputs.every((input) => input !== null) ? inputs : null
}

export function sameTaskAttachments(
  left: readonly ProjectTaskAttachment[] | undefined,
  right: readonly ProjectTaskAttachment[] | undefined
): boolean {
  const leftItems = left ?? []
  const rightItems = right ?? []
  return (
    leftItems.length === rightItems.length &&
    leftItems.every((attachment, index) => attachment === rightItems[index])
  )
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
  const attachments = normalizeTaskAttachments(task.attachments)

  if (
    title === task.title &&
    description === task.description &&
    Array.isArray(task.tags) &&
    sameTaskTags(tags, currentTags) &&
    githubIssueUrl === task.githubIssueUrl &&
    attachments === task.attachments
  ) {
    return task
  }

  const { githubIssueUrl: _previousIssueUrl, attachments: _previousAttachments, ...rest } = task
  void _previousIssueUrl
  void _previousAttachments
  return {
    ...rest,
    title,
    description,
    tags,
    ...(githubIssueUrl ? { githubIssueUrl } : {}),
    ...(attachments ? { attachments } : {})
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
  attachments?: unknown
}): ProjectTaskValidationResult {
  let githubIssueUrl: string | undefined
  if (input.githubIssue?.trim()) {
    const reference = parseGitHubIssueReference(input.githubIssue)
    if (!reference) {
      return { ok: false, error: `Invalid GitHub issue link. ${GITHUB_ISSUE_INPUT_HINT}` }
    }
    githubIssueUrl = reference.url
  }

  const attachments = parseTaskAttachmentInputs(input.attachments)
  if (attachments === null) {
    return { ok: false, error: 'Invalid attachments.' }
  }

  return {
    ok: true,
    title: normalizeTaskTitle(input.title) ?? '',
    description: normalizeTaskDescription(input.description) ?? '',
    tags: normalizeTaskTagsAgainstAllowed(input.tags, input.allowedTags),
    githubIssueUrl,
    ...(attachments ? { attachments } : {})
  }
}
