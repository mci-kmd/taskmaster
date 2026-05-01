import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from 'xterm'
import type { AppSettingsSnapshot, TerminalStatus, ThreadSnapshot } from '../../../shared/app-types'

export type SessionPhase = 'initializing' | 'idle' | 'launching' | 'running' | 'stopped' | 'error'

export type TerminalPaneState = {
  copilotStatus: TerminalStatus | null
  phase: SessionPhase
  exitCode: number | null
  errorMessage: string | null
}

export type TerminalPaneHandle = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

type TerminalPaneProps = {
  selectedThread: ThreadSnapshot | null
  settings: AppSettingsSnapshot | null
  onRefresh: () => Promise<void>
  onStateChange?: (state: TerminalPaneState) => void
}

type LaunchMode = 'new' | 'resume'

type LaunchAttempt = {
  terminalId: string
  threadId: string
  mode: LaunchMode
  sessionName: string
  buffer: string
  retriedFromMissingSession: boolean
}

function buildLaunchArgs(sessionName: string, globalFlags: string[], mode: LaunchMode): string[] {
  const launchFlag = mode === 'resume' ? `--resume=${sessionName}` : `--name=${sessionName}`
  return [launchFlag, ...globalFlags]
}

function isMissingNamedSessionError(output: string): boolean {
  return /No session, task, or name matched/i.test(output)
}

const TERMINAL_THEME = {
  background: '#141414',
  foreground: '#dcdcdc',
  cursor: '#ededed',
  cursorAccent: '#141414',
  selectionBackground: '#2e2e2e',
  black: '#1c1c1c',
  red: '#f08c8c',
  green: '#94c594',
  yellow: '#e6c884',
  blue: '#9bb6e0',
  magenta: '#c1a4d8',
  cyan: '#8fc4cc',
  white: '#dcdcdc',
  brightBlack: '#5a5a5a',
  brightRed: '#f5a8a8',
  brightGreen: '#b3d6b3',
  brightYellow: '#ecd6a4',
  brightBlue: '#b6c8e6',
  brightMagenta: '#d3bce4',
  brightCyan: '#a9d2d8',
  brightWhite: '#ededed'
}

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { selectedThread, settings, onRefresh, onStateChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const launchAttemptRef = useRef<LaunchAttempt | null>(null)
  const latestSelectedThreadRef = useRef<ThreadSnapshot | null>(selectedThread)
  const latestSettingsRef = useRef<AppSettingsSnapshot | null>(settings)
  const latestCopilotStatusRef = useRef<TerminalStatus | null>(null)
  const latestOnStateChangeRef = useRef(onStateChange)
  const [copilotStatus, setCopilotStatus] = useState<TerminalStatus | null>(null)
  const [phase, setPhase] = useState<SessionPhase>('initializing')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const selectedThreadId = selectedThread?.id ?? null

  useEffect(() => {
    latestSelectedThreadRef.current = selectedThread
  }, [selectedThread])

  useEffect(() => {
    latestSettingsRef.current = settings
  }, [settings])

  useEffect(() => {
    latestCopilotStatusRef.current = copilotStatus
  }, [copilotStatus])

  useEffect(() => {
    latestOnStateChangeRef.current = onStateChange
  }, [onStateChange])

  useEffect(() => {
    latestOnStateChangeRef.current?.({ copilotStatus, phase, exitCode, errorMessage })
  }, [copilotStatus, phase, exitCode, errorMessage])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const container = containerRef.current
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'Geist Mono Variable', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      letterSpacing: 0,
      scrollback: 5000,
      theme: TERMINAL_THEME
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()

    const handlePointerDown = (): void => {
      terminal.focus()
    }

    container.addEventListener('pointerdown', handlePointerDown)

    const syncSize = (): void => {
      fitAddon.fit()

      if (!terminalIdRef.current) {
        return
      }

      window.api.terminal.resize(terminalIdRef.current, terminal.cols, terminal.rows)
    }

    const resizeObserver = new ResizeObserver(() => {
      syncSize()
    })

    resizeObserver.observe(container)

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!terminalRef.current || !fitAddonRef.current) {
          return
        }
        syncSize()
      })
    }

    const launchCopilot = async (
      thread: ThreadSnapshot,
      appSettings: AppSettingsSnapshot,
      mode: LaunchMode,
      options?: { retriedFromMissingSession?: boolean }
    ): Promise<boolean> => {
      const activeTerminal = terminalRef.current
      const activeFitAddon = fitAddonRef.current

      if (
        !activeTerminal ||
        !activeFitAddon ||
        !latestCopilotStatusRef.current?.available ||
        terminalIdRef.current
      ) {
        return false
      }

      setPhase('launching')
      setErrorMessage(null)

      if (!options?.retriedFromMissingSession) {
        activeTerminal.reset()
        activeFitAddon.fit()
      }

      const args = buildLaunchArgs(thread.sessionName, appSettings.parsedGlobalFlags, mode)
      const result = await window.api.terminal.create({
        threadId: thread.id,
        cols: activeTerminal.cols,
        rows: activeTerminal.rows,
        cwd: thread.cwd,
        args
      })

      if (!result.ok) {
        launchAttemptRef.current = null
        setPhase('error')
        setErrorMessage(result.error)
        return false
      }

      terminalIdRef.current = result.terminalId
      launchAttemptRef.current = {
        terminalId: result.terminalId,
        threadId: thread.id,
        mode,
        sessionName: thread.sessionName,
        buffer: '',
        retriedFromMissingSession: options?.retriedFromMissingSession ?? false
      }
      setExitCode(null)
      setErrorMessage(null)
      setPhase('running')
      activeTerminal.focus()
      await onRefresh()
      return true
    }

    const handleTerminalExit = async (code: number): Promise<void> => {
      const attempt = launchAttemptRef.current

      terminalIdRef.current = null
      launchAttemptRef.current = null

      if (
        attempt &&
        attempt.mode === 'resume' &&
        !attempt.retriedFromMissingSession &&
        code === 1 &&
        isMissingNamedSessionError(attempt.buffer)
      ) {
        const thread = latestSelectedThreadRef.current
        const appSettings = latestSettingsRef.current

        if (thread && appSettings && thread.id === attempt.threadId) {
          const relaunched = await launchCopilot(thread, appSettings, 'new', {
            retriedFromMissingSession: true
          })

          if (relaunched) {
            return
          }
        }
      }

      setExitCode(code)
      setPhase('stopped')
      await onRefresh()
    }

    const dataCleanup = window.api.terminal.onData((payload) => {
      if (payload.terminalId !== terminalIdRef.current) {
        return
      }

      if (launchAttemptRef.current?.terminalId === payload.terminalId) {
        launchAttemptRef.current.buffer += payload.data
      }

      terminal.write(payload.data)
    })

    const exitCleanup = window.api.terminal.onExit((payload) => {
      if (payload.terminalId !== terminalIdRef.current) {
        return
      }

      void handleTerminalExit(payload.exitCode)
    })

    const disposable = terminal.onData((data) => {
      if (!terminalIdRef.current) {
        return
      }

      window.api.terminal.input(terminalIdRef.current, data)
    })

    void window.api.terminal.getStatus().then((status) => {
      setCopilotStatus(status)
      setPhase('idle')
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      resizeObserver.disconnect()
      exitCleanup()
      dataCleanup()
      disposable.dispose()

      if (terminalIdRef.current) {
        void window.api.terminal.kill(terminalIdRef.current)
        terminalIdRef.current = null
        launchAttemptRef.current = null
      }

      terminal.dispose()
    }
  }, [onRefresh])

  // Reset on thread change: kill any running session and clear xterm.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const reset = async (): Promise<void> => {
      if (terminalIdRef.current) {
        await window.api.terminal.kill(terminalIdRef.current)
        terminalIdRef.current = null
        launchAttemptRef.current = null
      }
      terminal.reset()
      setExitCode(null)
      setErrorMessage(null)
      // Only flip back to 'idle' if we already finished initializing.
      setPhase((current) => (current === 'initializing' ? current : 'idle'))
    }

    void reset()
  }, [selectedThreadId])

  const startCopilot = async (): Promise<void> => {
    const thread = latestSelectedThreadRef.current
    const appSettings = latestSettingsRef.current
    const status = latestCopilotStatusRef.current

    if (!thread || !appSettings || !status?.available) {
      return
    }

    if (terminalIdRef.current) {
      return
    }

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (!terminal || !fitAddon) {
      return
    }

    setPhase('launching')
    setErrorMessage(null)
    terminal.reset()
    fitAddon.fit()

    const mode: LaunchMode = thread.hasLaunched ? 'resume' : 'new'
    const args = buildLaunchArgs(thread.sessionName, appSettings.parsedGlobalFlags, mode)
    const result = await window.api.terminal.create({
      threadId: thread.id,
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: thread.cwd,
      args
    })

    if (!result.ok) {
      launchAttemptRef.current = null
      setPhase('error')
      setErrorMessage(result.error)
      return
    }

    terminalIdRef.current = result.terminalId
    launchAttemptRef.current = {
      terminalId: result.terminalId,
      threadId: thread.id,
      mode,
      sessionName: thread.sessionName,
      buffer: '',
      retriedFromMissingSession: false
    }
    setExitCode(null)
    setErrorMessage(null)
    setPhase('running')
    terminal.focus()
    await onRefresh()
  }

  const stopCopilot = async (): Promise<void> => {
    if (!terminalIdRef.current) {
      return
    }

    await window.api.terminal.kill(terminalIdRef.current)
    terminalIdRef.current = null
    launchAttemptRef.current = null
    setPhase('idle')
    setExitCode(null)
    setErrorMessage(null)
    await onRefresh()
  }

  useImperativeHandle(
    ref,
    () => ({
      start: startCopilot,
      stop: stopCopilot
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copilotStatus?.available, phase, selectedThreadId]
  )

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#141414]">
      <div className="h-full w-full px-3 py-3" ref={containerRef} />
    </div>
  )
})

export default TerminalPane
