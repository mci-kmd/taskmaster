import type { ThreadSnapshot } from '../../../shared/app-types'

/** What a thread's menu (its ··· button or right-click) can do. */
export type ThreadMenuAction =
  | 'edit'
  | 'regenerate-title'
  | 'convert-to-worktree'
  | 'close-thread'
  | 'settle-thread'
  | 'unsettle-thread'

export type ThreadMenuOptions = {
  settled?: boolean
  convertToWorktreeVisible: boolean
  convertToWorktreeEnabled: boolean
  closeThreadEnabled: boolean
  /** False while a title is being written. */
  regenerateTitleEnabled?: boolean
}

export function threadMenuOptions(
  thread: ThreadSnapshot,
  convertingThread: boolean,
  closingThread: boolean,
  regeneratingTitle = false
): ThreadMenuOptions {
  return {
    settled: Boolean(thread.settledAt),
    convertToWorktreeVisible: thread.mode !== 'worktree' && thread.projectKind !== 'general',
    convertToWorktreeEnabled: !convertingThread,
    closeThreadEnabled: !closingThread,
    regenerateTitleEnabled: !regeneratingTitle
  }
}

export function threadMenuActions(
  options: ThreadMenuOptions
): Array<{ action: ThreadMenuAction; label: string; enabled: boolean }> {
  const regenerateTitleEnabled = options.regenerateTitleEnabled !== false
  const actions: Array<{ action: ThreadMenuAction; label: string; enabled: boolean }> = [
    { action: 'edit', label: 'Edit', enabled: true },
    {
      action: 'regenerate-title',
      label: regenerateTitleEnabled ? 'Regenerate title' : 'Writing title...',
      enabled: regenerateTitleEnabled
    }
  ]
  if (options.convertToWorktreeVisible) {
    actions.push({
      action: 'convert-to-worktree',
      label: options.convertToWorktreeEnabled ? 'Convert to work tree' : 'Converting...',
      enabled: options.convertToWorktreeEnabled
    })
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
