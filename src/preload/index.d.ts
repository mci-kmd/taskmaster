import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface TerminalCreateRequest {
    cols: number
    rows: number
    cwd?: string
    args?: string[]
  }

  interface TerminalStatus {
    available: boolean
    commandPath?: string
    defaultCwd: string
    message: string
  }

  interface TerminalLaunchSuccess {
    ok: true
    terminalId: string
    cwd: string
    launchedCommand: string
  }

  interface TerminalLaunchFailure {
    ok: false
    error: string
  }

  type TerminalLaunchResult = TerminalLaunchSuccess | TerminalLaunchFailure

  interface TerminalDataEvent {
    terminalId: string
    data: string
  }

  interface TerminalExitEvent {
    terminalId: string
    exitCode: number
  }

  interface TerminalApi {
    getStatus: () => Promise<TerminalStatus>
    create: (request: TerminalCreateRequest) => Promise<TerminalLaunchResult>
    kill: (terminalId: string) => Promise<boolean>
    input: (terminalId: string, data: string) => void
    resize: (terminalId: string, cols: number, rows: number) => void
    onData: (callback: (payload: TerminalDataEvent) => void) => () => void
    onExit: (callback: (payload: TerminalExitEvent) => void) => () => void
  }

  interface Window {
    electron: ElectronAPI
    api: {
      terminal: TerminalApi
    }
  }
}

export {}
