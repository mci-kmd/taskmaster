import type {
  SidebarContextMenuAction,
  SidebarContextMenuRequest,
  ThreadSnapshot
} from './app-types'

type ThreadMenuOptions = Pick<
  SidebarContextMenuRequest,
  | 'settled'
  | 'convertToWorktreeVisible'
  | 'convertToWorktreeEnabled'
  | 'closeThreadEnabled'
  | 'regenerateTitleEnabled'
>

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
): Array<{ action: SidebarContextMenuAction; label: string; enabled: boolean }> {
  const regenerateTitleEnabled = options.regenerateTitleEnabled !== false
  const actions: Array<{ action: SidebarContextMenuAction; label: string; enabled: boolean }> = [
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
