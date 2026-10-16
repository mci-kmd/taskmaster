import { TASKMASTER_TOOLS } from '../../../../shared/copilot-tools'
import SegmentedControl from '../ui/SegmentedControl'
import { CheckboxSetting, SettingRow, Token } from './SettingsLayout'
import {
  taskmasterToolKey,
  type TaskmasterToolKey,
  type ToolOverrideChoice
} from './taskmaster-tool-values'
import type { AutoSaveField } from './use-auto-save'

function ToolHint({ description, name }: { description: string; name: string }): React.JSX.Element {
  return (
    <>
      {description} <Token>{name}</Token>
    </>
  )
}

/** App-wide on/off checkboxes, one row per tool. */
export function TaskmasterToolCheckboxes({
  field
}: {
  field: (key: TaskmasterToolKey) => AutoSaveField<boolean>
}): React.JSX.Element {
  return (
    <>
      {TASKMASTER_TOOLS.map((tool) => (
        <CheckboxSetting
          checkboxLabel={tool.allowLabel}
          field={field(taskmasterToolKey(tool.name))}
          hint={<ToolHint description={tool.description} name={tool.name} />}
          key={tool.name}
          label={tool.label}
        />
      ))}
    </>
  )
}

/** Per-project Default/On/Off choices; Default follows the app setting, shown in its label. */
export function TaskmasterToolOverrideRows({
  field,
  disabledByDefault
}: {
  field: (key: TaskmasterToolKey) => AutoSaveField<ToolOverrideChoice>
  /** The app setting, so Default can say what it means. */
  disabledByDefault?: readonly string[]
}): React.JSX.Element {
  return (
    <>
      {TASKMASTER_TOOLS.map((tool) => {
        const toolField = field(taskmasterToolKey(tool.name))
        const inheritedOn = !disabledByDefault?.includes(tool.name)
        return (
          <SettingRow
            hint={<ToolHint description={tool.description} name={tool.name} />}
            key={tool.name}
            label={tool.label}
            labelsControl={false}
            status={toolField.status}
          >
            <SegmentedControl
              ariaLabel={tool.label}
              onChange={toolField.set}
              options={[
                {
                  value: 'default',
                  label: `Default (${inheritedOn ? 'on' : 'off'})`,
                  description: 'Follow the app setting in Settings'
                },
                { value: 'on', label: 'On', description: 'Always offer this tool in this project' },
                { value: 'off', label: 'Off', description: 'Never offer this tool in this project' }
              ]}
              value={toolField.value}
            />
          </SettingRow>
        )
      })}
    </>
  )
}
