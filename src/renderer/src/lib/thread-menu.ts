import type { ThreadSnapshot } from '../../../shared/app-types'

/** What a thread's right-click menu can do. */
export type ThreadMenuAction =
  | 'edit'
  | 'regenerate-title'
  | 'fork-thread'
  | 'convert-to-worktree'
  | 'snooze'
  | 'snooze-hour'
  | 'snooze-tomorrow'
  | 'snooze-next-week'
  | 'snooze-custom'
  | 'unsnooze'
  | 'close-thread'
  | 'settle-thread'
  | 'unsettle-thread'

/** A menu entry; one with `children` is a submenu. */
export type ThreadMenuEntry = {
  action: ThreadMenuAction
  label: string
  enabled: boolean
  children?: ThreadMenuEntry[]
}

export type ThreadMenuOptions = {
  settled?: boolean
  /** Whether the thread is snoozed. */
  snoozed?: boolean
  convertToWorktreeVisible: boolean
  convertToWorktreeEnabled: boolean
  closeThreadEnabled: boolean
  /** False while a title is being written. */
  regenerateTitleEnabled?: boolean
  /** Whether the thread has a Copilot conversation to fork. */
  forkThreadEnabled?: boolean
}

export function threadMenuOptions(
  thread: ThreadSnapshot,
  convertingThread: boolean,
  closingThread: boolean,
  regeneratingTitle = false
): ThreadMenuOptions {
  return {
    settled: Boolean(thread.settledAt),
    snoozed: Boolean(thread.snoozedUntil) && !thread.settledAt,
    convertToWorktreeVisible: thread.mode !== 'worktree' && thread.projectKind !== 'general',
    convertToWorktreeEnabled: !convertingThread,
    closeThreadEnabled: !closingThread,
    regenerateTitleEnabled: !regeneratingTitle,
    forkThreadEnabled: Boolean(thread.resumeSessionId)
  }
}

export function threadMenuActions(options: ThreadMenuOptions): ThreadMenuEntry[] {
  const regenerateTitleEnabled = options.regenerateTitleEnabled !== false
  const actions: ThreadMenuEntry[] = [
    { action: 'edit', label: 'Edit', enabled: true },
    {
      action: 'regenerate-title',
      label: regenerateTitleEnabled ? 'Regenerate title' : 'Writing title...',
      enabled: regenerateTitleEnabled
    },
    { action: 'fork-thread', label: 'Fork thread', enabled: options.forkThreadEnabled === true }
  ]
  if (options.convertToWorktreeVisible) {
    actions.push({
      action: 'convert-to-worktree',
      label: options.convertToWorktreeEnabled ? 'Convert to work tree' : 'Converting...',
      enabled: options.convertToWorktreeEnabled
    })
  }
  if (!options.settled) {
    actions.push({
      action: 'snooze',
      label: options.snoozed ? 'Snooze again' : 'Snooze',
      enabled: true,
      children: [
        { action: 'snooze-hour', label: '1 hour', enabled: true },
        { action: 'snooze-tomorrow', label: 'Tomorrow', enabled: true },
        { action: 'snooze-next-week', label: 'Next week', enabled: true },
        { action: 'snooze-custom', label: 'Custom...', enabled: true }
      ]
    })
    if (options.snoozed) actions.push({ action: 'unsnooze', label: 'Unsnooze', enabled: true })
  }
  actions.push(
    {
      action: options.settled ? 'unsettle-thread' : 'settle-thread',
      label: options.settled ? 'Unsettle thread' : 'Settle thread',
      enabled: true
    },
    {
      action: 'close-thread',
      label: options.closeThreadEnabled ? 'Close thread' : 'Closing...',
      enabled: options.closeThreadEnabled
    }
  )
  return actions
}
