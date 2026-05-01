import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from 'xterm'
import type { AppSettingsSnapshot, TerminalStatus, ThreadSnapshot } from '../../../shared/app-types'

export type TerminalPaneState = {
  copilotStatus: TerminalStatus | null
  isRunning: boolean
  isLaunching: boolean
  launchSummary: string
}

export type TerminalPaneHandle = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

type TerminalPaneProps = {
  selectedThread: ThreadSnapshot | null
  settings: AppSettingsSnapshot | null
  onRefresh: () => Promise<void>
  onFeedback: (tone: 'error' | 'success' | 'info', message: string) => void
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
  { selectedThread, settings, onRefresh, onFeedback, onStateChange },
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
  const latestOnFeedbackRef = useRef(onFeedback)
  const latestOnStateChangeRef = useRef(onStateChange)
  const [copilotStatus, setCopilotStatus] = useState<TerminalStatus | null>(null)
  const [isLaunching, setIsLaunching] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [launchSummary, setLaunchSummary] = useState('Waiting for Copilot CLI check...')
  const selectedThreadId = selectedThread?.id ?? null
  const selectedThreadTitle = selectedThread?.title ?? null
  const selectedThreadCwd = selectedThread?.cwd ?? null
  const selectedThreadSessionName = selectedThread?.sessionName ?? null
  const selectedThreadBranch = selectedThread?.displayBranchName ?? null

  const selectedThreadSummary = useMemo(() => {
    if (!selectedThreadTitle || !selectedThreadCwd) {
      return 'Select a thread to launch Copilot in-app.'
    }

    return `${selectedThreadTitle} · ${selectedThreadCwd}`
  }, [selectedThreadCwd, selectedThreadTitle])

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
    latestOnFeedbackRef.current = onFeedback
  }, [onFeedback])

  useEffect(() => {
    latestOnStateChangeRef.current = onStateChange
  }, [onStateChange])

  useEffect(() => {
    latestOnStateChangeRef.current?.({ copilotStatus, isLaunching, isRunning, launchSummary })
  }, [copilotStatus, isLaunching, isRunning, launchSummary])

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
    terminal.focus()

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

      setIsLaunching(true)

      if (!options?.retriedFromMissingSession) {
        activeTerminal.reset()
        activeTerminal.writeln('[38;5;245m[taskmaster][0m launching copilot…')
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

      setIsLaunching(false)

      if (!result.ok) {
        launchAttemptRef.current = null
        setLaunchSummary(result.error)
        activeTerminal.writeln(result.error)
        latestOnFeedbackRef.current('error', result.error)
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
      setIsRunning(true)
      setLaunchSummary(`Running ${result.launchedCommand}`)
      activeTerminal.focus()
      await onRefresh()
      return true
    }

    const handleTerminalExit = async (exitCode: number): Promise<void> => {
      const attempt = launchAttemptRef.current
      const activeTerminal = terminalRef.current

      terminalIdRef.current = null
      launchAttemptRef.current = null
      setIsRunning(false)

      if (
        attempt &&
        attempt.mode === 'resume' &&
        !attempt.retriedFromMissingSession &&
        exitCode === 1 &&
        isMissingNamedSessionError(attempt.buffer)
      ) {
        const thread = latestSelectedThreadRef.current
        const appSettings = latestSettingsRef.current

        if (activeTerminal) {
          activeTerminal.writeln('')
          activeTerminal.writeln(
            '[38;5;245m[taskmaster][0m saved session not found — starting fresh…'
          )
        }

        if (thread && appSettings && thread.id === attempt.threadId) {
          const relaunched = await launchCopilot(thread, appSettings, 'new', {
            retriedFromMissingSession: true
          })

          if (relaunched) {
            return
          }
        }
      }

      setLaunchSummary(`Session exited (code ${exitCode}).`)

      if (activeTerminal) {
        activeTerminal.writeln('')
        activeTerminal.writeln(`[38;5;245m[taskmaster][0m session exited with code ${exitCode}.`)
      }

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
      setIsLaunching(false)
      setLaunchSummary(status.message)
      terminal.writeln('[38;5;245m[taskmaster][0m terminal ready.')
      terminal.writeln('')
      terminal.writeln(status.message)
      terminal.writeln(`[38;5;245m[taskmaster][0m launch cwd: ${status.defaultCwd}`)
      terminal.writeln('[38;5;245m[taskmaster][0m select a thread, then launch.')
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

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const resetTerminal = async (): Promise<void> => {
      if (terminalIdRef.current) {
        await window.api.terminal.kill(terminalIdRef.current)
        terminalIdRef.current = null
        launchAttemptRef.current = null
      }

      terminal.reset()
      terminal.writeln('[38;5;245m[taskmaster][0m terminal ready.')
      terminal.writeln('')
      terminal.writeln(copilotStatus?.message ?? 'Resolving Copilot CLI availability…')
      terminal.writeln(selectedThreadSummary)

      if (selectedThreadSessionName && selectedThreadBranch) {
        terminal.writeln(`[38;5;245m[taskmaster][0m session: ${selectedThreadSessionName}`)
        terminal.writeln(`[38;5;245m[taskmaster][0m branch:  ${selectedThreadBranch}`)
      }

      setLaunchSummary(selectedThreadSummary)
      setIsRunning(false)
      terminal.focus()
    }

    void resetTerminal()
  }, [
    copilotStatus?.message,
    selectedThreadBranch,
    selectedThreadId,
    selectedThreadSessionName,
    selectedThreadSummary
  ])

  const startCopilot = async (): Promise<void> => {
    if (!copilotStatus?.available || !selectedThread || !settings || isRunning) {
      return
    }

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (!terminal || !fitAddon) {
      return
    }

    setIsLaunching(true)
    terminal.reset()
    terminal.writeln('[38;5;245m[taskmaster][0m launching copilot…')
    fitAddon.fit()

    const mode: LaunchMode = selectedThread.hasLaunched ? 'resume' : 'new'
    const args = buildLaunchArgs(selectedThread.sessionName, settings.parsedGlobalFlags, mode)
    const result = await window.api.terminal.create({
      threadId: selectedThread.id,
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: selectedThread.cwd,
      args
    })

    setIsLaunching(false)

    if (!result.ok) {
      launchAttemptRef.current = null
      setLaunchSummary(result.error)
      terminal.writeln(result.error)
      onFeedback('error', result.error)
      return
    }

    terminalIdRef.current = result.terminalId
    launchAttemptRef.current = {
      terminalId: result.terminalId,
      threadId: selectedThread.id,
      mode,
      sessionName: selectedThread.sessionName,
      buffer: '',
      retriedFromMissingSession: false
    }
    setIsRunning(true)
    setLaunchSummary(`Running ${result.launchedCommand}`)
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
    setIsRunning(false)
    await onRefresh()
  }

  useImperativeHandle(
    ref,
    () => ({
      start: startCopilot,
      stop: stopCopilot
    }),
    // startCopilot/stopCopilot close over latest state via refs/setters from React
    // and are recreated on every render; pin to selectedThread to refresh capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copilotStatus?.available, isRunning, selectedThread, settings]
  )

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#141414]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent"
      />
      <div className="h-full w-full px-3 py-3" ref={containerRef} />
    </div>
  )
})

export default TerminalPane
