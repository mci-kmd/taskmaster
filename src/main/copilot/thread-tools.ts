import type { Tool, ToolResultObject } from '@github/copilot-sdk'
import type { PersistedThread, ThreadWorkItem } from '../../shared/app-types'
import { SNOOZE_PRESETS, isSnoozePreset, snoozeUntil } from '../../shared/snooze'
import {
  MAX_THREAD_TASKS,
  MAX_THREAD_WORK_ITEMS,
  WORK_ITEM_INPUT_HINT,
  formatWorkItemReference,
  normalizeWorkItemTitle,
  parseWorkItemReference
} from '../../shared/work-items'

/** A task of the thread's project, as the link tool reports it. */
export type LinkableTask = { title: string; status: 'open' | 'completed' }

export type ThreadToolDependencies = {
  /** The session's thread, looked up on every call. */
  resolveThread: () => PersistedThread | undefined
  settleThread: () => boolean
  /** Snoozes the thread until the given time; returns an error message on failure. */
  snoozeThread: (until: Date) => string | null
  setWorkItems: (workItems: ThreadWorkItem[]) => boolean
  /** Looks up a task of the thread's project by its number. */
  findTask: (number: number) => LinkableTask | undefined
  setTaskNumbers: (taskNumbers: number[]) => boolean
  /** Makes open windows refresh their snapshot. */
  onThreadChanged: () => void
  now?: () => Date
}

export const THREAD_TOOL_NAMES = {
  settle: 'taskmaster_settle_thread',
  snooze: 'taskmaster_snooze_thread',
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

function readTaskNumbers(args: Args, key: 'tasks' | 'unlinkTasks'): number[] {
  const value = args[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ToolInputError(`"${key}" must be an array of task ids.`)
  return value.map((entry, index) => {
    const number =
      typeof entry === 'number'
        ? entry
        : typeof entry === 'string' && /^\s*#?\d+\s*$/.test(entry)
          ? Number(entry.replace('#', ''))
          : NaN
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new ToolInputError(`${key}[${index}] must be a task id, e.g. 12 for task #12.`)
    }
    return number
  })
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

  const snoozeThread: Tool = {
    name: THREAD_TOOL_NAMES.snooze,
    description:
      "Snooze the Taskmaster thread this conversation belongs to: it leaves the user's inbox " +
      'of active threads until the chosen time, then returns to the top marked Awakened. ' +
      'NEVER call this on your own initiative. Only call it when the user has explicitly asked ' +
      'you to snooze this thread, for example "remind me about this tomorrow" or "snooze ' +
      'yourself until next week". When asked to do so after some work, finish all of that work ' +
      'first and call this as the very last step. Any time can be given with "until" (e.g. ' +
      '"Friday at 14:00" or "in 3 hours"). The presets exist so that common vague phrases mean ' +
      'the same as in the thread menu instead of being reinterpreted each time: "hour" is one ' +
      'hour from now, "tomorrow" is tomorrow at 08:00, and "next-week" is next Monday at 08:00 ' +
      '(a full week ahead on a Monday). ALWAYS use the matching preset when the user asks for ' +
      'one of these (e.g. "next week" means preset "next-week", not a date you work out ' +
      'yourself); use "until" for everything else. A new prompt from the user ends the snooze.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        preset: {
          type: 'string',
          enum: [...SNOOZE_PRESETS],
          description:
            '"hour": in one hour; "tomorrow": tomorrow at 08:00; "next-week": next Monday at 08:00.'
        },
        until: {
          type: 'string',
          description:
            'A custom end time as an ISO 8601 date-time, e.g. "2026-03-05T14:30" (local time) ' +
            'or with an offset. Must be in the future. Do not combine with "preset".'
        }
      }
    },
    // Reversible from the UI, and a prompt would defeat "do X, then snooze yourself".
    skipPermission: true,
    handler: run((args, thread) => {
      const { preset, until } = args
      const hasPreset = preset !== undefined && preset !== null
      const hasUntil = until !== undefined && until !== null
      if (hasPreset === hasUntil) {
        throw new ToolInputError('Pass exactly one of "preset" or "until".')
      }
      if (thread.settledAt) return failure('Resolved threads cannot be snoozed.')
      const now = dependencies.now?.() ?? new Date()
      let end: Date
      if (hasPreset) {
        if (!isSnoozePreset(preset)) {
          throw new ToolInputError(`"preset" must be one of: ${SNOOZE_PRESETS.join(', ')}.`)
        }
        end = snoozeUntil(preset, now)
      } else {
        end = new Date(typeof until === 'string' ? until : Number.NaN)
        if (Number.isNaN(end.getTime())) {
          throw new ToolInputError('"until" must be an ISO 8601 date-time.')
        }
      }
      const error = dependencies.snoozeThread(end)
      if (error) return failure(error)
      dependencies.onThreadChanged()
      return success({
        message: 'Snoozed this thread.',
        snoozedUntil: end.toISOString(),
        snoozedUntilLocal: end.toString()
      })
    })
  }

  const currentLinks = (thread: PersistedThread): Record<string, unknown> => ({
    workItems: (thread.workItems ?? []).map(toView),
    tasks: (thread.taskNumbers ?? []).map((number) => {
      const task = dependencies.findTask(number)
      return task ? { id: number, title: task.title, status: task.status } : { id: number }
    })
  })

  const linkWorkItems: Tool = {
    name: THREAD_TOOL_NAMES.linkWorkItems,
    description:
      'Link the Taskmaster thread this conversation belongs to with the GitHub issues or pull ' +
      'requests, Azure DevOps work items and Taskmaster tasks being worked on in it. Taskmaster ' +
      "shows the links on the thread's card, and the user cannot edit them by hand, so this tool " +
      'is the only way they get linked. ALWAYS call this automatically, without being asked and ' +
      'without asking first, whenever this thread works on a specific work item or task: when ' +
      'the user asks you to implement, fix, review or investigate an issue, pull request, work ' +
      'item or Taskmaster task (e.g. "implement #12"); when you create a pull request or issue ' +
      'for the work; or when you pick up a Taskmaster task. Link Taskmaster tasks by their id ' +
      'in "tasks", and also link the GitHub issue a task is linked to, if any. Do it as soon as ' +
      'you know the URL or task id, before or while starting the work, not as an afterthought. ' +
      'Linking an item twice is harmless, so when in doubt, link it. Also call it when the user ' +
      'asks to change the links. Do not link items that are merely mentioned for context and ' +
      'not worked on. Returns the current links. ' +
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
        tasks: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: "Ids of this project's Taskmaster tasks to link (12 for task #12)."
        },
        unlink: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs of linked work items to remove.'
        },
        unlinkTasks: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: 'Ids of linked Taskmaster tasks to remove.'
        },
        replace: {
          type: 'boolean',
          description:
            'Replace all current links with "workItems" and "tasks" instead of adding to them. ' +
            'Pass true with nothing else to remove every link.'
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
      const taskLinks = readTaskNumbers(args, 'tasks')
      const taskUnlinks = new Set(readTaskNumbers(args, 'unlinkTasks'))
      if (
        !replace &&
        links.length === 0 &&
        unlinks.size === 0 &&
        taskLinks.length === 0 &&
        taskUnlinks.size === 0
      ) {
        return success(currentLinks(thread))
      }
      const unknownTask = taskLinks.find((number) => !dependencies.findTask(number))
      if (unknownTask !== undefined) {
        return failure(`There is no task #${unknownTask} in this project.`)
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
      const taskNumbers = [
        ...new Set([...(replace ? [] : (thread.taskNumbers ?? [])), ...taskLinks])
      ].filter((number) => !taskUnlinks.has(number))
      if (taskNumbers.length > MAX_THREAD_TASKS) {
        return failure(`A thread can be linked to at most ${MAX_THREAD_TASKS} tasks.`)
      }
      if (!dependencies.setWorkItems(workItems)) {
        return failure('The work items could not be saved.')
      }
      if (!dependencies.setTaskNumbers(taskNumbers)) {
        return failure('The tasks could not be saved.')
      }
      dependencies.onThreadChanged()
      return success(currentLinks(thread))
    })
  }
  return [settleThread, snoozeThread, linkWorkItems]
}
