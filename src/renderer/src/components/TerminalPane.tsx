import { useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from 'xterm'
import type { AppSettingsSnapshot, TerminalStatus, ThreadSnapshot } from '../../../shared/app-types'

type TerminalPaneProps = {
  selectedThread: ThreadSnapshot | null
  settings: AppSettingsSnapshot | null
  onRefresh: () => Promise<void>
  onFeedback: (tone: 'error' | 'success' | 'info', message: string) => void
}

export default function TerminalPane({
  selectedThread,
  settings,
  onRefresh,
  onFeedback
}: TerminalPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const [copilotStatus, setCopilotStatus] = useState<TerminalStatus | null>(null)
  const [isLaunching, setIsLaunching] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [launchSummary, setLaunchSummary] = useState('Waiting for Copilot CLI check...')

  const selectedThreadSummary = useMemo(() => {
    if (!selectedThread) {
      return 'Select a thread to launch Copilot in-app.'
    }

    return `Selected thread "${selectedThread.title}" on ${selectedThread.cwd}`
  }, [selectedThread])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#020617',
        foreground: '#cbd5e1',
        cursor: '#22d3ee',
        cursorAccent: '#020617',
        selectionBackground: '#164e63',
        black: '#0f172a',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#334155',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc'
      }
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    fitAddon.fit()
    terminal.focus()

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

    resizeObserver.observe(containerRef.current)

    const dataCleanup = window.api.terminal.onData((payload) => {
      if (payload.terminalId !== terminalIdRef.current) {
        return
      }

      terminal.write(payload.data)
    })

    const exitCleanup = window.api.terminal.onExit((payload) => {
      if (payload.terminalId !== terminalIdRef.current) {
        return
      }

      terminalIdRef.current = null
      setIsRunning(false)
      setLaunchSummary(`Copilot session exited with code ${payload.exitCode}.`)
      terminal.writeln('')
      terminal.writeln(`[Taskmaster] Copilot session exited with code ${payload.exitCode}.`)
      void onRefresh()
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
      terminal.writeln('Taskmaster terminal ready.')
      terminal.writeln('')
      terminal.writeln(status.message)
      terminal.writeln(`[Taskmaster] Launch cwd: ${status.defaultCwd}`)
      terminal.writeln('[Taskmaster] Select a thread, then launch Copilot.')
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    return () => {
      resizeObserver.disconnect()
      exitCleanup()
      dataCleanup()
      disposable.dispose()

      if (terminalIdRef.current) {
        void window.api.terminal.kill(terminalIdRef.current)
        terminalIdRef.current = null
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
      }

      terminal.reset()
      terminal.writeln('[Taskmaster] Terminal ready.')
      terminal.writeln('')
      terminal.writeln(copilotStatus?.message ?? 'Resolving Copilot CLI availability...')
      terminal.writeln(selectedThreadSummary)

      if (selectedThread) {
        terminal.writeln(`[Taskmaster] Session name: ${selectedThread.sessionName}`)
        terminal.writeln(`[Taskmaster] Branch: ${selectedThread.displayBranchName}`)
      }

      setLaunchSummary(selectedThreadSummary)
      setIsRunning(false)
      terminal.focus()
    }

    void resetTerminal()
  }, [copilotStatus?.message, selectedThread, selectedThreadSummary])

  const startCopilot = async (): Promise<void> => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (
      !terminal ||
      !fitAddon ||
      !copilotStatus?.available ||
      !selectedThread ||
      !settings ||
      isRunning
    ) {
      return
    }

    setIsLaunching(true)
    terminal.reset()
    terminal.writeln('[Taskmaster] Launching Copilot CLI...')
    fitAddon.fit()

    const args = selectedThread.hasLaunched
      ? [`--resume=${selectedThread.sessionName}`, ...settings.parsedGlobalFlags]
      : ['--name', selectedThread.sessionName, ...settings.parsedGlobalFlags]

    const result = await window.api.terminal.create({
      threadId: selectedThread.id,
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: selectedThread.cwd,
      args
    })

    setIsLaunching(false)

    if (!result.ok) {
      setLaunchSummary(result.error)
      terminal.writeln(result.error)
      onFeedback('error', result.error)
      return
    }

    terminalIdRef.current = result.terminalId
    setIsRunning(true)
    setLaunchSummary(`Running ${result.launchedCommand} in ${result.cwd}`)
    terminal.focus()
    await onRefresh()
  }

  const stopCopilot = async (): Promise<void> => {
    if (!terminalIdRef.current) {
      return
    }

    await window.api.terminal.kill(terminalIdRef.current)
    terminalIdRef.current = null
    setIsRunning(false)
    await onRefresh()
  }

  return (
    <div className="h-fit self-start overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-2xl shadow-slate-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Embedded Copilot terminal</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{launchSummary}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-sm font-medium text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!copilotStatus?.available || isLaunching || isRunning || !selectedThread}
            onClick={() => void startCopilot()}
            type="button"
          >
            {isLaunching ? 'Checking...' : 'Launch Copilot'}
          </button>
          <button
            className="rounded-full border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!isRunning}
            onClick={() => void stopCopilot()}
            type="button"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-slate-400 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
          <div className="font-semibold uppercase tracking-[0.18em] text-slate-500">CLI status</div>
          <div className="mt-2 text-sm text-slate-200">
            {copilotStatus?.available ? 'Found on PATH' : 'Install/login required'}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
          <div className="font-semibold uppercase tracking-[0.18em] text-slate-500">
            Selected thread
          </div>
          <div className="mt-2 truncate text-sm text-slate-200">
            {selectedThread ? selectedThread.title : 'None'}
          </div>
        </div>
      </div>

      <div className="mt-4 h-[min(480px,50vh)] overflow-hidden rounded-xl border border-white/10 bg-slate-950">
        <div className="h-full min-h-0 w-full overflow-hidden px-3 py-3" ref={containerRef} />
      </div>
    </div>
  )
}
