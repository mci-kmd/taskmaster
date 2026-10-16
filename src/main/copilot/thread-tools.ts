import type { Tool, ToolResultObject } from '@github/copilot-sdk'
import type { PersistedThread, ThreadWorkItem } from '../../shared/app-types'
import {
  MAX_THREAD_WORK_ITEMS,
  WORK_ITEM_INPUT_HINT,
  formatWorkItemReference,
  normalizeWorkItemTitle,
  parseWorkItemReference
} from '../../shared/work-items'

export type ThreadToolDependencies = {
  /** The session's thread, looked up on every call. */
  resolveThread: () => PersistedThread | undefined
  settleThread: () => boolean
  setWorkItems: (workItems: ThreadWorkItem[]) => boolean
  /** Makes open windows refresh their snapshot. */
  onThreadChanged: () => void
}

export const THREAD_TOOL_NAMES = {
  settle: 'taskmaster_settle_thread',
  linkWorkItems: 'taskmaster_link_work_items'
} as const

type Args = Record<string, unknown>

class ToolInputError extends Error {}

function success(value: unknown): ToolResultObject {
  return { textResultForLlm: JSON.stringify(value, null, 2), resultType: 'success' }
}

function failure(message: string): ToolResultObject {
  return { textResultForLlm: message, resultType: 'failure', error: message }
}

function asArgs(value: unknown): Args {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Args) : {}
}

function toView(item: ThreadWorkItem): Record<string, string> {
  return {
    reference: formatWorkItemReference(item),
    url: item.url,
    ...(item.title ? { title: item.title } : {})
  }
}

function parseOrThrow(value: unknown, field: string): Omit<ThreadWorkItem, 'title'> {
  const parsed = typeof value === 'string' ? parseWorkItemReference(value) : null
  if (!parsed) {
    throw new ToolInputError(
      `${field}: ${JSON.stringify(value)} is not a work item. ${WORK_ITEM_INPUT_HINT}`
    )
  }
  return parsed
}

function readLinks(args: Args): ThreadWorkItem[] {
  const value = args.workItems
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ToolInputError('"workItems" must be an array.')
  return value.map((entry, index) => {
    const record =
      typeof entry === 'string' ? { url: entry } : entry && typeof entry === 'object' ? entry : {}
    const { url, title } = record as Record<string, unknown>
    if (title !== undefined && title !== null && typeof title !== 'string') {
      throw new ToolInputError(`workItems[${index}].title must be a string.`)
    }
    const parsed = parseOrThrow(url, `workItems[${index}].url`)
    const normalizedTitle = normalizeWorkItemTitle(title)
    return normalizedTitle ? { ...parsed, title: normalizedTitle } : parsed
  })
}

function readUnlinks(args: Args): string[] {
  const value = args.unlink
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ToolInputError('"unlink" must be an array of strings.')
  return value.map((entry, index) => parseOrThrow(entry, `unlink[${index}]`).url)
}

export function createThreadTools(dependencies: ThreadToolDependencies): Tool[] {
  const run =
    (handler: (args: Args, thread: PersistedThread) => ToolResultObject) =>
    (rawArgs: unknown): ToolResultObject => {
      const thread = dependencies.resolveThread()
      if (!thread) return failure('The thread for this session no longer exists.')
      try {
        return handler(asArgs(rawArgs), thread)
      } catch (error) {
        if (error instanceof ToolInputError) return failure(error.message)
        throw error
      }
    }

  const settleThread: Tool = {
    name: THREAD_TOOL_NAMES.settle,
    description:
      'Resolve (settle) the Taskmaster thread this conversation belongs to, moving it out of the ' +
      "user's inbox of active threads. NEVER call this on your own initiative, not even when the " +
      'work looks finished. Only call it when the user has explicitly asked you to resolve, ' +
      'settle or close this thread, for example "fix the bug, then resolve yourself". ' +
      'When asked to do so after some work, finish all of that work first and call this as the ' +
      'very last step. Only the user can reopen a settled thread.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    // Reversible from the UI, and a prompt would defeat "do X, then resolve yourself".
    skipPermission: true,
    handler: run((_args, thread) => {
      if (thread.settledAt) return success({ message: 'This thread is already resolved.' })
      if (!dependencies.settleThread()) return failure('The thread could not be resolved.')
      dependencies.onThreadChanged()
      return success({ message: 'Resolved this thread.' })
    })
  }

  const linkWorkItems: Tool = {
    name: THREAD_TOOL_NAMES.linkWorkItems,
    description:
      'Link the Taskmaster thread this conversation belongs to with the GitHub issues or pull ' +
      'requests and Azure DevOps work items being worked on in it. Taskmaster shows the links on ' +
      "the thread's card, and the user cannot edit them by hand. Call this automatically, " +
      'without being asked, as soon as you notice that a specific work item is being worked on ' +
      'in this thread, for example when the user refers to one or you start working on one; ' +
      'there is no need to ask first. Also call it when the user asks to change the links. ' +
      'Only link items that are actually being worked on, not ones merely mentioned for ' +
      'context. Returns the current links. ' +
      WORK_ITEM_INPUT_HINT,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workItems: {
          type: 'array',
          description:
            'Work items to link. Items that are already linked are kept, with their title updated.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              url: { type: 'string', description: 'URL (or owner/repo#123 on GitHub).' },
              title: { type: 'string', description: "Optional. The work item's title, if known." }
            },
            required: ['url']
          }
        },
        unlink: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs of linked work items to remove.'
        },
        replace: {
          type: 'boolean',
          description:
            'Replace all current links with "workItems" instead of adding to them. ' +
            'Pass true with an empty "workItems" to remove every link.'
        }
      }
    },
    skipPermission: true,
    handler: run((args, thread) => {
      if (
        args.replace !== undefined &&
        args.replace !== null &&
        typeof args.replace !== 'boolean'
      ) {
        throw new ToolInputError('"replace" must be a boolean.')
      }
      const replace = args.replace === true
      const links = readLinks(args)
      const unlinks = new Set(readUnlinks(args))
      if (!replace && links.length === 0 && unlinks.size === 0) {
        return success({ workItems: (thread.workItems ?? []).map(toView) })
      }

      const next = new Map<string, ThreadWorkItem>()
      if (!replace) for (const item of thread.workItems ?? []) next.set(item.url, item)
      for (const item of links) {
        const existing = next.get(item.url)
        next.set(item.url, { ...item, title: item.title ?? existing?.title })
      }
      for (const url of unlinks) next.delete(url)
      const workItems = [...next.values()].map(({ title, ...item }) =>
        title ? { ...item, title } : item
      )
      if (workItems.length > MAX_THREAD_WORK_ITEMS) {
        return failure(`A thread can be linked to at most ${MAX_THREAD_WORK_ITEMS} work items.`)
      }
      if (!dependencies.setWorkItems(workItems)) {
        return failure('The work items could not be saved.')
      }
      dependencies.onThreadChanged()
      return success({ workItems: (thread.workItems ?? []).map(toView) })
    })
  }

  return [settleThread, linkWorkItems]
}
