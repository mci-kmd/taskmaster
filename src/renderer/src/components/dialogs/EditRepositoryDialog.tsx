import { useState } from 'react'
import { PROJECT_ICONS, PROJECT_ICON_COLORS } from '../../../../shared/project-icons'
import { ProjectGlyph } from '../ProjectIcon'
import Modal from '../Modal'
import Button from '../ui/Button'
import Presence from '../ui/Presence'
import type {
  CopilotModelSelection,
  RepositorySnapshot,
  UpdateRepositoryInput
} from '../../../../shared/app-types'
import {
  GENERAL_PROJECT_DEFAULTS,
  GENERAL_PROJECT_NAME_MAX_LENGTH,
  isGeneralProject,
  normalizeGeneralProjectName
} from '../../../../shared/general-project'
import { parseTaskTagsInput } from '../../../../shared/task-tags'
import {
  COMMIT_SHORTCUT_LABEL,
  DEFAULT_COMMIT_MESSAGE_MODEL,
  isSameModelSelection,
  resolveCommitMessageModel
} from '../../../../shared/commit'
import {
  CheckboxSetting,
  SaveStatus,
  SettingRow,
  SettingsLayout,
  SettingsSectionBody,
  TagPreview,
  TextAreaSetting,
  TextSetting,
  Token,
  type SettingsSection
} from '../settings/SettingsLayout'
import { useAutoSave, type AutoSaveField, type AutoSaveResult } from '../settings/use-auto-save'
import CommitModelPicker from './CommitModelPicker'
import { useDialogSession, useOpenValue } from './use-dialog-session'

type EditRepositoryDialogProps = {
  open: boolean
  repository: RepositorySnapshot | null
  removing: boolean
  /** Threads of this project whose Copilot session is currently working; blocks removal. */
  workingThreadCount: number
  onClose: () => void
  onBrowseFavicon: (repositoryId: string) => Promise<string | null>
  onBrowseSolutionFile: (repositoryId: string) => Promise<string | null>
  /** Persists the project's settings; called automatically as settings change. */
  onSave: (input: UpdateRepositoryInput) => Promise<AutoSaveResult>
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
  repository: currentRepository,
  onClose,
  ...props
}: EditRepositoryDialogProps): React.JSX.Element | null {
  // Settings stay mounted while the dialog animates out; each opening remounts them, so their
  // drafts reset every time the dialog opens.
  const session = useDialogSession(open)
  const repository = useOpenValue(currentRepository, open)
  if (!session.mounted) {
    return null
  }

  if (!repository) {
    return (
      <Modal
        description="Pick a repository in the sidebar first."
        onClose={onClose}
        open={open}
        title="Edit project"
      >
        <div className="space-y-5">
          <p className="text-[13px] text-fg-muted">Select a repository, then reopen the editor.</p>
          <div className="flex justify-end">
            <Button onClick={onClose} title="Close dialog" variant="secondary">
              Close
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  const key = `${repository.id}:${session.key}`
  return isGeneralProject(repository) ? (
    <GeneralProjectSettings
      key={key}
      onClose={onClose}
      onSave={props.onSave}
      open={open}
      repository={repository}
    />
  ) : (
    <RepositorySettings
      key={key}
      onClose={onClose}
      open={open}
      repository={repository}
      {...props}
    />
  )
}

type RepositoryValues = {
  icon: string
  iconColor: string
  faviconPath: string
  solutionFilePath: string
  runCommand: string
  previewUrl: string
  newWorktreeSetupCommand: string
  postWorktreeRemoveCommand: string
  taskTagsInput: string
  commitMessageModel: CopilotModelSelection
  autoPushAfterCommit: boolean
}

function repositoryValues(repository: RepositorySnapshot): RepositoryValues {
  return {
    icon: repository.icon ?? 'folder',
    iconColor: repository.iconColor ?? 'default',
    faviconPath: repository.faviconPath ?? '',
    solutionFilePath: repository.solutionFilePath ?? '',
    runCommand: repository.runCommand ?? '',
    previewUrl: repository.previewUrl ?? '',
    newWorktreeSetupCommand: repository.newWorktreeSetupCommand ?? '',
    postWorktreeRemoveCommand: repository.postWorktreeRemoveCommand ?? '',
    taskTagsInput: repository.taskTagsInput ?? '',
    commitMessageModel: resolveCommitMessageModel(repository),
    autoPushAfterCommit: repository.autoPushAfterCommit === true
  }
}

function toUpdateInput(repositoryId: string, values: RepositoryValues): UpdateRepositoryInput {
  return {
    repositoryId,
    icon: values.icon,
    iconColor: values.iconColor,
    faviconPath: values.faviconPath.trim() || null,
    solutionFilePath: values.solutionFilePath.trim() || null,
    runCommand: values.runCommand.trim() || null,
    previewUrl: values.previewUrl.trim() || null,
    newWorktreeSetupCommand: values.newWorktreeSetupCommand.trim() || null,
    postWorktreeRemoveCommand: values.postWorktreeRemoveCommand.trim() || null,
    taskTagsInput: values.taskTagsInput,
    // Null restores the default, so later changes to the default apply to this project.
    commitMessageModel: isSameModelSelection(
      values.commitMessageModel,
      DEFAULT_COMMIT_MESSAGE_MODEL
    )
      ? null
      : values.commitMessageModel,
    autoPushAfterCommit: values.autoPushAfterCommit
  }
}

type RepositorySettingsProps = Omit<EditRepositoryDialogProps, 'repository'> & {
  repository: RepositorySnapshot
}

function RepositorySettings({
  open,
  repository,
  removing,
  workingThreadCount,
  onClose,
  onBrowseFavicon,
  onBrowseSolutionFile,
  onSave,
  onRemove
}: RepositorySettingsProps): React.JSX.Element {
  const [sectionId, setSectionId] = useState('general')
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const form = useAutoSave<RepositoryValues>({
    initialValues: repositoryValues(repository),
    save: (values) => onSave(toUpdateInput(repository.id, values))
  })
  const { values } = form
  const icon = form.field('icon')
  const iconColor = form.field('iconColor')
  const commitModel = form.field('commitMessageModel')

  const close = (): void => {
    void form.flush()
    onClose()
  }

  const browseButton = (
    title: string,
    browse: (repositoryId: string) => Promise<string | null>,
    field: AutoSaveField<string>
  ): React.JSX.Element => (
    <Button
      aria-label={title}
      className="shrink-0"
      onClick={async () => {
        const nextPath = await browse(repository.id)
        if (nextPath) field.set(nextPath)
      }}
      title={title}
      variant="secondary"
    >
      Browse…
    </Button>
  )

  const sections: SettingsSection[] = [
    {
      id: 'general',
      label: 'General',
      hasError: form.hasErrors(['icon', 'iconColor', 'faviconPath', 'solutionFilePath']),
      content: (
        <>
          <SettingRow
            hint="Shown when the project has no favicon."
            label="Icon"
            status={icon.status.state !== 'idle' ? icon.status : iconColor.status}
          >
            <ProjectIconPicker
              icon={icon.value}
              iconColor={iconColor.value}
              onIconChange={icon.set}
              onIconColorChange={iconColor.set}
            />
          </SettingRow>
          <TextSetting
            action={browseButton(
              'Browse for a favicon file',
              onBrowseFavicon,
              form.field('faviconPath')
            )}
            field={form.field('faviconPath')}
            hint="Relative to the repository root, so it also works in worktrees."
            label="Favicon"
            placeholder="app\public\favicon.ico"
          />
          <TextSetting
            action={browseButton(
              'Browse for a solution file',
              onBrowseSolutionFile,
              form.field('solutionFilePath')
            )}
            field={form.field('solutionFilePath')}
            hint="A .sln or .slnx file relative to the repository root, opened from worktrees too."
            label="Visual Studio solution"
            placeholder="src\MyApp.slnx"
          />
          <SettingRow label="Location">
            <p className="break-all py-0.5 font-mono text-[12px] leading-5 text-fg-muted">
              {repository.path}
            </p>
          </SettingRow>
        </>
      )
    },
    {
      id: 'run',
      label: 'Run & preview',
      description:
        "Start the project from a thread's working directory and browse it beside the conversation.",
      hasError: form.hasErrors(['runCommand', 'previewUrl']),
      content: (
        <>
          <TextAreaSetting
            field={form.field('runCommand')}
            hint={
              <>
                Runs in the thread&apos;s working directory. <Token>{'{BRANCH-NAME}'}</Token> is the
                branch name, <Token>{'{BRANCH-NAME-SAFE}'}</Token> a lowercased Docker-safe variant
                and <Token>{'{BRANCH-PORT}'}</Token> a stable port for this repository and branch.
              </>
            }
            label="Run command"
            placeholder={'bun install\nbun run dev'}
            rows={4}
          />
          <TextSetting
            field={form.field('previewUrl')}
            hint="Enables the Preview view while the run command runs, for browsing the app and commenting on elements. Supports the same tokens."
            label="Preview URL"
            placeholder="http://localhost:{BRANCH-PORT}"
          />
        </>
      )
    },
    {
      id: 'worktrees',
      label: 'Worktrees',
      description:
        "Optional scripts for worktree-backed threads. Both support the run command's tokens.",
      hasError: form.hasErrors(['newWorktreeSetupCommand', 'postWorktreeRemoveCommand']),
      content: (
        <>
          <TextAreaSetting
            field={form.field('newWorktreeSetupCommand')}
            hint="Runs in a new worktree once its branch and worktree are created."
            label="Setup script"
            placeholder={'bun install\ncp .env.example .env'}
          />
          <TextAreaSetting
            field={form.field('postWorktreeRemoveCommand')}
            hint="Runs in the repository root after an owned worktree thread is closed and its branch deleted. Settling a thread never runs it."
            label="Cleanup script"
            placeholder="docker volume rm myapp-{BRANCH-NAME-SAFE}-sql"
          />
        </>
      )
    },
    {
      id: 'tasks',
      label: 'Tasks',
      hasError: form.hasErrors(['taskTagsInput']),
      content: (
        <TextAreaSetting
          field={form.field('taskTagsInput')}
          hint="Comma- or newline-separated labels for this project's tasks, offered alongside the global task tags from Settings."
          label="Project task tags"
          placeholder={'backend\nui'}
          rows={3}
        >
          <TagPreview tags={parseTaskTagsInput(values.taskTagsInput)} />
        </TextAreaSetting>
      )
    },
    {
      id: 'commits',
      label: 'Commits',
      description: `For the commit button in Copilot threads (${COMMIT_SHORTCUT_LABEL}).`,
      hasError: form.hasErrors(['commitMessageModel', 'autoPushAfterCommit']),
      content: (
        <>
          <SettingRow
            hint="Model and reasoning effort Copilot uses to write commit messages."
            label="Message model"
            status={commitModel.status}
          >
            <CommitModelPicker
              disabled={false}
              onChange={commitModel.set}
              value={commitModel.value}
            />
            <Presence
              motion="fade"
              show={!isSameModelSelection(commitModel.value, DEFAULT_COMMIT_MESSAGE_MODEL)}
            >
              <button
                className="tm-quiet-link mt-1.5"
                onClick={() => commitModel.set(DEFAULT_COMMIT_MESSAGE_MODEL)}
                type="button"
              >
                Reset to default
              </button>
            </Presence>
          </SettingRow>
          <CheckboxSetting
            checkboxLabel="Push to the remote after committing"
            field={form.field('autoPushAfterCommit')}
            hint="Runs git push after each AI commit."
            label="Push"
          />
        </>
      )
    },
    {
      id: 'danger',
      label: 'Danger zone',
      tone: 'danger',
      content: (
        <section aria-label="Remove project" className="tm-danger-zone">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">Remove project</p>
            <p className="mt-0.5 text-[12px] leading-[18px] text-fg-muted">
              {workingThreadCount > 0
                ? workingThreadsMessage(workingThreadCount)
                : "Deletes this project's threads and tasks from Taskmaster. The repository is not touched."}
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={removing || workingThreadCount > 0}
            onClick={() => {
              void form.flush()
              setConfirmingRemoval(true)
            }}
            title={
              workingThreadCount > 0
                ? 'Unavailable while threads are working'
                : 'Remove this project from Taskmaster'
            }
            variant="danger"
          >
            Remove…
          </Button>
        </section>
      )
    }
  ]

  // The editor and the confirmation are two dialogs: one pops out as the other pops in.
  return (
    <>
      <Modal
        description={`Settings for ${repository.name}.`}
        fill
        headerExtra={<SaveStatus errorCount={form.errorCount} status={form.status} />}
        onClose={close}
        open={open && !confirmingRemoval}
        title="Edit project"
        width="xl"
      >
        <SettingsLayout
          activeId={sectionId}
          label="Project settings sections"
          onActiveChange={setSectionId}
          sections={sections}
        />
      </Modal>
      <Modal
        description={`${repository.name} will be removed from Taskmaster. This cannot be undone.`}
        onClose={() => setConfirmingRemoval(false)}
        open={open && confirmingRemoval}
        title="Remove project?"
      >
        <RemoveRepositoryConfirmation
          onCancel={() => setConfirmingRemoval(false)}
          onConfirm={async () => {
            const ok = await onRemove(repository.id)
            if (ok) setConfirmingRemoval(false)
          }}
          removing={removing}
          repository={repository}
          workingThreadCount={workingThreadCount}
        />
      </Modal>
    </>
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
      <p className="text-[13px] leading-5 text-fg-muted">
        The following Taskmaster data for this project will be permanently deleted:
      </p>
      <ul
        aria-label="Data that will be lost"
        className="divide-y divide-border rounded-lg border border-border bg-surface"
      >
        {losses.map((item) => (
          <li className="flex items-baseline justify-between gap-3 px-3 py-2" key={item.label}>
            <span className="text-[13px] text-fg">
              {item.label}
              {item.detail ? (
                <span className="ml-2 text-[11.5px] text-fg-subtle">{item.detail}</span>
              ) : null}
            </span>
            <span className="font-mono text-[13px] tabular-nums text-fg">{item.count}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] leading-5 text-fg-muted">
        The repository at <span className="font-mono text-fg">{repository.path}</span>, its
        branches, and its worktrees are left untouched.
      </p>
      <Presence motion="collapse" show={workingThreadCount > 0}>
        <p className="text-[12.5px] leading-5 text-danger" role="status">
          {workingThreadsMessage(workingThreadCount)}
        </p>
      </Presence>
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
      <div aria-label="Project icon" className="flex flex-wrap gap-1.5" role="group">
        {PROJECT_ICONS.map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={icon === item.id}
            className="tm-choice-tile"
            key={item.id}
            onClick={() => onIconChange(item.id)}
            title={item.label}
            type="button"
          >
            <ProjectGlyph color={iconColor} icon={item.id} />
          </button>
        ))}
      </div>
      <div aria-label="Project icon color" className="mt-3 flex flex-wrap gap-1.5" role="group">
        {PROJECT_ICON_COLORS.map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={iconColor === item.value}
            className="tm-choice-tile"
            data-shape="swatch"
            key={item.value}
            onClick={() => onIconColorChange(item.value)}
            title={item.label}
            type="button"
          >
            <span className="tm-choice-tile__swatch" style={{ backgroundColor: item.css }} />
          </button>
        ))}
      </div>
    </>
  )
}

type GeneralProjectValues = { name: string; icon: string; iconColor: string }

function GeneralProjectSettings({
  open,
  repository,
  onClose,
  onSave
}: {
  open: boolean
  repository: RepositorySnapshot
  onClose: () => void
  onSave: (input: UpdateRepositoryInput) => Promise<AutoSaveResult>
}): React.JSX.Element {
  const form = useAutoSave<GeneralProjectValues>({
    initialValues: {
      name: repository.name,
      icon: repository.icon ?? GENERAL_PROJECT_DEFAULTS.icon,
      iconColor: repository.iconColor ?? GENERAL_PROJECT_DEFAULTS.iconColor
    },
    save: async (values) => {
      const name = normalizeGeneralProjectName(values.name)
      if (!name) {
        return { ok: false, error: 'Enter a project title.' }
      }
      return onSave({
        repositoryId: repository.id,
        name,
        icon: values.icon,
        iconColor: values.iconColor,
        faviconPath: null,
        runCommand: null,
        solutionFilePath: null,
        newWorktreeSetupCommand: null,
        postWorktreeRemoveCommand: null
      })
    }
  })
  const name = form.field('name')
  const icon = form.field('icon')
  const iconColor = form.field('iconColor')
  const isDefault =
    name.value === GENERAL_PROJECT_DEFAULTS.name &&
    icon.value === GENERAL_PROJECT_DEFAULTS.icon &&
    iconColor.value === GENERAL_PROJECT_DEFAULTS.iconColor

  const close = (): void => {
    void form.flush()
    onClose()
  }

  return (
    <Modal
      description="The project for general computer tasks."
      headerExtra={<SaveStatus errorCount={form.errorCount} status={form.status} />}
      onClose={close}
      open={open}
      title="Edit project"
      width="lg"
    >
      <SettingsSectionBody
        section={{
          label: 'General',
          content: (
            <>
              <TextSetting
                autoFocus
                field={name}
                hint="Shown in the sidebar and project picker."
                label="Project title"
                maxLength={GENERAL_PROJECT_NAME_MAX_LENGTH}
                placeholder={GENERAL_PROJECT_DEFAULTS.name}
              />
              <SettingRow
                label="Icon"
                status={icon.status.state !== 'idle' ? icon.status : iconColor.status}
              >
                <ProjectIconPicker
                  icon={icon.value}
                  iconColor={iconColor.value}
                  onIconChange={icon.set}
                  onIconColorChange={iconColor.set}
                />
              </SettingRow>
              <SettingRow label="Sessions run in">
                <p className="break-all py-0.5 font-mono text-[12px] leading-5 text-fg-muted">
                  {repository.path}
                </p>
              </SettingRow>
            </>
          )
        }}
        showHeading={false}
      />
      <div className="mt-2 flex justify-end">
        <Button
          disabled={isDefault}
          onClick={() => {
            name.set(GENERAL_PROJECT_DEFAULTS.name)
            icon.set(GENERAL_PROJECT_DEFAULTS.icon)
            iconColor.set(GENERAL_PROJECT_DEFAULTS.iconColor)
          }}
          size="sm"
          title="Reset title and icon to defaults"
          variant="ghost"
        >
          Reset to defaults
        </Button>
      </div>
    </Modal>
  )
}
