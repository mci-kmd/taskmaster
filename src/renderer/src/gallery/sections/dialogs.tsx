import { useState } from 'react'
import EditRepositoryDialog from '../../components/dialogs/EditRepositoryDialog'
import EditThreadDialog from '../../components/dialogs/EditThreadDialog'
import NewThreadDialog from '../../components/dialogs/NewThreadDialog'
import SettingsDialog from '../../components/dialogs/SettingsDialog'
import {
  CheckboxSetting,
  SaveStatus,
  SettingRow,
  SettingsLayout,
  TagPreview,
  TextAreaSetting,
  TextSetting,
  type SettingsSection
} from '../../components/settings/SettingsLayout'
import ThemePicker from '../../components/settings/ThemePicker'
import type { AutoSaveField, AutoSaveFieldStatus } from '../../components/settings/use-auto-save'
import Button from '../../components/ui/Button'
import type {
  AppSettingsSnapshot,
  RepositorySnapshot,
  ThreadSnapshot
} from '../../../../shared/app-types'
import type { ThemeId } from '../../../../shared/themes'
import type { GallerySection } from '../gallery-section'

const settings: AppSettingsSnapshot = {
  yoloEnabled: true,
  terminalFontFamilyInput: '',
  resolvedTerminalFontFamily: "'CaskaydiaCove Nerd Font Mono', Consolas, monospace",
  taskTagsInput: 'bug\nfeature\ndocs',
  parsedTaskTags: ['bug', 'feature', 'docs'],
  legacyCopilotModels: []
}

function thread(id: string, extra: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    id,
    repositoryId: 'taskmaster',
    latestCopilotTitle: 'Restyle the settings dialog',
    lastUserMessage: null,
    resumeSessionId: null,
    mode: 'worktree',
    projectKind: 'repository',
    branchName: 'feature/settings-redesign',
    worktreePath: '/code/taskmaster/.worktrees/settings-redesign',
    createdAt: '2026-10-01T10:00:00.000Z',
    executionCwd: '/code/taskmaster',
    backend: { kind: 'native' },
    isRunCommandRunning: false,
    commitPhase: null,
    previewUrl: null,
    commitAutoPush: false,
    customTitle: 'Settings',
    displayTitle: 'Settings',
    lastActivityAt: '2026-10-01T10:00:00.000Z',
    displayBranchName: 'feature/settings-redesign',
    cwd: '/code/taskmaster',
    ...extra
  }
}

const repository: RepositorySnapshot = {
  id: 'taskmaster',
  name: 'taskmaster',
  path: '/home/me/code/taskmaster',
  threads: [thread('a'), thread('b'), thread('c', { settledAt: '2026-10-02T10:00:00.000Z' })],
  backend: { kind: 'native' },
  icon: 'code',
  iconColor: 'default',
  faviconPath: null,
  runCommand: 'bun run dev',
  solutionFilePath: null,
  previewUrl: 'http://localhost:{BRANCH-PORT}',
  newWorktreeSetupCommand: 'bun install',
  postWorktreeRemoveCommand: null,
  taskTagsInput: 'ui\nbackend',
  addedAt: '2026-01-01',
  lastActivityAt: '2026-10-01',
  tasks: [],
  completedTasks: [],
  currentBranch: 'feature/settings-redesign',
  primaryBranch: 'main',
  branchOptions: [
    { value: 'main', kind: 'local', label: 'local' },
    { value: 'feature/theme-picker', kind: 'remote', label: 'origin' }
  ],
  worktreeOptions: [
    { branchName: 'feature/settings-redesign', path: '/code/taskmaster/.worktrees/settings' }
  ],
  faviconUrl: null
}

const generalProject: RepositorySnapshot = {
  ...repository,
  id: 'computer',
  kind: 'general',
  name: 'Computer',
  path: '/home/me'
}

type OpenDialog =
  | 'settings'
  | 'edit-project'
  | 'edit-project-working'
  | 'edit-general'
  | 'new-thread'
  | 'new-thread-error'
  | 'edit-thread'
  | null

/** Dialog launchers; the gallery screenshots open them by clicking `[data-open="…"]`. */
function Dialogs(): React.JSX.Element {
  const [open, setOpen] = useState<OpenDialog>(null)
  const close = (): void => setOpen(null)
  const launcher = (id: Exclude<OpenDialog, null>, label: string): React.JSX.Element => (
    <Button data-open={id} onClick={() => setOpen(id)}>
      {label}
    </Button>
  )
  const editing =
    open === 'edit-general' ? generalProject : open?.startsWith('edit-project') ? repository : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 rounded-xl bg-panel p-4 elevation-card">
        {launcher('settings', 'Settings')}
        {launcher('edit-project', 'Edit project')}
        {launcher('edit-project-working', 'Edit project (threads working)')}
        {launcher('edit-general', 'Edit built-in project')}
        {launcher('new-thread', 'New thread')}
        {launcher('new-thread-error', 'New thread (error)')}
        {launcher('edit-thread', 'Edit thread')}
      </div>

      <SettingsStates />

      <SettingsDialog
        onClose={close}
        onSave={async () => {
          await new Promise((resolve) => setTimeout(resolve, 400))
          return { ok: true }
        }}
        open={open === 'settings'}
        settings={settings}
      />
      <EditRepositoryDialog
        onBrowseFavicon={async () => null}
        onBrowseSolutionFile={async () => null}
        onClose={close}
        onRemove={async () => false}
        onSave={async (input) =>
          input.previewUrl === 'localhost'
            ? { ok: false, error: 'Preview URL must be an http:// or https:// address.' }
            : { ok: true }
        }
        open={editing !== null}
        removing={false}
        repository={editing}
        workingThreadCount={open === 'edit-project-working' ? 2 : 0}
      />
      <NewThreadDialog
        busy={false}
        error={
          open === 'new-thread-error'
            ? 'Could not switch to feature/theme-picker: your working tree has uncommitted changes.'
            : null
        }
        onClose={close}
        onSubmit={async () => false}
        open={open === 'new-thread' || open === 'new-thread-error'}
        repository={repository}
      />
      <EditThreadDialog
        busy={false}
        onClose={close}
        onSubmit={async () => true}
        open={open === 'edit-thread'}
        runtimeTitle="Restyle the settings dialog"
        thread={open === 'edit-thread' ? thread('a') : null}
      />
    </div>
  )
}

function field<V>(
  id: string,
  value: V,
  status: AutoSaveFieldStatus = { state: 'idle' }
): AutoSaveField<V> {
  return { id: `gallery-${id}`, value, status, set: () => {}, edit: () => {}, commit: () => {} }
}

/** Every SettingsLayout state, outside a dialog: field statuses, errors and the danger tone. */
function SettingsStates(): React.JSX.Element {
  const [activeId, setActiveId] = useState('general')
  const [theme, setTheme] = useState<ThemeId>('graphite')
  const sections: SettingsSection[] = [
    {
      id: 'general',
      label: 'General',
      description: 'Field statuses: idle, saving, saved and a rejected value.',
      hasError: true,
      content: (
        <>
          <TextSetting field={field('name', 'taskmaster')} hint="An idle field." label="Name" />
          <TextSetting
            field={field('saving', 'bun run dev', { state: 'saving' })}
            hint="Saving after a pause in typing."
            label="Run command"
          />
          <CheckboxSetting
            checkboxLabel="Push to the remote after committing"
            field={field('push', true, { state: 'saved' })}
            hint="Just saved."
            label="Push"
          />
          <TextSetting
            field={field('url', 'localhost', {
              state: 'error',
              error: 'Preview URL must be an http:// or https:// address.'
            })}
            hint="A value the main process rejected."
            label="Preview URL"
          />
          <TextAreaSetting field={field('tags', 'bug\nfeature\nui')} label="Task tags" rows={3}>
            <TagPreview tags={['bug', 'feature', 'ui']} />
          </TextAreaSetting>
        </>
      )
    },
    {
      id: 'appearance',
      label: 'Appearance',
      content: (
        <SettingRow label="Theme" labelId="gallery-theme" labelsControl={false} stacked>
          <ThemePicker labelledBy="gallery-theme" onChange={setTheme} value={theme} />
        </SettingRow>
      )
    },
    {
      id: 'empty',
      label: 'Tasks',
      content: (
        <SettingRow label="Task tags">
          <TagPreview empty="No task tags configured." tags={[]} />
        </SettingRow>
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
              Deletes this project&apos;s threads and tasks from Taskmaster.
            </p>
          </div>
          <Button variant="danger">Remove…</Button>
        </section>
      )
    }
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-6 rounded-xl bg-panel px-5 py-3 elevation-card">
        <SaveStatus errorCount={0} status="idle" />
        <SaveStatus errorCount={0} status="saving" />
        <SaveStatus errorCount={0} status="saved" />
        <SaveStatus errorCount={2} status="error" />
      </div>
      <div
        className="flex h-[560px] max-w-[880px] overflow-hidden rounded-xl bg-panel elevation-pop"
        data-gallery="settings-layout"
      >
        <SettingsLayout
          activeId={activeId}
          label="Gallery settings sections"
          onActiveChange={setActiveId}
          sections={sections}
        />
      </div>
    </div>
  )
}

const section: GallerySection = {
  id: 'dialogs',
  title: 'Dialogs and settings',
  order: 40,
  Component: Dialogs
}
export default section
