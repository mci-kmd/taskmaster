import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import iconIco from '../../build/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { registerTerminalIpc } from './terminal'
import {
  initializeAppState,
  markThreadActivity,
  markThreadLaunched,
  markThreadStopped,
  registerAppStateIpc
} from './app-state'
import { registerNativeMenuIpc } from './native-menu'

function createWindow(): void {
  const windowIcon = process.platform === 'win32' ? iconIco : iconPng

  const mainWindow = new BrowserWindow({
    title: 'Taskmaster',
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#181818',
    ...(process.platform !== 'darwin' ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.taskmaster.app')
  initializeAppState()
  registerAppStateIpc()
  registerNativeMenuIpc()
  registerTerminalIpc({
    onThreadStart: markThreadLaunched,
    onThreadActivity: markThreadActivity,
    onThreadStop: markThreadStopped
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
