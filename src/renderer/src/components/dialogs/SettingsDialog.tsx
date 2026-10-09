import { useState } from 'react'
import Modal from '../Modal'
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
import { useAutoSave, type AutoSaveResult } from '../settings/use-auto-save'
import type { AppSettingsSnapshot, UpdateSettingsInput } from '../../../../shared/app-types'
import { parseTaskTagsInput } from '../../../../shared/task-tags'
import LegacyModelsPicker from './LegacyModelsPicker'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettingsSnapshot
  onClose: () => void
  /** Persists the full settings; called automatically as settings change. */
  onSave: (input: UpdateSettingsInput) => Promise<AutoSaveResult>
}

export default function SettingsDialog(props: SettingsDialogProps): React.JSX.Element | null {
  // Mounting only while open resets the drafts each time the dialog opens.
  return props.open ? <SettingsDialogContent {...props} /> : null
}

function SettingsDialogContent({
  settings,
  onClose,
  onSave
}: SettingsDialogProps): React.JSX.Element {
  const [sectionId, setSectionId] = useState('copilot')
  const form = useAutoSave<UpdateSettingsInput>({
    initialValues: {
      yoloEnabled: settings.yoloEnabled,
      terminalFontFamilyInput: settings.terminalFontFamilyInput,
      taskTagsInput: settings.taskTagsInput,
      legacyCopilotModels: settings.legacyCopilotModels ?? []
    },
    save: (values) => onSave(values)
  })
  const { values } = form
  const legacyModels = form.field('legacyCopilotModels')

  const close = (): void => {
    void form.flush()
    onClose()
  }

  const sections: SettingsSection[] = [
    {
      id: 'copilot',
      label: 'Copilot',
      description: 'Applies to newly opened sessions.',
      hasError: form.hasErrors(['yoloEnabled', 'legacyCopilotModels']),
      content: (
        <>
          <CheckboxSetting
            checkboxLabel="Approve requests automatically"
            field={form.field('yoloEnabled')}
            hint="Copilot permission requests are approved without asking, except those that managed policy requires you to approve."
            label="Permissions"
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
          <p className="mt-2 break-words text-[12px] leading-5 text-[var(--color-fg-subtle)]">
            In use:{' '}
            <span className="font-mono text-[11.5px] text-[var(--color-fg-muted)]">
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
      description="Configure Copilot sessions and your workspace."
      fill
      headerExtra={<SaveStatus errorCount={form.errorCount} status={form.status} />}
      onClose={close}
      open
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
