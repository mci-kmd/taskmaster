/** The custom tools Taskmaster gives Copilot sessions, in the order settings list them. */
export const TASKMASTER_TOOLS = [
  {
    name: 'taskmaster_list_tasks',
    label: 'List tasks',
    allowLabel: 'Copilot can read the task list',
    description: "Reads the project's task list."
  },
  {
    name: 'taskmaster_create_task',
    label: 'Create tasks',
    allowLabel: 'Copilot can create tasks',
    description: 'Adds tasks to the project when you ask.'
  },
  {
    name: 'taskmaster_update_task',
    label: 'Edit tasks',
    allowLabel: 'Copilot can edit tasks',
    description: "Changes a task's title, description, labels or linked issue when you ask."
  },
  {
    name: 'taskmaster_complete_task',
    label: 'Complete tasks',
    allowLabel: 'Copilot can complete tasks',
    description: 'Marks tasks as completed when you ask.'
  },
  {
    name: 'taskmaster_settle_thread',
    label: 'Settle threads',
    allowLabel: 'Copilot can settle its thread',
    description: 'Settles the thread when you ask it to.'
  },
  {
    name: 'taskmaster_link_work_items',
    label: 'Link work items',
    allowLabel: 'Copilot can link work items',
    description: 'Links the issues, pull requests and work items the thread works on to its card.'
  }
] as const

export type TaskmasterToolName = (typeof TASKMASTER_TOOLS)[number]['name']

/** Per-project tool states; an absent tool follows the app setting. */
export type TaskmasterToolOverrides = Partial<Record<TaskmasterToolName, boolean>>

export function isTaskmasterToolName(value: unknown): value is TaskmasterToolName {
  return TASKMASTER_TOOLS.some((tool) => tool.name === value)
}

/** Known tool names, without duplicates, in catalog order; undefined when there are none. */
export function normalizeDisabledTaskmasterTools(value: unknown): TaskmasterToolName[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = TASKMASTER_TOOLS.map((tool) => tool.name).filter((name) => value.includes(name))
  return names.length ? names : undefined
}

/** Keeps boolean states of known tools; undefined when there are none. */
export function normalizeTaskmasterToolOverrides(
  value: unknown
): TaskmasterToolOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const overrides: TaskmasterToolOverrides = {}
  for (const { name } of TASKMASTER_TOOLS) {
    if (typeof record[name] === 'boolean') overrides[name] = record[name]
  }
  return Object.keys(overrides).length ? overrides : undefined
}

export function sameTaskmasterToolSettings(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** A project's override wins; otherwise the app setting decides. Tools are on by default. */
export function isTaskmasterToolEnabled(
  name: string,
  settings: { disabledTaskmasterTools?: readonly string[] },
  repository?: { taskmasterToolOverrides?: TaskmasterToolOverrides } | null
): boolean {
  const override = repository?.taskmasterToolOverrides?.[name as TaskmasterToolName]
  if (typeof override === 'boolean') return override
  return !settings.disabledTaskmasterTools?.includes(name)
}
