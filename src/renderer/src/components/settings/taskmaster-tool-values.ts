import {
  TASKMASTER_TOOLS,
  type TaskmasterToolName,
  type TaskmasterToolOverrides
} from '../../../../shared/copilot-tools'

export const TASKMASTER_TOOLS_HINT =
  'Turning a tool off applies right away; turning one on applies to newly opened sessions.'

/** Form key of a tool's setting, so each tool saves and shows its status on its own. */
export type TaskmasterToolKey = `tool:${TaskmasterToolName}`

export function taskmasterToolKey(name: TaskmasterToolName): TaskmasterToolKey {
  return `tool:${name}`
}

export const TASKMASTER_TOOL_KEYS: TaskmasterToolKey[] = TASKMASTER_TOOLS.map((tool) =>
  taskmasterToolKey(tool.name)
)

export type ToolOverrideChoice = 'default' | 'on' | 'off'

export function toolEnabledValues(
  disabled: readonly string[] | undefined
): Record<TaskmasterToolKey, boolean> {
  return Object.fromEntries(
    TASKMASTER_TOOLS.map((tool) => [taskmasterToolKey(tool.name), !disabled?.includes(tool.name)])
  ) as Record<TaskmasterToolKey, boolean>
}

export function disabledToolsFromValues(
  values: Record<TaskmasterToolKey, boolean>
): TaskmasterToolName[] {
  return TASKMASTER_TOOLS.filter((tool) => !values[taskmasterToolKey(tool.name)]).map(
    (tool) => tool.name
  )
}

export function toolOverrideValues(
  overrides: TaskmasterToolOverrides | undefined
): Record<TaskmasterToolKey, ToolOverrideChoice> {
  return Object.fromEntries(
    TASKMASTER_TOOLS.map((tool) => {
      const override = overrides?.[tool.name]
      return [
        taskmasterToolKey(tool.name),
        override === undefined ? 'default' : override ? 'on' : 'off'
      ]
    })
  ) as Record<TaskmasterToolKey, ToolOverrideChoice>
}

export function toolOverridesFromValues(
  values: Record<TaskmasterToolKey, ToolOverrideChoice>
): TaskmasterToolOverrides {
  const overrides: TaskmasterToolOverrides = {}
  for (const tool of TASKMASTER_TOOLS) {
    const choice = values[taskmasterToolKey(tool.name)]
    if (choice !== 'default') overrides[tool.name] = choice === 'on'
  }
  return overrides
}
