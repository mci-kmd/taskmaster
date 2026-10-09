import { useEffect, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import {
  type CompletedProjectTaskSnapshot,
  type CreateRepositoryTaskInput,
  type ProjectTaskSnapshot,
  type ProjectTaskTag,
  type RepositorySnapshot,
  type UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import { mergeTaskTags, sortTaskTags } from '../../../shared/task-tags'
import { isTaskFilterActive, matchesTaskFilter, type TaskFilter } from '../lib/task-filter'
import { getTaskTagTone } from '../lib/task-tag-tone'
import { formatRelativeTime } from '../lib/time'
import { useAnimatedListMotion, usePresenceList } from '../lib/use-presence-list'
import { useNow } from '../lib/useNow'
import Modal from './Modal'
import TaskFilterBar from './TaskFilterBar'
import Button from './ui/Button'
import Checkbox from './ui/Checkbox'
import { Field, TextArea, TextInput } from './ui/Field'
import HighlightedText from './ui/HighlightedText'
import { ArrowLeftIcon, CheckIcon, GripIcon, PlusIcon } from './Icons'

type ProjectTaskManagerProps = {
  repository: RepositorySnapshot
  taskTags: ProjectTaskTag[]
  busy: boolean
  onCreateTask: (input: Omit<CreateRepositoryTaskInput, 'repositoryId'>) => Promise<boolean>
  onCompleteTask: (taskId: string) => Promise<void>
  onReopenTask: (taskId: string) => Promise<void>
  onUpdateTask: (input: Omit<UpdateRepositoryTaskInput, 'repositoryId'>) => Promise<boolean>
  onReorderTasks: (taskIds: string[]) => Promise<void>
}

type TaskView = 'open' | 'completed'

type OptimisticOrder = {
  source: ProjectTaskSnapshot[]
  taskIds: string[]
}

type DragState = {
  taskId: string
  dropIndex: number | null
}

const SEARCH_DEBOUNCE_MS = 300
const COMPLETED_PAGE_SIZE = 50
const NO_COMPLETED_TASKS: CompletedProjectTaskSnapshot[] = []

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

function sortByMostRecentlyCompleted(
  tasks: readonly CompletedProjectTaskSnapshot[]
): CompletedProjectTaskSnapshot[] {
  return [...tasks].sort((left, right) => right.completedAt.localeCompare(left.completedAt))
}

function isCompletedTask(task: ProjectTaskSnapshot): task is CompletedProjectTaskSnapshot {
  return typeof (task as Partial<CompletedProjectTaskSnapshot>).completedAt === 'string'
}

const getTaskKey = (task: ProjectTaskSnapshot): string => task.id

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function ProjectTaskManager({
  repository,
  taskTags,
  busy,
  onCreateTask,
  onCompleteTask,
  onReopenTask,
  onUpdateTask,
  onReorderTasks
}: ProjectTaskManagerProps): React.JSX.Element {
  const now = useNow(30_000)
  const [view, setView] = useState<TaskView>('open')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [selectedLabels, setSelectedLabels] = useState<ProjectTaskTag[]>([])
  const [completedLimit, setCompletedLimit] = useState(COMPLETED_PAGE_SIZE)
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

  useEffect(() => {
    if (queryInput === query) {
      return
    }

    const timer = window.setTimeout(() => setQuery(queryInput), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [queryInput, query])

  // Optimistic order only applies until the next snapshot replaces repository.tasks.
  const tasks =
    optimisticOrder && optimisticOrder.source === repository.tasks
      ? applyTaskOrder(repository.tasks, optimisticOrder.taskIds)
      : repository.tasks
  const completedTasks = sortByMostRecentlyCompleted(
    repository.completedTasks ?? NO_COMPLETED_TASKS
  )
  const filter: TaskFilter = { query, labels: selectedLabels }
  const filterApplied = isTaskFilterActive(filter)
  const filterActive = filterApplied || queryInput.trim().length > 0
  const visibleTasks = filterApplied
    ? tasks.filter((task) => matchesTaskFilter(task, filter))
    : tasks
  const matchingCompletedTasks = filterApplied
    ? completedTasks.filter((task) => matchesTaskFilter(task, filter))
    : completedTasks
  const visibleCompletedTasks = matchingCompletedTasks.slice(0, completedLimit)
  const listItems: ProjectTaskSnapshot[] = view === 'open' ? visibleTasks : visibleCompletedTasks
  const entries = usePresenceList(listItems, getTaskKey, view)
  const listRef = useAnimatedListMotion<HTMLUListElement>(view)
  const visibleIndexById = new Map(visibleTasks.map((task, index) => [task.id, index]))
  const labelOptions = sortTaskTags(
    mergeTaskTags(taskTags, [
      ...selectedLabels,
      ...tasks.flatMap((task) => task.tags),
      ...completedTasks.flatMap((task) => task.tags)
    ]),
    taskTags
  )

  const editingTask =
    editingTaskId === null ? null : (tasks.find((task) => task.id === editingTaskId) ?? null)
  const createTagOptions = taskTags
  const editTagOptions = mergeTaskTags(taskTags, editingTask?.tags ?? [])

  const handleToggleLabel = (label: ProjectTaskTag): void => {
    setSelectedLabels((current) =>
      current.includes(label) ? current.filter((value) => value !== label) : [...current, label]
    )
  }

  const handleClearFilters = (): void => {
    setQueryInput('')
    setQuery('')
    setSelectedLabels([])
  }

  const handleChangeView = (nextView: TaskView): void => {
    setView(nextView)
    setCompletedLimit(COMPLETED_PAGE_SIZE)
    setDragState(null)
    resetEditing()
  }

  const commitTaskOrder = (taskIds: string[]): void => {
    const currentIds = tasks.map((task) => task.id)
    if (taskIds.every((id, index) => id === currentIds[index])) {
      return
    }

    setOptimisticOrder({ source: repository.tasks, taskIds })
    void onReorderTasks(taskIds)
  }

  const getFullTaskIndex = (taskId: string): number => tasks.findIndex((task) => task.id === taskId)

  // Maps an insertion point in the (possibly filtered) visible list to one in the full list.
  const toFullInsertIndex = (visibleInsertIndex: number): number => {
    if (visibleInsertIndex < visibleTasks.length) {
      return getFullTaskIndex(visibleTasks[visibleInsertIndex].id)
    }

    const lastVisible = visibleTasks[visibleTasks.length - 1]
    return lastVisible ? getFullTaskIndex(lastVisible.id) + 1 : tasks.length
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
          toFullInsertIndex(dragState.dropIndex)
        )
      )
    }
    setDragState(null)
  }

  const handleHandleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    const neighbor = visibleTasks[index + offset]
    if (offset === 0 || !neighbor) {
      return
    }

    event.preventDefault()
    const neighborIndex = getFullTaskIndex(neighbor.id)
    commitTaskOrder(
      moveTaskId(
        tasks.map((task) => task.id),
        visibleTasks[index].id,
        offset < 0 ? neighborIndex : neighborIndex + 1
      )
    )
  }

  const isNoopDropIndex = (dropIndex: number | null): boolean => {
    if (!dragState || dropIndex === null) {
      return true
    }

    const fromIndex = visibleTasks.findIndex((task) => task.id === dragState.taskId)
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

  function resetEditing(): void {
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

  const renderTaskSummary = (task: ProjectTaskSnapshot, meta: string): React.JSX.Element => (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        {task.number ? (
          <span
            className="font-mono text-[12px] text-[var(--color-fg-subtle)]"
            title={`Task #${task.number}`}
          >
            #{task.number}
          </span>
        ) : null}
        {task.title ? (
          <h4 className="text-[14px] font-medium text-[var(--color-fg)]">
            <HighlightedText query={query} text={task.title} />
          </h4>
        ) : (
          <h4 className="text-[14px] font-medium italic text-[var(--color-fg-subtle)]">
            Untitled task
          </h4>
        )}
        {sortTaskTags(task.tags, taskTags).map((tag) => (
          <span
            key={tag}
            className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.14em] ${getTaskTagTone(tag)}`}
          >
            {tag}
          </span>
        ))}
      </div>
      {task.description ? (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-fg-muted)]">
          <HighlightedText query={query} text={task.description} />
        </p>
      ) : null}
      <p className="mt-3 text-[11.5px] text-[var(--color-fg-subtle)]">{meta}</p>
    </div>
  )

  const renderEditForm = (task: ProjectTaskSnapshot): React.JSX.Element => (
    <form className="space-y-4" onSubmit={(event) => void handleSaveTask(event, task.id)}>
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
  )

  const renderOpenTask = (task: ProjectTaskSnapshot, index: number): React.JSX.Element => (
    <article
      className={`relative rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 transition-opacity ${dragState?.taskId === task.id ? 'opacity-50' : ''}`}
      data-testid="project-task"
      onDragOver={index >= 0 ? (event) => handleDragOverTask(event, index) : undefined}
    >
      {index >= 0 && activeDropIndex === index ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-[7px] h-0.5 rounded-full bg-[var(--color-info)]"
        />
      ) : null}
      {index >= 0 && activeDropIndex === index + 1 && index === visibleTasks.length - 1 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-[7px] h-0.5 rounded-full bg-[var(--color-info)]"
        />
      ) : null}
      {editingTaskId === task.id ? (
        renderEditForm(task)
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
          {renderTaskSummary(task, `Added ${formatRelativeTime(task.createdAt, now)}`)}

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
  )

  const renderCompletedTask = (task: CompletedProjectTaskSnapshot): React.JSX.Element => (
    <article
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3"
      data-testid="completed-task"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CheckIcon
          aria-hidden="true"
          className="-ml-1.5 mt-1 shrink-0 text-[var(--color-positive)] opacity-70"
          height={14}
          width={14}
        />
        {renderTaskSummary(
          task,
          `Completed ${formatRelativeTime(task.completedAt, now)} · Added ${formatRelativeTime(task.createdAt, now)}`
        )}
        <Button
          disabled={busy}
          onClick={() => void onReopenTask(task.id)}
          size="sm"
          title="Move task back to open tasks"
          variant="ghost"
        >
          Reopen
        </Button>
      </div>
    </article>
  )

  const totalCount = view === 'open' ? tasks.length : completedTasks.length
  const matchingCount = view === 'open' ? visibleTasks.length : matchingCompletedTasks.length
  const remainingCompletedCount = matchingCompletedTasks.length - visibleCompletedTasks.length
  const summary =
    view === 'open'
      ? filterApplied
        ? `${matchingCount} of ${pluralize(totalCount, 'task', 'tasks')}`
        : `${pluralize(totalCount, 'task', 'tasks')}${totalCount > 1 ? ' · drag to reorder by priority' : ''}`
      : filterApplied
        ? `${matchingCount} of ${totalCount} completed`
        : `${totalCount} completed · most recent first`

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5">
        <div className="min-h-0 flex-1">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
            <div key={view} className="tm-fade-in flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-medium tracking-tight text-[var(--color-fg)]">
                  {view === 'open' ? 'Open tasks' : 'Completed tasks'}
                </h3>
                <p className="mt-1 text-[12.5px] text-[var(--color-fg-subtle)]">{summary}</p>
              </div>
              {view === 'open' ? (
                <Button
                  onClick={() => setCreateDialogOpen(true)}
                  size="sm"
                  title="Add task"
                  variant="primary"
                >
                  <PlusIcon width={12} height={12} strokeWidth={1.8} />
                  Add task
                </Button>
              ) : (
                <Button
                  onClick={() => handleChangeView('open')}
                  size="sm"
                  title="Back to open tasks"
                  variant="ghost"
                >
                  <ArrowLeftIcon width={12} height={12} />
                  Open tasks
                </Button>
              )}
            </div>

            {totalCount > 0 || filterActive ? (
              <TaskFilterBar
                active={filterActive}
                labels={labelOptions}
                onClear={handleClearFilters}
                onQueryChange={setQueryInput}
                onToggleLabel={handleToggleLabel}
                query={queryInput}
                selectedLabels={selectedLabels}
              />
            ) : null}

            {entries.length > 0 ? (
              <ul
                ref={listRef}
                aria-label={view === 'open' ? 'Open tasks' : 'Completed tasks'}
                className="relative mt-4"
                onDragOver={view === 'open' ? handleDragOverList : undefined}
                onDrop={view === 'open' ? handleDrop : undefined}
              >
                {entries.map((entry) => {
                  const exiting = entry.exitToken !== null
                  return (
                    <li
                      key={entry.key}
                      aria-hidden={exiting || undefined}
                      className={`pb-3 last:pb-0 ${exiting ? 'pointer-events-none' : ''}`}
                      data-exiting={exiting ? '' : undefined}
                      data-motion-key={entry.key}
                      inert={exiting}
                    >
                      {isCompletedTask(entry.item)
                        ? renderCompletedTask(entry.item)
                        : renderOpenTask(
                            entry.item,
                            exiting ? -1 : (visibleIndexById.get(entry.key) ?? -1)
                          )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div
                key={`${view}-${totalCount > 0 ? 'filtered' : 'empty'}`}
                className="tm-fade-in mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-8 text-center text-[13px] leading-6 text-[var(--color-fg-muted)]"
              >
                {totalCount === 0 ? (
                  view === 'open' ? (
                    'No tasks yet. Use Add task to start tracking this project.'
                  ) : (
                    'No completed tasks yet.'
                  )
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <span>
                      No {view === 'open' ? 'open' : 'completed'} tasks match your search.
                    </span>
                    <Button
                      onClick={handleClearFilters}
                      size="sm"
                      title="Clear search and label filters"
                      variant="secondary"
                    >
                      Clear filters
                    </Button>
                  </div>
                )}
              </div>
            )}

            {view === 'completed' && remainingCompletedCount > 0 ? (
              <div className="mt-4 flex justify-center">
                <Button
                  onClick={() => setCompletedLimit((limit) => limit + COMPLETED_PAGE_SIZE)}
                  size="sm"
                  title="Show older completed tasks"
                  variant="ghost"
                >
                  Show {Math.min(COMPLETED_PAGE_SIZE, remainingCompletedCount)} older
                </Button>
              </div>
            ) : null}
          </section>

          {view === 'open' && completedTasks.length > 0 ? (
            <div className="mt-3 flex justify-center">
              <button
                className="tm-quiet-link inline-flex items-center gap-1.5 rounded px-2 py-1"
                onClick={() => handleChangeView('completed')}
                title="View completed tasks"
                type="button"
              >
                <CheckIcon aria-hidden="true" height={11} width={11} />
                {pluralize(completedTasks.length, 'completed task', 'completed tasks')}
              </button>
            </div>
          ) : null}
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
