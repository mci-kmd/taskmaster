import type {
  CompleteRepositoryTaskInput,
  CreateRepositoryTaskInput,
  MutationResult,
  PersistedAppState,
  PersistedProjectTask,
  PersistedRepository,
  ReorderRepositoryTasksInput,
  UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import {
  mergeTaskTags,
  normalizeTaskTags,
  parseTaskTagsInput,
  resolveProjectTaskTags
} from '../../../shared/task-tags'
import { sameTaskTags, validateRepositoryTaskValues } from './project-task-values'

type ProjectTaskServiceDependencies = {
  ensureState: () => Pick<PersistedAppState, 'settings'>
  findRepository: (repositoryId: string) => PersistedRepository | undefined
  saveState: () => void
  successResult: () => MutationResult
  failureResult: (error: string, cancelled?: boolean) => MutationResult
  nowIso: () => string
  createId: () => string
}

export function createProjectTaskService(dependencies: ProjectTaskServiceDependencies): {
  createRepositoryTask: (input: CreateRepositoryTaskInput) => MutationResult
  updateRepositoryTask: (input: UpdateRepositoryTaskInput) => MutationResult
  completeRepositoryTask: (input: CompleteRepositoryTaskInput) => MutationResult
  reorderRepositoryTasks: (input: ReorderRepositoryTasksInput) => MutationResult
} {
  const getAllowedTags = (repository: PersistedRepository): string[] =>
    resolveProjectTaskTags(
      parseTaskTagsInput(dependencies.ensureState().settings.taskTagsInput),
      repository.taskTagsInput
    )

  return {
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

      const task: PersistedProjectTask = {
        id: dependencies.createId(),
        title: validation.title,
        description: validation.description,
        tags: validation.tags,
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
      if (
        task.title === validation.title &&
        task.description === validation.description &&
        sameTaskTags(currentTags, validation.tags)
      ) {
        return dependencies.successResult()
      }

      task.title = validation.title
      task.description = validation.description
      task.tags = validation.tags
      dependencies.saveState()
      return dependencies.successResult()
    },

    completeRepositoryTask: (input: CompleteRepositoryTaskInput): MutationResult => {
      const repository = dependencies.findRepository(input.repositoryId)
      if (!repository) {
        return dependencies.failureResult('Repository not found.')
      }

      const currentTasks = repository.tasks ?? []
      const nextTasks = currentTasks.filter((task) => task.id !== input.taskId)
      if (nextTasks.length === currentTasks.length) {
        return dependencies.failureResult('Task not found.')
      }

      repository.tasks = nextTasks
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
