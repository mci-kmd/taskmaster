import { join } from 'path'
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue
} from 'electron'
import type { PersistedRepository } from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { sendIpc } from '../ipc/typed-ipc'
import { sanitizeUserFacingMessage } from '../features/shared/user-facing-messages'

export type ThreadCloseMessageBoxOptions = Pick<
  MessageBoxOptions,
  'type' | 'buttons' | 'defaultId' | 'cancelId' | 'title' | 'message' | 'detail'
>

export type ThreadRunFailureNotifier = (
  title: string,
  message: string,
  detail: string
) => Promise<void>

export const electronUi = {
  showMessageBox: (options: ThreadCloseMessageBoxOptions): Promise<MessageBoxReturnValue> =>
    dialog.showMessageBox(options),

  selectRepositoryDirectory: (): Promise<OpenDialogReturnValue> =>
    dialog.showOpenDialog({
      title: 'Add repository',
      properties: ['openDirectory']
    }),

  pickRepositoryFaviconFile: async (
    repository: PersistedRepository
  ): Promise<OpenDialogReturnValue> => {
    const ownerWindow = BrowserWindow.getFocusedWindow() ?? null
    const dialogOptions: OpenDialogOptions = {
      title: `Choose favicon for ${repository.name}`,
      defaultPath: join(repository.path, 'favicon.ico'),
      filters: [
        {
          name: 'Image files',
          extensions: ['bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']
        }
      ],
      properties: ['openFile']
    }

    return ownerWindow
      ? dialog.showOpenDialog(ownerWindow, dialogOptions)
      : dialog.showOpenDialog(dialogOptions)
  },

  showThreadRunFailure: async (title: string, message: string, detail: string): Promise<void> => {
    const ownerWindow =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ??
      null

    const options = {
      type: 'error' as const,
      buttons: ['OK'],
      defaultId: 0,
      title: sanitizeUserFacingMessage(title),
      message: sanitizeUserFacingMessage(message),
      detail: sanitizeUserFacingMessage(detail),
      noLink: true
    }

    if (ownerWindow) {
      await dialog.showMessageBox(ownerWindow, options)
      return
    }

    await dialog.showMessageBox(options)
  },

  broadcastThreadRunState: (threadId: string): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue
      }
      sendIpc(window.webContents, IPC_CHANNELS.appState.threadRunState, { threadId })
    }
  },

  openPath: (path: string): Promise<string> => shell.openPath(path),
  openExternal: (url: string): Promise<void> => shell.openExternal(url),
  getHomePath: (): string => app.getPath('home')
}
