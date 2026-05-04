import {
  BrowserWindow,
  ipcMain,
  Menu,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import type {
  SidebarContextMenuAction,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest
} from '../shared/app-types'

const SHOW_SIDEBAR_CONTEXT_MENU_CHANNEL = 'native-menu:show-sidebar-context-menu'
const SIDEBAR_CONTEXT_MENU_ACTION_CHANNEL = 'native-menu:sidebar-context-menu-action'

function sendAction(
  event: IpcMainInvokeEvent,
  request: SidebarContextMenuRequest,
  action: SidebarContextMenuAction
): void {
  const payload: SidebarContextMenuActionEvent = {
    action,
    kind: request.kind,
    itemId: request.itemId
  }
  event.sender.send(SIDEBAR_CONTEXT_MENU_ACTION_CHANNEL, payload)
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

  return [
    {
      click: () => sendAction(event, request, 'edit'),
      label: 'Edit'
    },
    {
      click: () => sendAction(event, request, 'close-thread'),
      enabled: request.closeThreadEnabled,
      label: request.closeThreadEnabled ? 'Close thread' : 'Closing...'
    }
  ]
}

export function registerNativeMenuIpc(): void {
  ipcMain.handle(SHOW_SIDEBAR_CONTEXT_MENU_CHANNEL, (event, request: SidebarContextMenuRequest) => {
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
  })
}
