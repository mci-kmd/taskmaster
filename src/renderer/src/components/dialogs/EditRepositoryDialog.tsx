import { useState } from 'react'
import { PROJECT_ICONS, PROJECT_ICON_COLORS } from '../../../../shared/project-icons'
import { ProjectGlyph } from '../ProjectIcon'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextArea, TextInput } from '../ui/Field'
import type { RepositorySnapshot, UpdateRepositoryInput } from '../../../../shared/app-types'
import {
  GENERAL_PROJECT_DEFAULTS,
  GENERAL_PROJECT_NAME_MAX_LENGTH,
  isGeneralProject,
  normalizeGeneralProjectName
} from '../../../../shared/general-project'
import { parseTaskTagsInput } from '../../../../shared/task-tags'
import {
  DEFAULT_COMMIT_MESSAGE_MODEL,
  isSameModelSelection,
  resolveCommitMessageModel
} from '../../../../shared/commit'
import Checkbox from '../ui/Checkbox'
import CommitModelPicker from './CommitModelPicker'

type EditRepositoryDialogProps = {
  open: boolean
  repository: RepositorySnapshot | null
  busy: boolean
  removing: boolean
  /** Threads of this project whose Copilot session is currently working; blocks removal. */
  workingThreadCount: number
  onClose: () => void
  onBrowseFavicon: (repositoryId: string) => Promise<string | null>
  onBrowseSolutionFile: (repositoryId: string) => Promise<string | null>
  onSubmit: (input: UpdateRepositoryInput) => Promise<boolean>
  onRemove: (repositoryId: string) => Promise<boolean>
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function workingThreadsMessage(count: number): string {
  return `${pluralize(count, 'thread is', 'threads are')} still working. Wait for ${count === 1 ? 'it' : 'them'} to finish before removing this project.`
}

export default function EditRepositoryDialog({
  open,
  repository,
  busy,
  removing,
  workingThreadCount,
  onClose,
  onBrowseFavicon,
  onBrowseSolutionFile,
  onSubmit,
  onRemove
}: EditRepositoryDialogProps): React.JSX.Element {
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null)
  const confirmingRemoval =
    repository !== null && !isGeneralProject(repository) && confirmingRemovalId === repository.id
  const handleClose = (): void => {
    setConfirmingRemovalId(null)
    onClose()
  }

  return (
    <Modal
      description={
        !repository
          ? 'Pick a repository in the sidebar first.'
          : confirmingRemoval
            ? `${repository.name} will be removed from Taskmaster. This cannot be undone.`
            : isGeneralProject(repository)
              ? 'Configure the title and icon of the project for general computer tasks.'
              : `Configure the icon, solution file, project commands, task tags, and commit settings for ${repository.name}.`
      }
      onClose={confirmingRemoval ? () => setConfirmingRemovalId(null) : handleClose}
      open={open}
      title={confirmingRemoval ? 'Remove project?' : 'Edit project'}
      width="md"
    >
      {repository && confirmingRemoval ? (
        <RemoveRepositoryConfirmation
          onCancel={() => setConfirmingRemovalId(null)}
          onConfirm={async () => {
            const ok = await onRemove(repository.id)
            if (ok) {
              setConfirmingRemovalId(null)
            }
          }}
          removing={removing}
          repository={repository}
          workingThreadCount={workingThreadCount}
        />
      ) : null}
      {repository && isGeneralProject(repository) ? (
        <EditGeneralProjectForm
          busy={busy}
          key={`${repository.id}:${repository.name}:${repository.icon ?? ''}:${repository.iconColor ?? ''}`}
          onCancel={handleClose}
          onSubmit={async (input) => {
            const ok = await onSubmit(input)
            if (ok) {
              handleClose()
            }
          }}
          repository={repository}
        />
      ) : repository ? (
        // Kept mounted while confirming removal so unsaved edits survive a cancelled removal.
        <div hidden={confirmingRemoval}>
          <EditRepositoryForm
            busy={busy}
            key={`${repository.id}:${repository.faviconPath ?? ''}:${repository.runCommand ?? ''}:${repository.solutionFilePath ?? ''}:${repository.newWorktreeSetupCommand ?? ''}:${repository.postWorktreeRemoveCommand ?? ''}:${repository.previewUrl ?? ''}:${repository.taskTagsInput ?? ''}:${repository.commitMessageModel?.model ?? ''}:${repository.commitMessageModel?.reasoningEffort ?? ''}:${repository.autoPushAfterCommit === true}`}
            onBrowseFavicon={onBrowseFavicon}
            onBrowseSolutionFile={onBrowseSolutionFile}
            onCancel={handleClose}
            onRequestRemove={() => setConfirmingRemovalId(repository.id)}
            onSubmit={async (input) => {
              const ok = await onSubmit(input)
              if (ok) {
                handleClose()
              }
            }}
            removing={removing}
            repository={repository}
            workingThreadCount={workingThreadCount}
          />
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--color-fg-muted)]">
            Select a repository, then reopen the editor.
          </p>
          <div className="flex justify-end">
            <Button onClick={handleClose} title="Close dialog" variant="secondary">
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

type RemoveRepositoryConfirmationProps = {
  repository: RepositorySnapshot
  removing: boolean
  workingThreadCount: number
  onCancel: () => void
  onConfirm: () => Promise<void>
}

function RemoveRepositoryConfirmation({
  repository,
  removing,
  workingThreadCount,
  onCancel,
  onConfirm
}: RemoveRepositoryConfirmationProps): React.JSX.Element {
  const settledThreadCount = repository.threads.filter((thread) => thread.settledAt).length
  const activeThreadCount = repository.threads.length - settledThreadCount
  const openTaskCount = repository.tasks.length
  const completedTaskCount = repository.completedTasks?.length ?? 0
  const losses = [
    { label: 'Active threads', count: activeThreadCount },
    { label: 'Settled threads', count: settledThreadCount },
    {
      label: 'Tasks',
      count: openTaskCount + completedTaskCount,
      detail:
        completedTaskCount > 0 ? `${openTaskCount} open, ${completedTaskCount} completed` : null
    }
  ]

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-5 text-[var(--color-fg-muted)]">
        The following Taskmaster data for this project will be permanently deleted:
      </p>
      <ul
        aria-label="Data that will be lost"
        className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-[var(--color-input)]"
      >
        {losses.map((item) => (
          <li className="flex items-baseline justify-between gap-3 px-3 py-2" key={item.label}>
            <span className="text-[13px] text-[var(--color-fg)]">
              {item.label}
              {item.detail ? (
                <span className="ml-2 text-[11.5px] text-[var(--color-fg-subtle)]">
                  {item.detail}
                </span>
              ) : null}
            </span>
            <span className="font-mono text-[13px] tabular-nums text-[var(--color-fg)]">
              {item.count}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        The repository at{' '}
        <span className="font-mono text-[var(--color-fg)]">{repository.path}</span>, its branches,
        and its worktrees are left untouched.
      </p>
      {workingThreadCount > 0 ? (
        <p className="text-[12.5px] leading-5 text-[var(--color-danger)]" role="status">
          {workingThreadsMessage(workingThreadCount)}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button autoFocus onClick={onCancel} title="Keep project (Esc)" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={removing || workingThreadCount > 0}
          onClick={() => void onConfirm()}
          title="Remove project and its threads and tasks"
          variant="danger"
        >
          {removing ? 'Removing…' : 'Remove project'}
        </Button>
      </div>
    </div>
  )
}

type EditRepositoryFormProps = {
  repository: RepositorySnapshot
  busy: boolean
  removing: boolean
  workingThreadCount: number
  onCancel: () => void
  onRequestRemove: () => void
  onBrowseFavicon: (repositoryId: string) => Promise<string | null>
  onBrowseSolutionFile: (repositoryId: string) => Promise<string | null>
  onSubmit: (input: UpdateRepositoryInput) => Promise<void>
}

function EditRepositoryForm({
  repository,
  busy,
  removing,
  workingThreadCount,
  onCancel,
  onRequestRemove,
  onBrowseFavicon,
  onBrowseSolutionFile,
  onSubmit
}: EditRepositoryFormProps): React.JSX.Element {
  const [icon, setIcon] = useState(repository.icon ?? 'folder')
  const [iconColor, setIconColor] = useState(repository.iconColor ?? 'default')
  const [faviconDraft, setFaviconDraft] = useState(repository.faviconPath ?? '')
  const [runCommandDraft, setRunCommandDraft] = useState(repository.runCommand ?? '')
  const [solutionFilePathDraft, setSolutionFilePathDraft] = useState(
    repository.solutionFilePath ?? ''
  )
  const [newWorktreeSetupCommandDraft, setNewWorktreeSetupCommandDraft] = useState(
    repository.newWorktreeSetupCommand ?? ''
  )
  const [postWorktreeRemoveCommandDraft, setPostWorktreeRemoveCommandDraft] = useState(
    repository.postWorktreeRemoveCommand ?? ''
  )

  const [previewUrlDraft, setPreviewUrlDraft] = useState(repository.previewUrl ?? '')

  const [taskTagsDraft, setTaskTagsDraft] = useState(repository.taskTagsInput ?? '')
  const parsedTaskTagsPreview = parseTaskTagsInput(taskTagsDraft)

  const savedCommitModel = resolveCommitMessageModel(repository)
  const [commitModelDraft, setCommitModelDraft] = useState(savedCommitModel)
  const savedAutoPush = repository.autoPushAfterCommit === true
  const [autoPushDraft, setAutoPushDraft] = useState(savedAutoPush)

  const dirty =
    icon !== (repository.icon ?? 'folder') ||
    iconColor !== (repository.iconColor ?? 'default') ||
    faviconDraft !== (repository.faviconPath ?? '') ||
    runCommandDraft !== (repository.runCommand ?? '') ||
    solutionFilePathDraft !== (repository.solutionFilePath ?? '') ||
    newWorktreeSetupCommandDraft !== (repository.newWorktreeSetupCommand ?? '') ||
    postWorktreeRemoveCommandDraft !== (repository.postWorktreeRemoveCommand ?? '') ||
    previewUrlDraft !== (repository.previewUrl ?? '') ||
    taskTagsDraft !== (repository.taskTagsInput ?? '') ||
    !isSameModelSelection(commitModelDraft, savedCommitModel) ||
    autoPushDraft !== savedAutoPush

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && dirty) {
          void onSubmit({
            icon,
            iconColor,
            repositoryId: repository.id,
            faviconPath: faviconDraft.trim() || null,
            runCommand: runCommandDraft.trim() || null,
            solutionFilePath: solutionFilePathDraft.trim() || null,
            newWorktreeSetupCommand: newWorktreeSetupCommandDraft.trim() || null,
            postWorktreeRemoveCommand: postWorktreeRemoveCommandDraft.trim() || null,
            previewUrl: previewUrlDraft.trim() || null,
            taskTagsInput: taskTagsDraft,
            commitMessageModel: isSameModelSelection(commitModelDraft, DEFAULT_COMMIT_MESSAGE_MODEL)
              ? null
              : commitModelDraft,
            autoPushAfterCommit: autoPushDraft
          })
        }
      }}
    >
      <Field label="Project icon" hint="Used when no custom favicon is available.">
        <ProjectIconPicker
          icon={icon}
          iconColor={iconColor}
          onIconChange={setIcon}
          onIconColorChange={setIconColor}
        />
      </Field>
      <Field
        hint={`Use Browse to pick a file, or paste a relative path manually. Stored relative to ${repository.name}'s repo root so the same path works in worktrees too.`}
        label="Application favicon path"
      >
        <div className="flex items-center gap-2">
          <TextInput
            autoFocus
            className="min-w-0 flex-1"
            onChange={(event) => setFaviconDraft(event.target.value)}
            placeholder="app\\public\\favicon.ico"
            value={faviconDraft}
          />
          <Button
            disabled={busy}
            onClick={async () => {
              const nextPath = await onBrowseFavicon(repository.id)
              if (nextPath) {
                setFaviconDraft(nextPath)
              }
            }}
            title="Browse for a favicon file"
            type="button"
            variant="secondary"
          >
            Browse…
          </Button>
        </div>
      </Field>

      <Field
        hint="Runs in the selected thread's working directory. Use {BRANCH-NAME} for the raw branch name, {BRANCH-NAME-SAFE} for a lowercased Docker-safe variant, or {BRANCH-PORT} for a deterministic pseudo-random port for this repo + branch."
        label="Run command"
      >
        <TextArea
          className="min-w-0 w-full"
          onChange={(event) => setRunCommandDraft(event.target.value)}
          placeholder={'bun install\nbun run dev'}
          rows={5}
          spellCheck={false}
          value={runCommandDraft}
        />
      </Field>

      <Field
        hint="Optional. Set this if the run command serves a website to enable the Preview view, where you can browse the app and pick elements to comment on. Available while the run command is running. Supports the same tokens as the run command."
        label="Preview URL"
      >
        <TextInput
          className="min-w-0 w-full"
          onChange={(event) => setPreviewUrlDraft(event.target.value)}
          placeholder="http://localhost:{BRANCH-PORT}"
          spellCheck={false}
          value={previewUrlDraft}
        />
      </Field>

      <Field
        hint={`Use Browse to pick a .sln or .slnx file, or paste a relative path manually. Stored relative to ${repository.name}'s repo root so the same solution opens from worktrees too.`}
        label="Visual Studio solution file"
      >
        <div className="flex items-center gap-2">
          <TextInput
            className="min-w-0 flex-1"
            onChange={(event) => setSolutionFilePathDraft(event.target.value)}
            placeholder="src\\MyApp.slnx"
            spellCheck={false}
            value={solutionFilePathDraft}
          />
          <Button
            disabled={busy}
            onClick={async () => {
              const nextPath = await onBrowseSolutionFile(repository.id)
              if (nextPath) {
                setSolutionFilePathDraft(nextPath)
              }
            }}
            title="Browse for a solution file"
            type="button"
            variant="secondary"
          >
            Browse…
          </Button>
        </div>
      </Field>

      <Field
        hint="Optional. Runs in the new worktree after its branch and worktree are created. Supports the same tokens as the run command."
        label="New worktree setup script"
      >
        <TextArea
          className="min-w-0 w-full"
          onChange={(event) => setNewWorktreeSetupCommandDraft(event.target.value)}
          placeholder={'bun install\ncp .env.example .env'}
          rows={4}
          spellCheck={false}
          value={newWorktreeSetupCommandDraft}
        />
      </Field>

      <Field
        hint="Optional. Runs in the repository root after an owned worktree thread is closed and its branch is deleted. Settling a thread never runs this script. Supports the same tokens as the run command."
        label="Post-worktree-remove script"
      >
        <TextArea
          className="min-w-0 w-full"
          onChange={(event) => setPostWorktreeRemoveCommandDraft(event.target.value)}
          placeholder={'docker volume rm myapp-{BRANCH-NAME-SAFE}-sql'}
          rows={4}
          spellCheck={false}
          value={postWorktreeRemoveCommandDraft}
        />
      </Field>

      <Field
        hint="Optional. Comma- or newline-separated labels for this project's tasks, offered in addition to the global task tags from Settings."
        label="Project task tags"
      >
        <TextArea
          className="min-w-0 w-full"
          onChange={(event) => setTaskTagsDraft(event.target.value)}
          placeholder={'backend\nui'}
          rows={3}
          spellCheck={false}
          value={taskTagsDraft}
        />
        {parsedTaskTagsPreview.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {parsedTaskTagsPreview.map((tag) => (
              <span
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-[11.5px] text-[var(--color-fg)]"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </Field>

      <Field
        hint="Model Copilot uses to write messages for the commit button in Copilot threads (Ctrl+S)."
        label="Commit message model"
      >
        <CommitModelPicker
          disabled={busy}
          onChange={setCommitModelDraft}
          value={commitModelDraft}
        />
        <div className="mt-2.5">
          <Checkbox
            checked={autoPushDraft}
            disabled={busy}
            label="Push to the remote after committing"
            onChange={setAutoPushDraft}
            title="Run git push after each AI commit"
          />
        </div>
      </Field>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        Repository root: <span className="font-mono text-[var(--color-fg)]">{repository.path}</span>
      </div>

      <section
        aria-label="Remove project"
        className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5"
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[var(--color-fg)]">Remove project</p>
          <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-fg-muted)]">
            {workingThreadCount > 0
              ? workingThreadsMessage(workingThreadCount)
              : "Deletes this project's threads and tasks from Taskmaster. The repository is not touched."}
          </p>
        </div>
        <Button
          className="shrink-0"
          disabled={busy || removing || workingThreadCount > 0}
          onClick={onRequestRemove}
          title={
            workingThreadCount > 0
              ? 'Unavailable while threads are working'
              : 'Remove this project from Taskmaster'
          }
          type="button"
          variant="danger"
        >
          Remove…
        </Button>
      </section>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            disabled={
              busy ||
              (icon === 'folder' &&
                iconColor === 'default' &&
                faviconDraft.length === 0 &&
                runCommandDraft.length === 0 &&
                solutionFilePathDraft.length === 0 &&
                newWorktreeSetupCommandDraft.length === 0 &&
                postWorktreeRemoveCommandDraft.length === 0 &&
                previewUrlDraft.length === 0 &&
                taskTagsDraft.length === 0 &&
                isSameModelSelection(commitModelDraft, DEFAULT_COMMIT_MESSAGE_MODEL) &&
                !autoPushDraft)
            }
            onClick={() => {
              setIcon('folder')
              setIconColor('default')
              setFaviconDraft('')
              setRunCommandDraft('')
              setSolutionFilePathDraft('')
              setNewWorktreeSetupCommandDraft('')
              setPostWorktreeRemoveCommandDraft('')
              setPreviewUrlDraft('')
              setTaskTagsDraft('')
              setCommitModelDraft(DEFAULT_COMMIT_MESSAGE_MODEL)
              setAutoPushDraft(false)
            }}
            title="Clear project fields"
            type="button"
            variant="ghost"
          >
            Clear fields
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={busy || !dirty}
            title="Save project settings"
            type="submit"
            variant="primary"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  )
}

type ProjectIconPickerProps = {
  icon: string
  iconColor: string
  onIconChange: (icon: string) => void
  onIconColorChange: (iconColor: string) => void
}

function ProjectIconPicker({
  icon,
  iconColor,
  onIconChange,
  onIconColorChange
}: ProjectIconPickerProps): React.JSX.Element {
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Project icon">
        {PROJECT_ICONS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.label}
            aria-pressed={icon === item.id}
            title={item.label}
            onClick={() => onIconChange(item.id)}
            className={`grid size-8 place-items-center rounded-md border ${icon === item.id ? 'border-[var(--color-fg-muted)] bg-[var(--color-active)]' : 'border-[var(--color-border)] hover:bg-[var(--color-hover)]'}`}
          >
            <ProjectGlyph icon={item.id} color={iconColor} />
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Project icon color">
        {PROJECT_ICON_COLORS.map((item) => (
          <button
            type="button"
            key={item.value}
            aria-label={item.label}
            aria-pressed={iconColor === item.value}
            title={item.label}
            onClick={() => onIconColorChange(item.value)}
            className={`grid size-6 place-items-center rounded-full border ${iconColor === item.value ? 'border-[var(--color-fg)]' : 'border-transparent'}`}
          >
            <span
              className="size-3.5 rounded-full"
              style={{
                backgroundColor: item.value === 'default' ? 'var(--color-fg-subtle)' : item.value
              }}
            />
          </button>
        ))}
      </div>
    </>
  )
}

type EditGeneralProjectFormProps = {
  repository: RepositorySnapshot
  busy: boolean
  onCancel: () => void
  onSubmit: (input: UpdateRepositoryInput) => Promise<void>
}

function EditGeneralProjectForm({
  repository,
  busy,
  onCancel,
  onSubmit
}: EditGeneralProjectFormProps): React.JSX.Element {
  const initialIcon = repository.icon ?? GENERAL_PROJECT_DEFAULTS.icon
  const initialIconColor = repository.iconColor ?? GENERAL_PROJECT_DEFAULTS.iconColor
  const [nameDraft, setNameDraft] = useState<string>(repository.name)
  const [icon, setIcon] = useState<string>(initialIcon)
  const [iconColor, setIconColor] = useState<string>(initialIconColor)
  const name = normalizeGeneralProjectName(nameDraft)
  const dirty =
    nameDraft !== repository.name || icon !== initialIcon || iconColor !== initialIconColor
  const isDefault =
    nameDraft === GENERAL_PROJECT_DEFAULTS.name &&
    icon === GENERAL_PROJECT_DEFAULTS.icon &&
    iconColor === GENERAL_PROJECT_DEFAULTS.iconColor

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && dirty && name) {
          void onSubmit({
            repositoryId: repository.id,
            name,
            icon,
            iconColor,
            faviconPath: null,
            runCommand: null,
            solutionFilePath: null,
            newWorktreeSetupCommand: null,
            postWorktreeRemoveCommand: null
          })
        }
      }}
    >
      <Field label="Project title" hint="Shown in the sidebar and project picker.">
        <TextInput
          autoFocus
          aria-label="Project title"
          className="min-w-0 w-full"
          maxLength={GENERAL_PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setNameDraft(event.target.value)}
          placeholder={GENERAL_PROJECT_DEFAULTS.name}
          value={nameDraft}
        />
      </Field>

      <Field label="Project icon">
        <ProjectIconPicker
          icon={icon}
          iconColor={iconColor}
          onIconChange={setIcon}
          onIconColorChange={setIconColor}
        />
      </Field>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        Sessions run in: <span className="font-mono text-[var(--color-fg)]">{repository.path}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          disabled={busy || isDefault}
          onClick={() => {
            setNameDraft(GENERAL_PROJECT_DEFAULTS.name)
            setIcon(GENERAL_PROJECT_DEFAULTS.icon)
            setIconColor(GENERAL_PROJECT_DEFAULTS.iconColor)
          }}
          title="Reset title and icon to defaults"
          type="button"
          variant="ghost"
        >
          Reset to defaults
        </Button>

        <div className="flex items-center gap-2">
          <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={busy || !dirty || !name}
            title="Save project settings"
            type="submit"
            variant="primary"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  )
}
