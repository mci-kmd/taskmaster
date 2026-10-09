import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import {
  type CompletedProjectTaskSnapshot,
  type CreateRepositoryTaskInput,
  type ProjectTaskSnapshot,
  type ProjectTaskTag,
  type RepositorySnapshot,
  type UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import {
  formatGitHubIssueReference,
  GITHUB_ISSUE_INPUT_HINT,
  parseGitHubIssueReference
} from '../../../shared/github-issue'
import { mergeTaskTags, sortTaskTags } from '../../../shared/task-tags'
import { MOTION, canAnimate } from '../lib/motion'
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
import Presence from './ui/Presence'
import { ArrowLeftIcon, CheckIcon, GitHubIssueIcon, GripIcon, PlusIcon } from './Icons'

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

function isInvalidGitHubIssue(value: string): boolean {
  return value.trim().length > 0 && parseGitHubIssueReference(value) === null
}

/**
 * Crossfades between keyed content and animates the height difference, so neighbours glide
 * instead of jumping (e.g. a task card switching to its edit form).
 */
function HeightSwap({ swapKey, children }: { swapKey: string; children: ReactNode }): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const last = useRef<{ key: string; height: number } | null>(null)

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const height = element.offsetHeight
    const previous = last.current
    last.current = { key: swapKey, height }
    if (!previous || previous.key === swapKey || previous.height === height || !canAnimate()) {
      return
    }
    element.style.overflow = 'clip'
    const animation = element.animate(
      [{ height: `${previous.height}px` }, { height: `${height}px` }],
      { duration: MOTION.slowMs, easing: MOTION.easeOut }
    )
    animation.onfinish = animation.oncancel = () => {
      element.style.overflow = ''
    }
  })

  return (
    <div ref={box}>
      <div className="tm-fade-in" key={swapKey}>
        {children}
      </div>
    </div>
  )
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
  const [githubIssue, setGithubIssue] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [editingTags, setEditingTags] = useState<ProjectTaskTag[]>([])
  const [editingGithubIssue, setEditingGithubIssue] = useState('')
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
  // Switching views crossfades the whole list (keyed below) rather than each task.
  const listRef = useAnimatedListMotion<HTMLUListElement>(view, { enterOnReset: false })
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
    setGithubIssue('')
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
    setEditingGithubIssue('')
  }

  const handleStartEditing = (task: ProjectTaskSnapshot): void => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
    setEditingDescription(task.description)
    setEditingTags(sortTaskTags(task.tags, taskTags))
    setEditingGithubIssue(task.githubIssueUrl ?? '')
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
    if (isInvalidGitHubIssue(githubIssue)) {
      return
    }

    const ok = await onCreateTask({
      title,
      description,
      tags: sortTaskTags(tags, taskTags),
      githubIssue: githubIssue.trim()
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
    if (isInvalidGitHubIssue(editingGithubIssue)) {
      return
    }

    const ok = await onUpdateTask({
      taskId,
      title: editingTitle,
      description: editingDescription,
      tags: sortTaskTags(editingTags, taskTags),
      githubIssue: editingGithubIssue.trim()
    })
    if (!ok) {
      return
    }

    resetEditing()
  }

  const renderGitHubIssueField = (
    id: string,
    value: string,
    onChange: (value: string) => void
  ): React.JSX.Element => {
    const invalid = isInvalidGitHubIssue(value)
    return (
      <Field label="GitHub issue">
        <div className="flex items-center gap-2">
          <TextInput
            aria-describedby={invalid ? `${id}-error` : undefined}
            aria-invalid={invalid || undefined}
            aria-label="GitHub issue"
            id={id}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://github.com/owner/repo/issues/123"
            value={value}
          />
          <Presence motion="fade" show={value.length > 0}>
            <Button
              disabled={busy}
              onClick={() => onChange('')}
              size="sm"
              title="Remove GitHub issue link"
              variant="ghost"
            >
              Clear
            </Button>
          </Presence>
        </div>
        {/* The hint and the validation error crossfade in the same place. */}
        <p
          className={`tm-fade-in mt-1.5 text-[12px] leading-5 ${invalid ? 'text-danger' : 'text-fg-subtle'}`}
          id={invalid ? `${id}-error` : undefined}
          key={invalid ? 'error' : 'hint'}
        >
          {invalid ? GITHUB_ISSUE_INPUT_HINT : 'Optional. Paste an issue URL or owner/repo#123.'}
        </p>
      </Field>
    )
  }

  const renderGitHubIssueLink = (task: ProjectTaskSnapshot): React.JSX.Element | null => {
    const issue = parseGitHubIssueReference(task.githubIssueUrl)
    if (!issue) {
      return null
    }

    const label = formatGitHubIssueReference(issue)
    return (
      <a
        aria-label={`Linked GitHub issue ${label}`}
        className="tm-task-issue"
        href={issue.url}
        rel="noreferrer"
        target="_blank"
        title={`GitHub issue ${label}\n${issue.url}\nClick to open in the browser`}
      >
        <GitHubIssueIcon aria-hidden="true" className="shrink-0" height={12} width={12} />
        <span>#{issue.number}</span>
      </a>
    )
  }

  const renderTaskSummary = (task: ProjectTaskSnapshot, meta: string): React.JSX.Element => (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        {task.number ? (
          <span className="font-mono text-[12px] text-fg-subtle" title={`Task #${task.number}`}>
            #{task.number}
          </span>
        ) : null}
        {task.title ? (
          <h4 className="text-[14px] font-medium text-fg">
            <HighlightedText query={query} text={task.title} />
          </h4>
        ) : (
          <h4 className="text-[14px] font-medium italic text-fg-subtle">Untitled task</h4>
        )}
        {sortTaskTags(task.tags, taskTags).map((tag) => (
          <span className="tm-label-chip" data-tone={getTaskTagTone(tag)} key={tag}>
            {tag}
          </span>
        ))}
        {renderGitHubIssueLink(task)}
      </div>
      {task.description ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-fg-muted">
          <HighlightedText query={query} text={task.description} />
        </p>
      ) : null}
      <p className="mt-2 text-[11.5px] text-fg-subtle">{meta}</p>
    </div>
  )

  const renderTagChecklist = (
    options: readonly ProjectTaskTag[],
    selected: readonly ProjectTaskTag[],
    onToggle: (tag: ProjectTaskTag, checked: boolean) => void
  ): React.JSX.Element => (
    <div className="tm-task-tag-list">
      <div className="tm-fade-in flex flex-col gap-2" key={options.length > 0 ? 'tags' : 'no-tags'}>
        {options.length > 0 ? (
          options.map((tag) => (
            <Checkbox
              key={tag}
              checked={selected.includes(tag)}
              disabled={busy}
              label={tag}
              onChange={(checked) => onToggle(tag, checked)}
              title={`Assign ${tag} tag`}
            />
          ))
        ) : (
          <p className="text-[12.5px] text-fg-subtle">
            No task tags configured in Settings or project settings.
          </p>
        )}
      </div>
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
        {renderTagChecklist(editTagOptions, editingTags, handleToggleEditingTag)}
      </Field>

      {renderGitHubIssueField(
        `edit-task-github-issue-${task.id}`,
        editingGithubIssue,
        setEditingGithubIssue
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11.5px] text-fg-subtle">
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
            disabled={busy || isInvalidGitHubIssue(editingGithubIssue)}
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

  const renderOpenTask = (task: ProjectTaskSnapshot, index: number): React.JSX.Element => {
    const editing = editingTaskId === task.id
    return (
      <article
        className="tm-task-card"
        data-dragging={dragState?.taskId === task.id || undefined}
        data-editing={editing || undefined}
        data-testid="project-task"
        onDragOver={index >= 0 ? (event) => handleDragOverTask(event, index) : undefined}
      >
        <Presence motion="fade" show={index >= 0 && activeDropIndex === index}>
          <div aria-hidden="true" className="tm-task-drop-line" data-edge="top" />
        </Presence>
        <Presence
          motion="fade"
          show={index >= 0 && activeDropIndex === index + 1 && index === visibleTasks.length - 1}
        >
          <div aria-hidden="true" className="tm-task-drop-line" data-edge="bottom" />
        </Presence>
        <HeightSwap swapKey={editing ? 'edit' : 'view'}>
          {editing ? (
            <div className="pl-1">{renderEditForm(task)}</div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <button
                  aria-label={`Reorder task ${task.title || 'Untitled task'}`}
                  className="tm-task-handle"
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
        </HeightSwap>
      </article>
    )
  }

  const renderCompletedTask = (task: CompletedProjectTaskSnapshot): React.JSX.Element => (
    <article className="tm-task-card" data-testid="completed-task">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span className="grid h-[22px] w-5 shrink-0 place-items-center text-positive">
            <CheckIcon aria-hidden="true" height={14} width={14} />
          </span>
          {renderTaskSummary(
            task,
            `Completed ${formatRelativeTime(task.completedAt, now)} · Added ${formatRelativeTime(task.createdAt, now)}`
          )}
        </div>
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
          <section>
            <div
              key={`header-${view}`}
              className="tm-fade-in flex items-center justify-between gap-3"
            >
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-fg">
                  {view === 'open' ? 'Open tasks' : 'Completed tasks'}
                </h3>
                <p className="mt-0.5 text-[12.5px] text-fg-subtle">{summary}</p>
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
                className="tm-fade-in relative mt-4"
                key={`list-${view}`}
                onDragOver={view === 'open' ? handleDragOverList : undefined}
                onDrop={view === 'open' ? handleDrop : undefined}
              >
                {entries.map((entry) => {
                  const exiting = entry.exitToken !== null
                  return (
                    <li
                      key={entry.key}
                      aria-hidden={exiting || undefined}
                      className={`pb-2.5 last:pb-0 ${exiting ? 'pointer-events-none' : ''}`}
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
                className="tm-task-empty tm-fade-in mt-4"
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

            <Presence motion="fade" show={view === 'completed' && remainingCompletedCount > 0}>
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
            </Presence>
          </section>

          <Presence motion="fade" show={view === 'open' && completedTasks.length > 0}>
            <div className="mt-4 flex justify-center">
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
          </Presence>
        </div>
      </div>

      <Modal
        description={
          createTagOptions.length > 0
            ? 'Add an optional title, description, tags, and GitHub issue link.'
            : 'Add an optional title, description, and GitHub issue link.'
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

          <Field label="Tags">{renderTagChecklist(createTagOptions, tags, handleToggleTag)}</Field>

          {renderGitHubIssueField('project-task-github-issue', githubIssue, setGithubIssue)}

          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleCloseCreateDialog} title="Cancel" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={busy || isInvalidGitHubIssue(githubIssue)}
              size="md"
              title="Create task"
              type="submit"
              variant="primary"
            >
              <PlusIcon width={12} height={12} strokeWidth={1.8} />
              Add task
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
