import type {
  SidebarContextMenuAction,
  SidebarContextMenuRequest,
  ThreadSnapshot
} from './app-types'

type ThreadMenuOptions = Pick<
  SidebarContextMenuRequest,
  | 'inboxThread'
  | 'settled'
  | 'convertToWorktreeVisible'
  | 'convertToWorktreeEnabled'
  | 'closeThreadEnabled'
>

export function inboxThreadMenuOptions(
  thread: ThreadSnapshot,
  convertingThread: boolean
): ThreadMenuOptions {
  return {
    inboxThread: true,
    settled: Boolean(thread.settledAt),
    convertToWorktreeVisible: thread.mode !== 'worktree',
    convertToWorktreeEnabled: !convertingThread,
    closeThreadEnabled: false
  }
}

export function threadMenuActions(
  options: ThreadMenuOptions
): Array<{ action: SidebarContextMenuAction; label: string; enabled: boolean }> {
  const actions: Array<{ action: SidebarContextMenuAction; label: string; enabled: boolean }> = [
    { action: 'edit', label: 'Edit', enabled: true }
  ]
  if (options.convertToWorktreeVisible) {
    actions.push({
      action: 'convert-to-worktree',
      label: options.convertToWorktreeEnabled ? 'Convert to work tree' : 'Converting...',
      enabled: options.convertToWorktreeEnabled
    })
  }
  actions.push(
    options.inboxThread
      ? {
          action: options.settled ? 'unsettle-thread' : 'settle-thread',
          label: options.settled ? 'Unsettle thread' : 'Settle thread',
          enabled: true
        }
      : {
          action: 'close-thread',
          label: options.closeThreadEnabled ? 'Close thread' : 'Closing...',
          enabled: options.closeThreadEnabled
        }
  )
  return actions
}
