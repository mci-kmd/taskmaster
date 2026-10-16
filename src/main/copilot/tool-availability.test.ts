import type { Tool, ToolInvocation } from '@github/copilot-sdk'
import { describe, expect, it, vi } from 'vitest'
import { TASKMASTER_TOOLS, isTaskmasterToolEnabled } from '../../shared/copilot-tools'
import { PROJECT_TASK_TOOL_NAMES } from './project-task-tools'
import { THREAD_TOOL_NAMES } from './thread-tools'
import { withToolAvailability } from './tool-availability'

describe('tool availability', () => {
  it('lists every Taskmaster tool in the settings catalog', () => {
    expect(TASKMASTER_TOOLS.map((tool) => tool.name).sort()).toEqual(
      [...Object.values(PROJECT_TASK_TOOL_NAMES), ...Object.values(THREAD_TOOL_NAMES)].sort()
    )
  })

  it('offers only enabled tools and refuses calls to tools turned off later', async () => {
    const handler = vi.fn(() => 'done')
    const tools: Tool[] = [
      { name: 'a', handler },
      { name: 'b', handler }
    ]
    const disabled = new Set(['b'])

    const available = withToolAvailability(tools, (name) => !disabled.has(name))
    expect(available.map((tool) => tool.name)).toEqual(['a'])
    expect(await available[0].handler?.({}, {} as ToolInvocation)).toBe('done')

    disabled.add('a')
    expect(await available[0].handler?.({}, {} as ToolInvocation)).toMatchObject({
      resultType: 'failure'
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('lets a project override the app setting', () => {
    const settings = { disabledTaskmasterTools: ['taskmaster_create_task'] }
    expect(isTaskmasterToolEnabled('taskmaster_create_task', settings)).toBe(false)
    expect(isTaskmasterToolEnabled('taskmaster_list_tasks', settings)).toBe(true)
    expect(
      isTaskmasterToolEnabled('taskmaster_create_task', settings, {
        taskmasterToolOverrides: { taskmaster_create_task: true }
      })
    ).toBe(true)
    expect(
      isTaskmasterToolEnabled('taskmaster_list_tasks', settings, {
        taskmasterToolOverrides: { taskmaster_list_tasks: false }
      })
    ).toBe(false)
  })
})
