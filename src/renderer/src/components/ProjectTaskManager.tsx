import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import {
  type CreateRepositoryTaskInput,
  type ProjectTaskSnapshot,
  type ProjectTaskTag,
  type RepositorySnapshot,
  type UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import { mergeTaskTags, sortTaskTags } from '../../../shared/task-tags'
import { formatRelativeTime } from '../lib/time'
import { useNow } from '../lib/useNow'
import Modal from './Modal'
import Button from './ui/Button'
import Checkbox from './ui/Checkbox'
import { Field, TextArea, TextInput } from './ui/Field'
import { GripIcon, PlusIcon } from './Icons'

type ProjectTaskManagerProps = {
  repository: RepositorySnapshot
  taskTags: ProjectTaskTag[]
  busy: boolean
  onCreateTask: (input: Omit<CreateRepositoryTaskInput, 'repositoryId'>) => Promise<boolean>
  onCompleteTask: (taskId: string) => Promise<void>
  onUpdateTask: (input: Omit<UpdateRepositoryTaskInput, 'repositoryId'>) => Promise<boolean>
  onReorderTasks: (taskIds: string[]) => Promise<void>
}

type OptimisticOrder = {
  source: ProjectTaskSnapshot[]
  taskIds: string[]
}

type DragState = {
  taskId: string
  dropIndex: number | null
}

function applyTaskOrder(
  tasks: ProjectTaskSnapshot[],
  taskIds: readonly string[]
): ProjectTaskSnapshot[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const ordered = taskIds.flatMap((id) => {
    const task = tasksById.get(id)
    return task ? [task] : []
  })
  const orderedIds = new Set(ordered.map((task) => task.id))
  return [...ordered, ...tasks.filter((task) => !orderedIds.has(task.id))]
}

function moveTaskId(taskIds: readonly string[], taskId: string, insertIndex: number): string[] {
  const fromIndex = taskIds.indexOf(taskId)
  if (fromIndex < 0) {
    return [...taskIds]
  }

  const next = taskIds.filter((id) => id !== taskId)
  const targetIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, taskId)
  return next
}

function getTagTone(tag: ProjectTaskTag): string {
  switch (tag.trim().toLowerCase()) {
    case 'bug':
      return 'border-[rgba(240,140,140,0.35)] bg-[rgba(240,140,140,0.1)] text-[var(--color-danger)]'
    case 'feature':
      return 'border-[rgba(158,197,255,0.35)] bg-[rgba(158,197,255,0.1)] text-[var(--color-info)]'
    default:
      return 'border-[rgba(196,167,255,0.35)] bg-[rgba(196,167,255,0.1)] text-[#c4a7ff]'
  }
}

export default function ProjectTaskManager({
  repository,
  taskTags,
  busy,
  onCreateTask,
  onCompleteTask,
  onUpdateTask,
  onReorderTasks
}: ProjectTaskManagerProps): React.JSX.Element {
  const now = useNow(30_000)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<ProjectTaskTag[]>([])
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [editingTags, setEditingTags] = useState<ProjectTaskTag[]>([])
  const [optimisticOrder, setOptimisticOrder] = useState<OptimisticOrder | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  // Optimistic order only applies until the next snapshot replaces repository.tasks.
  const tasks =
    optimisticOrder && optimisticOrder.source === repository.tasks
      ? applyTaskOrder(repository.tasks, optimisticOrder.taskIds)
      : repository.tasks
  const editingTask =
    editingTaskId === null ? null : (tasks.find((task) => task.id === editingTaskId) ?? null)
  const createTagOptions = taskTags
  const editTagOptions = mergeTaskTags(taskTags, editingTask?.tags ?? [])

  const commitTaskOrder = (taskIds: string[]): void => {
    const currentIds = tasks.map((task) => task.id)
    if (taskIds.every((id, index) => id === currentIds[index])) {
      return
    }

    setOptimisticOrder({ source: repository.tasks, taskIds })
    void onReorderTasks(taskIds)
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, taskId: string): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
    const card = event.currentTarget.closest('article')
    if (card) {
      const bounds = card.getBoundingClientRect()
      event.dataTransfer.setDragImage(card, event.clientX - bounds.left, event.clientY - bounds.top)
    }
    setDragState({ taskId, dropIndex: null })
  }

  const handleDragOverTask = (event: DragEvent<HTMLElement>, index: number): void => {
    if (!dragState) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const dropIndex = event.clientY < bounds.top + bounds.height / 2 ? index : index + 1
    if (dropIndex !== dragState.dropIndex) {
      setDragState({ ...dragState, dropIndex })
    }
  }

  const handleDragOverList = (event: DragEvent<HTMLElement>): void => {
    if (dragState) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    if (!dragState) {
      return
    }

    event.preventDefault()
    if (dragState.dropIndex !== null) {
      commitTaskOrder(
        moveTaskId(
          tasks.map((task) => task.id),
          dragState.taskId,
          dragState.dropIndex
        )
      )
    }
    setDragState(null)
  }

  const handleHandleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    const nextIndex = index + offset
    if (offset === 0 || nextIndex < 0 || nextIndex >= tasks.length) {
      return
    }

    event.preventDefault()
    const taskIds = tasks.map((task) => task.id)
    const [taskId] = taskIds.splice(index, 1)
    taskIds.splice(nextIndex, 0, taskId)
    commitTaskOrder(taskIds)
  }

  const isNoopDropIndex = (dropIndex: number | null): boolean => {
    if (!dragState || dropIndex === null) {
      return true
    }

    const fromIndex = tasks.findIndex((task) => task.id === dragState.taskId)
    return dropIndex === fromIndex || dropIndex === fromIndex + 1
  }

  const activeDropIndex =
    dragState && !isNoopDropIndex(dragState.dropIndex) ? dragState.dropIndex : null

  const handleToggleTag = (tag: ProjectTaskTag, checked: boolean): void => {
    setTags((current) => {
      if (checked) {
        return current.includes(tag) ? current : [...current, tag]
      }

      return current.filter((value) => value !== tag)
    })
  }

  const resetCreateForm = (): void => {
    setTitle('')
    setDescription('')
    setTags([])
  }

  const handleCloseCreateDialog = (): void => {
    setCreateDialogOpen(false)
    resetCreateForm()
  }

  const resetEditing = (): void => {
    setEditingTaskId(null)
    setEditingTitle('')
    setEditingDescription('')
    setEditingTags([])
  }

  const handleStartEditing = (task: ProjectTaskSnapshot): void => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
    setEditingDescription(task.description)
    setEditingTags(sortTaskTags(task.tags, taskTags))
  }

  const handleToggleEditingTag = (tag: ProjectTaskTag, checked: boolean): void => {
    setEditingTags((current) => {
      if (checked) {
        return current.includes(tag) ? current : [...current, tag]
      }

      return current.filter((value) => value !== tag)
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const ok = await onCreateTask({
      title,
      description,
      tags: sortTaskTags(tags, taskTags)
    })
    if (!ok) {
      return
    }

    handleCloseCreateDialog()
  }

  const handleSaveTask = async (
    event: FormEvent<HTMLFormElement>,
    taskId: string
  ): Promise<void> => {
    event.preventDefault()

    const ok = await onUpdateTask({
      taskId,
      title: editingTitle,
      description: editingDescription,
      tags: sortTaskTags(editingTags, taskTags)
    })
    if (!ok) {
      return
    }

    resetEditing()
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5">
        <div className="min-h-0 flex-1">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-medium tracking-tight text-[var(--color-fg)]">
                  Open tasks
                </h3>
                <p className="mt-1 text-[12.5px] text-[var(--color-fg-subtle)]">
                  {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                  {tasks.length > 1 ? ' · drag to reorder by priority' : ''}
                </p>
              </div>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                size="sm"
                title="Add task"
                variant="primary"
              >
                <PlusIcon width={12} height={12} strokeWidth={1.8} />
                Add task
              </Button>
            </div>

            {tasks.length > 0 ? (
              <div className="mt-4 space-y-3" onDragOver={handleDragOverList} onDrop={handleDrop}>
                {tasks.map((task, index) => (
                  <article
                    key={task.id}
                    className={`relative rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 ${dragState?.taskId === task.id ? 'opacity-50' : ''}`}
                    data-testid="project-task"
                    onDragOver={(event) => handleDragOverTask(event, index)}
                  >
                    {activeDropIndex === index ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 -top-[7px] h-0.5 rounded-full bg-[var(--color-info)]"
                      />
                    ) : null}
                    {activeDropIndex === index + 1 && index === tasks.length - 1 ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 -bottom-[7px] h-0.5 rounded-full bg-[var(--color-info)]"
                      />
                    ) : null}
                    {editingTaskId === task.id ? (
                      <form
                        className="space-y-4"
                        onSubmit={(event) => void handleSaveTask(event, task.id)}
                      >
                        <Field htmlFor={`edit-task-title-${task.id}`} label="Title">
                          <TextInput
                            id={`edit-task-title-${task.id}`}
                            onChange={(event) => setEditingTitle(event.target.value)}
                            value={editingTitle}
                          />
                        </Field>

                        <Field htmlFor={`edit-task-description-${task.id}`} label="Description">
                          <TextArea
                            id={`edit-task-description-${task.id}`}
                            onChange={(event) => setEditingDescription(event.target.value)}
                            value={editingDescription}
                          />
                        </Field>

                        <Field label="Tags">
                          <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-3">
                            {editTagOptions.length > 0 ? (
                              editTagOptions.map((tag) => (
                                <Checkbox
                                  key={tag}
                                  checked={editingTags.includes(tag)}
                                  disabled={busy}
                                  label={tag}
                                  onChange={(checked) => handleToggleEditingTag(tag, checked)}
                                  title={`Assign ${tag} tag`}
                                />
                              ))
                            ) : (
                              <p className="text-[12.5px] text-[var(--color-fg-subtle)]">
                                No task tags configured in Settings or project settings.
                              </p>
                            )}
                          </div>
                        </Field>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[11.5px] text-[var(--color-fg-subtle)]">
                            Added {formatRelativeTime(task.createdAt, now)}
                          </p>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              disabled={busy}
                              onClick={resetEditing}
                              size="sm"
                              title="Cancel editing"
                              variant="ghost"
                            >
                              Cancel
                            </Button>
                            <Button
                              disabled={busy}
                              size="sm"
                              title="Save task changes"
                              type="submit"
                              variant="primary"
                            >
                              Save
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => void onCompleteTask(task.id)}
                              size="sm"
                              title="Complete task"
                              variant="secondary"
                            >
                              Complete
                            </Button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          aria-label={`Reorder task ${task.title || 'Untitled task'}`}
                          className="-ml-2 mt-0.5 cursor-grab rounded p-0.5 text-[var(--color-fg-faint)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-fg-muted)] active:cursor-grabbing"
                          draggable
                          onDragEnd={() => setDragState(null)}
                          onDragStart={(event) => handleDragStart(event, task.id)}
                          onKeyDown={(event) => handleHandleKeyDown(event, index)}
                          title="Drag to reorder (or focus and use ↑/↓)"
                          type="button"
                        >
                          <GripIcon width={14} height={14} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {task.title ? (
                              <h4 className="text-[14px] font-medium text-[var(--color-fg)]">
                                {task.title}
                              </h4>
                            ) : (
                              <h4 className="text-[14px] font-medium italic text-[var(--color-fg-subtle)]">
                                Untitled task
                              </h4>
                            )}
                            {sortTaskTags(task.tags, taskTags).map((tag) => (
                              <span
                                key={tag}
                                className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.14em] ${getTagTone(tag)}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          {task.description ? (
                            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-fg-muted)]">
                              {task.description}
                            </p>
                          ) : null}
                          <p className="mt-3 text-[11.5px] text-[var(--color-fg-subtle)]">
                            Added {formatRelativeTime(task.createdAt, now)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            disabled={busy}
                            onClick={() => handleStartEditing(task)}
                            size="sm"
                            title="Edit task"
                            variant="ghost"
                          >
                            Edit
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() => void onCompleteTask(task.id)}
                            size="sm"
                            title="Complete task"
                            variant="secondary"
                          >
                            Complete
                          </Button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-8 text-center text-[13px] leading-6 text-[var(--color-fg-muted)]">
                No tasks yet. Use Add task to start tracking this project.
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        description={
          createTagOptions.length > 0
            ? 'Add an optional title, description, and tags.'
            : 'Add an optional title and description.'
        }
        onClose={handleCloseCreateDialog}
        open={createDialogOpen}
        title="Add task"
        width="md"
      >
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <Field htmlFor="project-task-title" label="Title">
            <TextInput
              autoFocus
              id="project-task-title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Short task summary"
              value={title}
            />
          </Field>

          <Field htmlFor="project-task-description" label="Description">
            <TextArea
              id="project-task-description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What needs to be done?"
              value={description}
            />
          </Field>

          <Field label="Tags">
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3">
              {createTagOptions.length > 0 ? (
                createTagOptions.map((tag) => (
                  <Checkbox
                    key={tag}
                    checked={tags.includes(tag)}
                    disabled={busy}
                    label={tag}
                    onChange={(checked) => handleToggleTag(tag, checked)}
                    title={`Assign ${tag} tag`}
                  />
                ))
              ) : (
                <p className="text-[12.5px] text-[var(--color-fg-subtle)]">
                  No task tags configured in Settings or project settings.
                </p>
              )}
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleCloseCreateDialog} title="Cancel" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy} size="md" title="Create task" type="submit" variant="primary">
              <PlusIcon width={12} height={12} strokeWidth={1.8} />
              Add task
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
