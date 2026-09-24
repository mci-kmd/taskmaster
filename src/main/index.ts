import { app, dialog, shell, BrowserWindow, type MessageBoxOptions } from 'electron'
import { join } from 'path'
import { createQuitGuard } from './quit-guard'
import { createModelPerformanceStore } from './copilot/model-performance-store'
import { IPC_CHANNELS } from '../shared/contracts/ipc'
import { sendIpc } from './ipc/typed-ipc'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import iconIco from '../../build/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { isDevMode } from '../shared/runtime-mode'
import { resolveDevUserDataPath } from './dev-user-data-path'
import { registerTerminalIpc } from './terminal'
import {
  initializeAppState,
  getCopilotModelDefaults,
  rememberCopilotModelSelection,
  markCopilotSessionStarted,
  updateCopilotActivity,
  registerAppStateIpc,
  resolveCopilotThread,
  setCopilotThreadController,
  updateCopilotLastUserMessage,
  updateCopilotThreadTitle
} from './app-state'
import { registerNativeMenuIpc } from './native-menu'
import { createCopilotSessionService } from './copilot/copilot-session-service'
import { registerCopilotIpc } from './copilot/copilot-ipc'

const devUserDataPath = resolveDevUserDataPath(app.getPath('appData'), isDevMode)
if (devUserDataPath) {
  app.setPath('userData', devUserDataPath)
}

let quitGuard: ReturnType<typeof createQuitGuard> | null = null

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

  mainWindow.on('close', (event) => quitGuard?.windowClose(event))

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
  let copilotSessionService: ReturnType<typeof createCopilotSessionService> | null = null
  const guard = createQuitGuard({
    getRunningThreads: () => copilotSessionService?.runningThreadNames() ?? [],
    confirmQuit: async (threads) => {
      const options: MessageBoxOptions = {
        type: 'warning',
        title: 'Quit Taskmaster?',
        message:
          threads.length === 1
            ? 'Copilot is still working in 1 thread.'
            : `Copilot is still working in ${threads.length} threads.`,
        detail: `${threads.map((name) => `• ${name}`).join('\n')}\n\nQuitting stops this work.`,
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      }
      const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options)
      return result.response === 0
    },
    quit: () => app.quit(),
    platform: process.platform
  })
  quitGuard = guard
  // Runs before every other quit listener so a cancelled quit skips their cleanup.
  app.prependListener('before-quit', guard.beforeQuit)
  initializeAppState()
  registerAppStateIpc()
  registerNativeMenuIpc()
  registerTerminalIpc()
  const performanceStore = createModelPerformanceStore(
    join(app.getPath('userData'), 'model-performance.json')
  )
  const copilotService = createCopilotSessionService({
    getPerformanceSamples: performanceStore.getSamples,
    recordPerformanceSample: (sample) => {
      try {
        performanceStore.addSample(sample)
      } finally {
        for (const window of BrowserWindow.getAllWindows()) {
          sendIpc(window.webContents, IPC_CHANNELS.copilot.performanceSample, { sample })
        }
      }
    },
    getModelDefaults: getCopilotModelDefaults,
    onModelSelected: rememberCopilotModelSelection,
    resolveThread: resolveCopilotThread,
    onSessionStarted: markCopilotSessionStarted,
    onTitleChanged: updateCopilotThreadTitle,
    onUserMessage: updateCopilotLastUserMessage,
    onActivity: updateCopilotActivity
  })
  copilotSessionService = copilotService
  setCopilotThreadController({
    stop: copilotService.stopThread,
    has: copilotService.hasSession
  })
  registerCopilotIpc(copilotService)
  let copilotShutdownComplete = false
  app.on('before-quit', (event) => {
    if (copilotShutdownComplete || event.defaultPrevented) return
    event.preventDefault()
    void copilotService.shutdown().finally(() => {
      copilotShutdownComplete = true
      app.quit()
    })
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
