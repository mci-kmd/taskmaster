import type { Tool, ToolInvocation, ToolResultObject } from '@github/copilot-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { PersistedThread, ThreadWorkItem } from '../../shared/app-types'
import { createThreadTools, THREAD_TOOL_NAMES } from './thread-tools'

function setup(workItems?: ThreadWorkItem[]): {
  thread: PersistedThread
  onThreadChanged: ReturnType<typeof vi.fn>
  call: (name: string, args: unknown) => ToolResultObject
  tools: Tool[]
} {
  const thread: PersistedThread = {
    id: 'thread-1',
    repositoryId: 'repo-1',
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'active-branch',
    branchName: 'main',
    worktreePath: null,
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    ...(workItems ? { workItems } : {})
  }
  const onThreadChanged = vi.fn()
  const tools = createThreadTools({
    resolveThread: () => thread,
    settleThread: () => {
      thread.settledAt = '2026-02-01T00:00:00.000Z'
      return true
    },
    setWorkItems: (items) => {
      if (items.length > 0) thread.workItems = items
      else delete thread.workItems
      return true
    },
    onThreadChanged
  })
  const call = (name: string, args: unknown): ToolResultObject =>
    tools.find((tool) => tool.name === name)!.handler!(
      args,
      {} as ToolInvocation
    ) as ToolResultObject
  return { thread, onThreadChanged, call, tools }
}

function parse(result: ToolResultObject): Record<string, unknown> {
  expect(result.resultType).toBe('success')
  return JSON.parse(result.textResultForLlm) as Record<string, unknown>
}

const issue: ThreadWorkItem = {
  provider: 'github',
  url: 'https://github.com/octo/app/issues/12',
  container: 'octo/app',
  number: 12,
  title: 'Crash on start'
}

describe('thread tools', () => {
  it('only settles when asked, and says so in the description', () => {
    const { tools, thread, call, onThreadChanged } = setup()
    expect(tools.map((tool) => tool.name)).toEqual(Object.values(THREAD_TOOL_NAMES))
    const settle = tools.find((tool) => tool.name === THREAD_TOOL_NAMES.settle)!
    expect(settle.description).toContain('NEVER call this on your own initiative')
    expect(settle.description).toContain('explicitly asked')

    expect(parse(call(THREAD_TOOL_NAMES.settle, {})).message).toBe('Resolved this thread.')
    expect(thread.settledAt).toBe('2026-02-01T00:00:00.000Z')
    expect(onThreadChanged).toHaveBeenCalledTimes(1)
    expect(parse(call(THREAD_TOOL_NAMES.settle, {})).message).toBe(
      'This thread is already resolved.'
    )
    expect(onThreadChanged).toHaveBeenCalledTimes(1)
  })

  it('tells the agent to link work items automatically', () => {
    const { tools } = setup()
    const link = tools.find((tool) => tool.name === THREAD_TOOL_NAMES.linkWorkItems)!
    expect(link.description).toContain('ALWAYS call this automatically')
    expect(link.description).toContain('cannot edit them by hand')
  })

  it('adds, updates and unlinks work items by canonical URL', () => {
    const { thread, call, onThreadChanged } = setup([issue])
    const added = parse(
      call(THREAD_TOOL_NAMES.linkWorkItems, {
        workItems: [
          { url: 'octo/app#12' },
          {
            url: 'https://dev.azure.com/contoso/My%20Project/_workitems/edit/345',
            title: ' Login '
          }
        ]
      })
    )
    expect(added.workItems).toEqual([
      { reference: 'octo/app#12', url: issue.url, title: 'Crash on start' },
      {
        reference: 'contoso/My Project#345',
        url: 'https://dev.azure.com/contoso/My%20Project/_workitems/edit/345',
        title: 'Login'
      }
    ])
    expect(onThreadChanged).toHaveBeenCalledTimes(1)

    parse(
      call(THREAD_TOOL_NAMES.linkWorkItems, {
        unlink: ['https://contoso.visualstudio.com/My%20Project/_workitems/edit/345']
      })
    )
    expect(thread.workItems).toEqual([issue])

    const replaced = parse(
      call(THREAD_TOOL_NAMES.linkWorkItems, {
        replace: true,
        workItems: [{ url: 'https://github.com/octo/app/pull/7/files' }]
      })
    )
    expect(replaced.workItems).toEqual([
      { reference: 'octo/app#7', url: 'https://github.com/octo/app/pull/7' }
    ])

    parse(call(THREAD_TOOL_NAMES.linkWorkItems, { replace: true, workItems: [] }))
    expect(thread).not.toHaveProperty('workItems')
  })

  it('lists links without changes and rejects anything that is not a work item', () => {
    const { thread, call, onThreadChanged } = setup([issue])
    expect(parse(call(THREAD_TOOL_NAMES.linkWorkItems, {})).workItems).toHaveLength(1)
    const invalid = call(THREAD_TOOL_NAMES.linkWorkItems, {
      workItems: [{ url: 'https://example.com/1' }]
    })
    expect(invalid.resultType).toBe('failure')
    expect(invalid.textResultForLlm).toContain('workItems[0].url')
    expect(call(THREAD_TOOL_NAMES.linkWorkItems, { replace: 'yes' }).resultType).toBe('failure')
    expect(thread.workItems).toEqual([issue])
    expect(onThreadChanged).not.toHaveBeenCalled()
  })
})
