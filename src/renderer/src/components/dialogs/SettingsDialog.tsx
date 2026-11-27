import { useState } from 'react'
import Modal from '../Modal'
import ThemePicker from '../settings/ThemePicker'
import {
  CheckboxSetting,
  SaveStatus,
  SettingRow,
  SettingsLayout,
  TagPreview,
  TextAreaSetting,
  TextSetting,
  type SettingsSection
} from '../settings/SettingsLayout'
import { TaskmasterToolCheckboxes } from '../settings/TaskmasterToolSettings'
import {
  TASKMASTER_TOOL_KEYS,
  TASKMASTER_TOOLS_HINT,
  disabledToolsFromValues,
  toolEnabledValues,
  type TaskmasterToolKey
} from '../settings/taskmaster-tool-values'
import { useAutoSave, type AutoSaveResult } from '../settings/use-auto-save'
import type {
  AppSettingsSnapshot,
  ThreadSetupMode,
  UpdateSettingsInput
} from '../../../../shared/app-types'
import {
  AUTO_COMPACT_THRESHOLD_MAX_TOKENS,
  AUTO_COMPACT_THRESHOLD_MIN_TOKENS,
  DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS,
  resolveAutoCompactThresholdTokens
} from '../../../../shared/auto-compact'
import { parseTaskTagsInput } from '../../../../shared/task-tags'
import { DEFAULT_THEME } from '../../../../shared/themes'
import { DEFAULT_THREAD_SETUP_MODE, THREAD_SETUP_MODES } from '../../../../shared/thread-setup'
import Checkbox from '../ui/Checkbox'
import { TextInput } from '../ui/Field'
import Select from '../ui/Select'
import LegacyModelsPicker from './LegacyModelsPicker'
import { useDialogSession } from './use-dialog-session'

const MIN_THRESHOLD_K = AUTO_COMPACT_THRESHOLD_MIN_TOKENS / 1_000
const MAX_THRESHOLD_K = AUTO_COMPACT_THRESHOLD_MAX_TOKENS / 1_000

function parseThresholdTokens(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < MIN_THRESHOLD_K || parsed > MAX_THRESHOLD_K) {
    return null
  }
  return Math.round(parsed * 1_000)
}

type SettingsValues = Omit<
  UpdateSettingsInput,
  'disabledTaskmasterTools' | 'autoCompactThresholdTokens'
> & {
  showAgentModePicker: boolean
  autoUpdateCopilot: boolean
  autoCompactEnabled: boolean
  autoCompactThresholdK: string
} & Record<TaskmasterToolKey, boolean>

type SettingsDialogProps = {
  open: boolean
  settings: AppSettingsSnapshot
  onClose: () => void
  /** Persists the full settings; called automatically as settings change. */
  onSave: (input: UpdateSettingsInput) => Promise<AutoSaveResult>
}

export default function SettingsDialog(props: SettingsDialogProps): React.JSX.Element | null {
  // The content stays mounted while the dialog animates out; a new session (a fresh mount)
  // resets the drafts each time it opens.
  const session = useDialogSession(props.open)
  return session.mounted ? <SettingsDialogContent key={session.key} {...props} /> : null
}

function SettingsDialogContent({
  open,
  settings,
  onClose,
  onSave
}: SettingsDialogProps): React.JSX.Element {
  const [sectionId, setSectionId] = useState('appearance')
  const resolvedAutoCompact = resolveAutoCompactThresholdTokens(settings.autoCompactThresholdTokens)
  const form = useAutoSave<SettingsValues>({
    initialValues: {
      yoloEnabled: settings.yoloEnabled,
      terminalFontFamilyInput: settings.terminalFontFamilyInput,
      taskTagsInput: settings.taskTagsInput,
      legacyCopilotModels: settings.legacyCopilotModels ?? [],
      theme: settings.theme ?? DEFAULT_THEME,
      showAgentModePicker: settings.showAgentModePicker ?? false,
      autoUpdateCopilot: settings.autoUpdateCopilot !== false,
      autoCompactEnabled: resolvedAutoCompact !== null,
      autoCompactThresholdK: String(
        Number(((resolvedAutoCompact ?? DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS) / 1_000).toFixed(1))
      ),
      threadSetupMode: settings.threadSetupMode ?? DEFAULT_THREAD_SETUP_MODE,
      ...toolEnabledValues(settings.disabledTaskmasterTools)
    },
    save: (values) => {
      let autoCompactThresholdTokens: number | null = null
      if (values.autoCompactEnabled) {
        const parsed = parseThresholdTokens(values.autoCompactThresholdK)
        if (parsed === null) {
          return Promise.resolve({
            ok: false,
            error: `Enter a number between ${MIN_THRESHOLD_K} and ${MAX_THRESHOLD_K} (k tokens).`
          })
        }
        autoCompactThresholdTokens = parsed
      }
      return onSave({
        yoloEnabled: values.yoloEnabled,
        terminalFontFamilyInput: values.terminalFontFamilyInput,
        taskTagsInput: values.taskTagsInput,
        legacyCopilotModels: values.legacyCopilotModels,
        theme: values.theme,
        showAgentModePicker: values.showAgentModePicker,
        autoUpdateCopilot: values.autoUpdateCopilot,
        autoCompactThresholdTokens,
        threadSetupMode: values.threadSetupMode,
        disabledTaskmasterTools: disabledToolsFromValues(values)
      })
    }
  })
  const { values } = form
  const legacyModels = form.field('legacyCopilotModels')
  const autoCompactEnabled = form.field('autoCompactEnabled')
  const autoCompactThresholdK = form.field('autoCompactThresholdK')
  const autoCompactStatus =
    autoCompactThresholdK.status.state === 'error'
      ? autoCompactThresholdK.status
      : autoCompactEnabled.status.state !== 'idle'
        ? autoCompactEnabled.status
        : autoCompactThresholdK.status
  const theme = form.field('theme')
  const threadSetupMode = form.field('threadSetupMode')

  const close = (): void => {
    void form.flush()
    onClose()
  }

  const sections: SettingsSection[] = [
    {
      id: 'appearance',
      label: 'Appearance',
      hasError: form.hasErrors(['theme']),
      content: (
        <SettingRow
          hint="Switches the whole app right away."
          label="Theme"
          labelId={`${theme.id}-label`}
          labelsControl={false}
          stacked
          status={theme.status}
        >
          <ThemePicker
            labelledBy={`${theme.id}-label`}
            onChange={theme.set}
            value={theme.value ?? DEFAULT_THEME}
          />
        </SettingRow>
      )
    },
    {
      id: 'threads',
      label: 'Threads',
      hasError: form.hasErrors(['threadSetupMode']),
      content: (
        <SettingRow
          controlId={threadSetupMode.id}
          hint="Preselected under the message box of a new thread, where you can still change it before the first message. Projects can override it in Edit project."
          label="New thread checkout"
          status={threadSetupMode.status}
        >
          <Select
            id={threadSetupMode.id}
            onChange={(value) => threadSetupMode.set(value as ThreadSetupMode)}
            options={THREAD_SETUP_MODES}
            value={threadSetupMode.value ?? DEFAULT_THREAD_SETUP_MODE}
          />
        </SettingRow>
      )
    },
    {
      id: 'copilot',
      label: 'Copilot',
      description: 'Applies to newly opened sessions.',
      hasError: form.hasErrors([
        'yoloEnabled',
        'showAgentModePicker',
        'autoUpdateCopilot',
        'autoCompactEnabled',
        'autoCompactThresholdK',
        'legacyCopilotModels'
      ]),
      content: (
        <>
          <CheckboxSetting
            checkboxLabel="Approve requests automatically"
            field={form.field('yoloEnabled')}
            hint="Copilot permission requests are approved without asking, except those that managed policy requires you to approve."
            label="Permissions"
          />
          <CheckboxSetting
            checkboxLabel="Show the mode picker"
            field={form.field('showAgentModePicker')}
            hint="Lets you send messages in Plan or Autopilot mode. When hidden, Copilot always works in Interactive mode."
            label="Agent mode"
          />
          <SettingRow
            hint="Compacts large conversations before sending your next message once the prompt cache expires, instead of recaching the full history. You can still skip it on individual messages."
            label="Auto-compact"
            labelsControl={false}
            status={autoCompactStatus}
          >
            <div className="space-y-2.5">
              <Checkbox
                checked={autoCompactEnabled.value}
                id={autoCompactEnabled.id}
                label="Compact before sending when prompt cache is stale"
                onChange={autoCompactEnabled.set}
              />
              {autoCompactEnabled.value ? (
                <div className="flex items-center gap-2 pl-6">
                  <label className="text-[12px] text-fg-muted" htmlFor={autoCompactThresholdK.id}>
                    When context exceeds
                  </label>
                  <TextInput
                    aria-label="Auto-compact threshold (k tokens)"
                    className="!w-24 font-mono"
                    id={autoCompactThresholdK.id}
                    inputMode="decimal"
                    onBlur={autoCompactThresholdK.commit}
                    onChange={(event) => autoCompactThresholdK.edit(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') autoCompactThresholdK.commit()
                    }}
                    placeholder="50"
                    type="text"
                    value={autoCompactThresholdK.value}
                  />
                  <span className="text-[12px] text-fg-subtle">k tokens</span>
                </div>
              ) : null}
            </div>
          </SettingRow>
          <CheckboxSetting
            checkboxLabel="Install updates on startup"
            field={form.field('autoUpdateCopilot')}
            hint="When a newer Copilot version is available, Taskmaster installs it as it starts, before connecting. When off, use Update available in a session."
            label="Updates"
          />
          <SettingRow
            hint="The model picker lists these under a collapsed Legacy row at the end of their family."
            label="Legacy models"
            labelsControl={false}
            status={legacyModels.status}
          >
            <LegacyModelsPicker onChange={legacyModels.set} value={legacyModels.value ?? []} />
          </SettingRow>
        </>
      )
    },
    {
      id: 'tools',
      label: 'Tools',
      description: `Taskmaster tools Copilot can use. ${TASKMASTER_TOOLS_HINT} Projects can override them in Edit project.`,
      hasError: form.hasErrors(TASKMASTER_TOOL_KEYS),
      content: <TaskmasterToolCheckboxes field={(key) => form.field(key)} />
    },
    {
      id: 'terminal',
      label: 'Terminal',
      hasError: form.hasErrors(['terminalFontFamilyInput']),
      content: (
        <TextSetting
          field={form.field('terminalFontFamilyInput')}
          hint="CSS font-family stack for thread terminals. Leave blank for the built-in Nerd Font stack."
          label="Font family"
          placeholder="'CaskaydiaCove Nerd Font Mono', Consolas, monospace"
          stacked
        >
          <p className="mt-2 break-words text-[12px] leading-5 text-fg-subtle">
            In use:{' '}
            <span className="font-mono text-[11.5px] text-fg-muted">
              {values.terminalFontFamilyInput.trim() || settings.resolvedTerminalFontFamily}
            </span>
          </p>
        </TextSetting>
      )
    },
    {
      id: 'tasks',
      label: 'Tasks',
      hasError: form.hasErrors(['taskTagsInput']),
      content: (
        <TextAreaSetting
          field={form.field('taskTagsInput')}
          hint="Comma- or newline-separated labels offered for tasks in every project. Projects can add their own in Edit project."
          label="Task tags"
          placeholder={'bug\nfeature'}
          rows={4}
        >
          <TagPreview
            empty="No task tags configured."
            tags={
              values.taskTagsInput === settings.taskTagsInput
                ? settings.parsedTaskTags
                : parseTaskTagsInput(values.taskTagsInput)
            }
          />
        </TextAreaSetting>
      )
    }
  ]

  return (
    <Modal
      description="Configure the appearance, Copilot sessions and your workspace."
      fill
      headerExtra={<SaveStatus errorCount={form.errorCount} status={form.status} />}
      onClose={close}
      open={open}
      title="Settings"
      width="xl"
    >
      <SettingsLayout
        activeId={sectionId}
        label="Settings sections"
        onActiveChange={setSectionId}
        sections={sections}
      />
    </Modal>
  )
}
