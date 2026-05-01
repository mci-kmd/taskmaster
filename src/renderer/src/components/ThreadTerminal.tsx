import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { AppSettingsSnapshot, TerminalStatus, ThreadSnapshot } from '../../../shared/app-types'

export type SessionPhase = 'initializing' | 'idle' | 'launching' | 'running' | 'stopped' | 'error'

export type ThreadSessionState = {
  phase: SessionPhase
  exitCode: number | null
  errorMessage: string | null
  runtimeTitle: string | null
}

export type ThreadTerminalHandle = {
  start: () => Promise<void>
  stop: () => Promise<void>
  refit: () => void
}

type ThreadTerminalProps = {
  thread: ThreadSnapshot
  settings: AppSettingsSnapshot
  copilotStatus: TerminalStatus | null
  visible: boolean
  /**
   * When this monotonically-increasing key changes, the terminal will
   * launch (or relaunch) a session. Allows parents to imperatively trigger
   * launch without holding refs.
   */
  launchKey: number
  onStateChange: (state: ThreadSessionState) => void
  onRefresh: () => Promise<void>
}

type LaunchMode = 'new' | 'resume'

type LaunchAttempt = {
  terminalId: string
  mode: LaunchMode
  buffer: string
  retriedFromMissingSession: boolean
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

function buildLaunchArgs(sessionName: string, globalFlags: string[], mode: LaunchMode): string[] {
  const launchFlag = mode === 'resume' ? `--resume=${sessionName}` : `--name=${sessionName}`
  return [launchFlag, ...globalFlags]
}

function isMissingNamedSessionError(output: string): boolean {
  return /No session, task, or name matched/i.test(output)
}

const ThreadTerminal = forwardRef<ThreadTerminalHandle, ThreadTerminalProps>(
  function ThreadTerminal(
    { thread, settings, copilotStatus, visible, launchKey, onStateChange, onRefresh },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const terminalIdRef = useRef<string | null>(null)
    const launchAttemptRef = useRef<LaunchAttempt | null>(null)
    const threadRef = useRef(thread)
    const settingsRef = useRef(settings)
    const copilotStatusRef = useRef(copilotStatus)
    const onRefreshRef = useRef(onRefresh)
    const onStateChangeRef = useRef(onStateChange)
    const phaseRef = useRef<SessionPhase>('idle')
    const launchKeyRef = useRef<number>(launchKey)
    const lastConsumedLaunchKeyRef = useRef<number>(launchKey)
    const [phase, setPhase] = useState<SessionPhase>('idle')
    const [exitCode, setExitCode] = useState<number | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [runtimeTitle, setRuntimeTitle] = useState<string | null>(null)

    useEffect(() => {
      threadRef.current = thread
    }, [thread])

    useEffect(() => {
      settingsRef.current = settings
    }, [settings])

    useEffect(() => {
      copilotStatusRef.current = copilotStatus
    }, [copilotStatus])

    useEffect(() => {
      onRefreshRef.current = onRefresh
    }, [onRefresh])

    useEffect(() => {
      onStateChangeRef.current = onStateChange
    }, [onStateChange])

    useEffect(() => {
      phaseRef.current = phase
    }, [phase])

    useEffect(() => {
      onStateChangeRef.current({ phase, exitCode, errorMessage, runtimeTitle })
    }, [phase, exitCode, errorMessage, runtimeTitle])

    const launchInternal = useCallback(
      async (mode: LaunchMode, retriedFromMissingSession = false): Promise<boolean> => {
        const term = terminalRef.current
        const fitAddon = fitAddonRef.current
        const status = copilotStatusRef.current

        if (!term || !fitAddon || !status?.available) {
          return false
        }
        if (terminalIdRef.current) {
          return false
        }

        setPhase('launching')
        setErrorMessage(null)

        if (!retriedFromMissingSession) {
          term.reset()
          setRuntimeTitle(null)
          fitAddon.fit()
        }

        const currentThread = threadRef.current
        const currentSettings = settingsRef.current
        if (!currentThread || !currentSettings) {
          setPhase('error')
          setErrorMessage('Missing thread or settings.')
          return false
        }

        const args = buildLaunchArgs(
          currentThread.sessionName,
          currentSettings.parsedGlobalFlags,
          mode
        )

        const result = await window.api.terminal.create({
          threadId: currentThread.id,
          cols: term.cols,
          rows: term.rows,
          cwd: currentThread.cwd,
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
          mode,
          buffer: '',
          retriedFromMissingSession
        }
        setExitCode(null)
        setErrorMessage(null)
        setPhase('running')
        term.focus()
        await onRefreshRef.current()
        return true
      },
      []
    )

    const start = useCallback(async (): Promise<void> => {
      if (phaseRef.current === 'launching' || phaseRef.current === 'running') {
        return
      }
      const thread = threadRef.current
      if (!thread) {
        return
      }
      const mode: LaunchMode = thread.hasLaunched ? 'resume' : 'new'
      await launchInternal(mode)
    }, [launchInternal])

    const stop = useCallback(async (): Promise<void> => {
      const id = terminalIdRef.current
      if (!id) {
        // No active PTY — just bring phase back to idle
        setPhase('idle')
        setExitCode(null)
        setErrorMessage(null)
        return
      }

      await window.api.terminal.kill(id)
      terminalIdRef.current = null
      launchAttemptRef.current = null
      setRuntimeTitle(null)
      setPhase('idle')
      setExitCode(null)
      setErrorMessage(null)
      await onRefreshRef.current()
    }, [])

    const refit = useCallback((): void => {
      const term = terminalRef.current
      const fit = fitAddonRef.current
      if (!term || !fit) {
        return
      }
      fit.fit()
      if (terminalIdRef.current) {
        window.api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
      }
    }, [])

    useImperativeHandle(ref, () => ({ start, stop, refit }), [start, stop, refit])

    // xterm lifecycle
    useEffect(() => {
      if (!containerRef.current) {
        return
      }

      const container = containerRef.current
      const term = new Terminal({
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
      term.loadAddon(fitAddon)
      term.open(container)
      fitAddon.fit()

      const handlePointerDown = (): void => term.focus()
      container.addEventListener('pointerdown', handlePointerDown)

      const syncSize = (): void => {
        fitAddon.fit()
        if (terminalIdRef.current) {
          window.api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
      }
      const resizeObserver = new ResizeObserver(syncSize)
      resizeObserver.observe(container)

      if (typeof document !== 'undefined' && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (!terminalRef.current || !fitAddonRef.current) return
          syncSize()
        })
      }

      const titleDisposable = term.onTitleChange((title) => {
        setRuntimeTitle(title?.trim() || null)
      })

      const dataCleanup = window.api.terminal.onData((payload) => {
        if (payload.terminalId !== terminalIdRef.current) {
          return
        }
        if (launchAttemptRef.current?.terminalId === payload.terminalId) {
          launchAttemptRef.current.buffer += payload.data
        }
        term.write(payload.data)
      })

      const handleExit = async (code: number): Promise<void> => {
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
          const ok = await launchInternal('new', true)
          if (ok) return
        }

        setExitCode(code)
        setRuntimeTitle(null)
        setPhase('stopped')
        await onRefreshRef.current()
      }

      const exitCleanup = window.api.terminal.onExit((payload) => {
        if (payload.terminalId !== terminalIdRef.current) {
          return
        }
        void handleExit(payload.exitCode)
      })

      const inputDisposable = term.onData((data) => {
        if (!terminalIdRef.current) return
        window.api.terminal.input(terminalIdRef.current, data)
      })

      // Translate keys Copilot CLI doesn't recognise on raw xterm.js into
      // sequences it does, and let Ctrl-C copy when a selection exists.
      term.attachCustomKeyEventHandler((e: KeyboardEvent): boolean => {
        if (e.type !== 'keydown') return true
        const id = terminalIdRef.current
        if (!id) return true

        const onlyCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
        const onlyShift = e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey

        if (onlyCtrl && (e.key === 'c' || e.key === 'C')) {
          const sel = term.getSelection()
          if (sel) {
            void navigator.clipboard.writeText(sel)
            return false
          }
          return true
        }

        // Shift-Enter: backslash+CR is Copilot's documented multiline trick
        if (onlyShift && e.key === 'Enter') {
          window.api.terminal.input(id, '\\\r')
          return false
        }
        // Ctrl-Backspace -> Ctrl-W (delete word back)
        if (onlyCtrl && e.key === 'Backspace') {
          window.api.terminal.input(id, '\x17')
          return false
        }
        // Ctrl-Delete -> Alt-D (delete word forward)
        if (onlyCtrl && e.key === 'Delete') {
          window.api.terminal.input(id, '\x1bd')
          return false
        }
        // Ctrl-Left/Right -> ESC+CSI D/C (Copilot accepts Alt-arrow for word motion)
        if (onlyCtrl && e.key === 'ArrowLeft') {
          window.api.terminal.input(id, '\x1b\x1b[D')
          return false
        }
        if (onlyCtrl && e.key === 'ArrowRight') {
          window.api.terminal.input(id, '\x1b\x1b[C')
          return false
        }

        return true
      })

      terminalRef.current = term
      fitAddonRef.current = fitAddon

      return () => {
        container.removeEventListener('pointerdown', handlePointerDown)
        resizeObserver.disconnect()
        exitCleanup()
        dataCleanup()
        inputDisposable.dispose()
        titleDisposable.dispose()
        if (terminalIdRef.current) {
          void window.api.terminal.kill(terminalIdRef.current)
          terminalIdRef.current = null
          launchAttemptRef.current = null
        }
        term.dispose()
      }
    }, [launchInternal])

    // External launch trigger via launchKey: parent increments to ask the
    // pane to (re)start. Effect-driven start() is intentional — it is the
    // bridge between an external imperative request and our async PTY
    // lifecycle.
    useEffect(() => {
      launchKeyRef.current = launchKey
      if (launchKey === 0) return
      if (lastConsumedLaunchKeyRef.current === launchKey) return
      if (phase === 'launching' || phase === 'running') return

      lastConsumedLaunchKeyRef.current = launchKey
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void start()
    }, [launchKey, phase, start])

    // Refit when becoming visible (ResizeObserver fires for 0→size, but
    // we explicitly refit to be safe and to immediately reflect the
    // current container size to the PTY).
    useEffect(() => {
      if (!visible) return
      const term = terminalRef.current
      const fit = fitAddonRef.current
      if (!term || !fit) return
      // RAF so layout is settled.
      const id = window.requestAnimationFrame(() => {
        fit.fit()
        if (terminalIdRef.current) {
          window.api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
        term.focus()
      })
      return () => window.cancelAnimationFrame(id)
    }, [visible])

    return (
      <div
        className="absolute inset-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#141414]"
        style={{ display: visible ? 'block' : 'none' }}
      >
        <div className="h-full w-full px-3 py-3" ref={containerRef} />
      </div>
    )
  }
)

export default ThreadTerminal
