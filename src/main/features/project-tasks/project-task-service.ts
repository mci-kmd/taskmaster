import type {
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  MutationResult,
  PersistedAppState,
  PersistedProjectTask,
  PersistedRepository,
  ProjectTaskAttachment,
  ProjectTaskAttachmentInput,
  ReopenRepositoryTaskInput,
  ReorderRepositoryTasksInput,
  UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import {
  mergeTaskTags,
  normalizeTaskTags,
  parseTaskTagsInput,
  resolveProjectTaskTags
} from '../../../shared/task-tags'
import type { TaskAttachmentStore } from './project-task-attachments'
import {
  getNextTaskNumber,
  sameTaskAttachments,
  sameTaskTags,
  validateRepositoryTaskValues
} from './project-task-values'

type ProjectTaskServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'settings'>
  findRepository: (repositoryId: string) => PersistedRepository | undefined
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  nowIso: () => string
  createId: () => string
  /** Where attached files are copied to; without it, tasks cannot get new attachments. */
  attachments?: TaskAttachmentStore
}

type ResolvedAttachments =
  { ok: true; attachments: ProjectTaskAttachment[] } | { ok: false; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createProjectTaskService(dependencies: ProjectTaskServiceDependencies): {
  getRepositoryTaskTags: (repositoryId: string) => string[]
  createRepositoryTask: (input: CreateRepositoryTaskInput) => MutationResult
  updateRepositoryTask: (input: UpdateRepositoryTaskInput) => MutationResult
  completeRepositoryTask: (input: CompleteRepositoryTaskInput) => MutationResult
  reopenRepositoryTask: (input: ReopenRepositoryTaskInput) => MutationResult
  reorderRepositoryTasks: (input: ReorderRepositoryTasksInput) => MutationResult
} {
  const getAllowedTags = (repository: PersistedRepository): string[] =>
    resolveProjectTaskTags(
      parseTaskTagsInput(dependencies.ensureState().settings.taskTagsInput),
      repository.taskTagsInput
    )

  /**
   * Turns form attachments into stored ones: keeps the task's listed attachments and copies new
   * files in. When a copy fails, the copies made so far are deleted again.
   */
  const resolveAttachments = (
    taskId: string,
    inputs: readonly ProjectTaskAttachmentInput[],
    current: readonly ProjectTaskAttachment[]
  ): ResolvedAttachments => {
    const store = dependencies.attachments
    if (!store && inputs.some((input) => input.kind !== 'existing')) {
      return { ok: false, error: 'Attachments are not available.' }
    }

    const currentById = new Map(current.map((attachment) => [attachment.id, attachment]))
    const attachments: ProjectTaskAttachment[] = []
    const added: ProjectTaskAttachment[] = []
    try {
      for (const input of inputs) {
        if (input.kind === 'existing') {
          const existing = currentById.get(input.id)
          if (existing && !attachments.includes(existing)) attachments.push(existing)
          continue
        }
        const saved = store!.save(taskId, dependencies.createId(), input)
        added.push(saved)
        attachments.push(saved)
      }
    } catch (error) {
      store?.remove(added)
      return { ok: false, error: `Could not attach the file. ${errorMessage(error)}` }
    }
    return { ok: true, attachments }
  }
  return {
    getRepositoryTaskTags: (repositoryId: string): string[] => {
      const repository = dependencies.findRepository(repositoryId)
      return repository ? getAllowedTags(repository) : []
    },

    createRepositoryTask: (input: CreateRepositoryTaskInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const validation = validateRepositoryTaskValues({
        ...input,
        allowedTags: getAllowedTags(repository)
      })
      if (!validation.ok) {
        return dependencies.failureResult(validation.error)
      }

      const id = dependencies.createId()
      let attachments: ProjectTaskAttachment[] = []
      if (validation.attachments) {
        const resolved = resolveAttachments(id, validation.attachments, [])
        if (!resolved.ok) {
          return dependencies.failureResult(resolved.error)
        }
        attachments = resolved.attachments
      }

      const task: PersistedProjectTask = {
        id,
        number: getNextTaskNumber(repository.tasks ?? [], repository.completedTasks ?? []),
        title: validation.title,
        description: validation.description,
        tags: validation.tags,
        ...(validation.githubIssueUrl ? { githubIssueUrl: validation.githubIssueUrl } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        createdAt: dependencies.nowIso()
      }

      repository.tasks = [task, ...(repository.tasks ?? [])]
      dependencies.saveState()
      return dependencies.successResult()
    },

    updateRepositoryTask: (input: UpdateRepositoryTaskInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const task = (repository.tasks ?? []).find((item) => item.id === input.taskId)
      if (!task) {
        return dependencies.failureResult('Task not found.')
      }

      const validation = validateRepositoryTaskValues({
        ...input,
        allowedTags: mergeTaskTags(getAllowedTags(repository), task.tags)
      })
      if (!validation.ok) {
        return dependencies.failureResult(validation.error)
      }

      const currentTags = normalizeTaskTags(task.tags)
      const githubIssueUrl =
        input.githubIssue === undefined ? task.githubIssueUrl : validation.githubIssueUrl
      const currentAttachments = task.attachments ?? []
      let attachments = currentAttachments
      if (validation.attachments) {
        const resolved = resolveAttachments(task.id, validation.attachments, currentAttachments)
        if (!resolved.ok) {
          return dependencies.failureResult(resolved.error)
        }
        attachments = resolved.attachments
      }
      if (
        task.title === validation.title &&
        task.description === validation.description &&
        sameTaskTags(currentTags, validation.tags) &&
        task.githubIssueUrl === githubIssueUrl &&
        sameTaskAttachments(currentAttachments, attachments)
      ) {
        return dependencies.successResult()
      }

      task.title = validation.title
      task.description = validation.description
      task.tags = validation.tags
      if (githubIssueUrl) {
        task.githubIssueUrl = githubIssueUrl
      } else {
        delete task.githubIssueUrl
      }
      if (attachments.length > 0) {
        task.attachments = attachments
      } else {
        delete task.attachments
      }
      dependencies.saveState()
      dependencies.attachments?.remove(
        currentAttachments.filter((attachment) => !attachments.includes(attachment))
      )
      return dependencies.successResult()
    },

    completeRepositoryTask: (input: CompleteRepositoryTaskInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const currentTasks = repository.tasks ?? []
      const task = currentTasks.find((item) => item.id === input.taskId)
      if (!task) {
        return dependencies.failureResult('Task not found.')
      }

      repository.tasks = currentTasks.filter((item) => item !== task)
      repository.completedTasks = [
        { ...task, completedAt: dependencies.nowIso() },
        ...(repository.completedTasks ?? [])
      ]
      dependencies.saveState()
      return dependencies.successResult()
    },

    reopenRepositoryTask: (input: ReopenRepositoryTaskInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const completedTasks = repository.completedTasks ?? []
      const completedTask = completedTasks.find((item) => item.id === input.taskId)
      if (!completedTask) {
        return dependencies.failureResult('Task not found.')
      }

      const { completedAt: _completedAt, ...task } = completedTask
      void _completedAt
      repository.completedTasks = completedTasks.filter((item) => item !== completedTask)
      repository.tasks = [task, ...(repository.tasks ?? [])]
      dependencies.saveState()
      return dependencies.successResult()
    },

    reorderRepositoryTasks: (input: ReorderRepositoryTasksInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const currentTasks = repository.tasks ?? []
      const tasksById = new Map(currentTasks.map((task) => [task.id, task]))
      const orderedIds = Array.isArray(input.taskIds) ? input.taskIds : []
      const nextTasks: PersistedProjectTask[] = []
      const seen = new Set<string>()
      for (const taskId of orderedIds) {
        const task = tasksById.get(taskId)
        if (!task || seen.has(taskId)) {
          continue
        }
        seen.add(taskId)
        nextTasks.push(task)
      }
      // Keep tasks the renderer did not know about (e.g. created concurrently) at the end.
      for (const task of currentTasks) {
        if (!seen.has(task.id)) {
          nextTasks.push(task)
        }
      }

      if (nextTasks.every((task, index) => task === currentTasks[index])) {
        return dependencies.successResult()
      }

      repository.tasks = nextTasks
      dependencies.saveState()
      return dependencies.successResult()
    }
  }
}
