import { useState, type FormEvent } from 'react'
import {
  PROJECT_TASK_TAGS,
  type CreateRepositoryTaskInput,
  type ProjectTaskSnapshot,
  type ProjectTaskTag,
  type RepositorySnapshot,
  type UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import { formatRelativeTime } from '../lib/time'
import { useNow } from '../lib/useNow'
import Modal from './Modal'
import Button from './ui/Button'
import Checkbox from './ui/Checkbox'
import { Field, TextArea, TextInput } from './ui/Field'
import { PlusIcon } from './Icons'

type ProjectTaskManagerProps = {
  repository: RepositorySnapshot
  busy: boolean
  onCreateTask: (input: Omit<CreateRepositoryTaskInput, 'repositoryId'>) => Promise<boolean>
  onCompleteTask: (taskId: string) => Promise<void>
  onUpdateTask: (input: Omit<UpdateRepositoryTaskInput, 'repositoryId'>) => Promise<boolean>
}

function formatTagLabel(tag: ProjectTaskTag): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1)
}

function sortTaskTags(tags: readonly ProjectTaskTag[]): ProjectTaskTag[] {
  return PROJECT_TASK_TAGS.filter((tag) => tags.includes(tag))
}

function getTagTone(tag: ProjectTaskTag): string {
  return tag === 'bug'
    ? 'border-[rgba(240,140,140,0.35)] bg-[rgba(240,140,140,0.1)] text-[var(--color-danger)]'
    : 'border-[rgba(158,197,255,0.35)] bg-[rgba(158,197,255,0.1)] text-[var(--color-info)]'
}

export default function ProjectTaskManager({
  repository,
  busy,
  onCreateTask,
  onCompleteTask,
  onUpdateTask
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
    setEditingTags(sortTaskTags(task.tags))
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
      tags: sortTaskTags(tags)
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
      tags: sortTaskTags(editingTags)
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
                  {repository.tasks.length} {repository.tasks.length === 1 ? 'task' : 'tasks'}
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

            {repository.tasks.length > 0 ? (
              <div className="mt-4 space-y-3">
                {repository.tasks.map((task) => (
                  <article
                    key={task.id}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3"
                  >
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
                            {PROJECT_TASK_TAGS.map((tag) => (
                              <Checkbox
                                key={tag}
                                checked={editingTags.includes(tag)}
                                disabled={busy}
                                label={formatTagLabel(tag)}
                                onChange={(checked) => handleToggleEditingTag(tag, checked)}
                                title={`Assign ${tag} tag`}
                              />
                            ))}
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
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-[14px] font-medium text-[var(--color-fg)]">
                              {task.title}
                            </h4>
                            {sortTaskTags(task.tags).map((tag) => (
                              <span
                                key={tag}
                                className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.14em] ${getTagTone(tag)}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-fg-muted)]">
                            {task.description}
                          </p>
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
        description="Add a title, description, and optional bug/feature tags."
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
              {PROJECT_TASK_TAGS.map((tag) => (
                <Checkbox
                  key={tag}
                  checked={tags.includes(tag)}
                  disabled={busy}
                  label={formatTagLabel(tag)}
                  onChange={(checked) => handleToggleTag(tag, checked)}
                  title={`Assign ${tag} tag`}
                />
              ))}
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
