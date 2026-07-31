import {
  BrowserWindow,
  Menu,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import type { SidebarContextMenuAction, SidebarContextMenuRequest } from '../shared/app-types'
import { IPC_CHANNELS } from '../shared/contracts/ipc'
import { handleIpc, sendIpc } from './ipc/typed-ipc'

function sendAction(
  event: IpcMainInvokeEvent,
  request: SidebarContextMenuRequest,
  action: SidebarContextMenuAction
): void {
  sendIpc(event.sender, IPC_CHANNELS.nativeMenu.sidebarContextMenuAction, {
    action,
    kind: request.kind,
    itemId: request.itemId
  })
}

function buildSidebarContextMenuTemplate(
  event: IpcMainInvokeEvent,
  request: SidebarContextMenuRequest
): MenuItemConstructorOptions[] {
  if (request.kind === 'repository') {
    return [
      {
        click: () => sendAction(event, request, 'new-thread'),
        label: 'New thread'
      },
      {
        click: () => sendAction(event, request, 'edit'),
        label: 'Edit'
      }
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    {
      click: () => sendAction(event, request, 'edit'),
      label: 'Edit'
    }
  ]

  if (request.convertToWorktreeVisible) {
    template.push({
      click: () => sendAction(event, request, 'convert-to-worktree'),
      enabled: request.convertToWorktreeEnabled,
      label: request.convertToWorktreeEnabled ? 'Convert to work tree' : 'Converting...'
    })
  }

  template.push({
    click: () => sendAction(event, request, 'close-thread'),
    enabled: request.closeThreadEnabled,
    label: request.closeThreadEnabled ? 'Close thread' : 'Closing...'
  })
  return template
}

export function registerNativeMenuIpc(): void {
  handleIpc(
    IPC_CHANNELS.nativeMenu.showSidebarContextMenu,
    (event, request: SidebarContextMenuRequest) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || window.isDestroyed()) {
        return false
      }

      const menu = Menu.buildFromTemplate(buildSidebarContextMenuTemplate(event, request))
      menu.popup({
        window,
        x: Math.round(request.x),
        y: Math.round(request.y)
      })
      return true
    }
  )
}
