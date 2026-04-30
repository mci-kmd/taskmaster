import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  CreateThreadInput,
  TerminalCreateRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  UpdateSettingsInput
} from '../shared/app-types'

const api = {
  appState: {
    getSnapshot: () => ipcRenderer.invoke('app-state:get-snapshot'),
    refresh: () => ipcRenderer.invoke('app-state:refresh'),
    addRepository: () => ipcRenderer.invoke('app-state:add-repository'),
    createThread: (input: CreateThreadInput) =>
      ipcRenderer.invoke('app-state:create-thread', input),
    closeThread: (threadId: string) => ipcRenderer.invoke('app-state:close-thread', threadId),
    updateSettings: (input: UpdateSettingsInput) =>
      ipcRenderer.invoke('app-state:update-settings', input),
    selectRepository: (repositoryId: string | null) =>
      ipcRenderer.invoke('app-state:select-repository', repositoryId),
    selectThread: (threadId: string | null) =>
      ipcRenderer.invoke('app-state:select-thread', threadId)
  },
  terminal: {
    getStatus: () => ipcRenderer.invoke('terminal:status'),
    create: (request: TerminalCreateRequest) => ipcRenderer.invoke('terminal:create', request),
    kill: (terminalId: string) => ipcRenderer.invoke('terminal:kill', terminalId),
    input: (terminalId: string, data: string) =>
      ipcRenderer.send('terminal:input', { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', { terminalId, cols, rows }),
    onData: (callback: (payload: TerminalDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void =>
        callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.off('terminal:data', listener)
    },
    onExit: (callback: (payload: TerminalExitEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void =>
        callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.off('terminal:exit', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = window as Window &
    typeof globalThis & {
      electron: typeof electronAPI
      api: typeof api
    }

  globalWindow.electron = electronAPI
  globalWindow.api = api
}
