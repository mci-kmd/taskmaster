import '@xterm/xterm/css/xterm.css'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import type {
  AppSettingsSnapshot,
  CopilotSessionSnapshot,
  ThreadSnapshot
} from '../../../shared/app-types'
import { getRendererApi } from '../shared/api/client'
import {
  canResolveColors,
  mixColors,
  readThemeRgba,
  toHex,
  withAlpha,
  type Rgba
} from '../lib/canvas-colors'
import { usePresence } from '../lib/motion'
import { useTheme } from '../lib/theme'

const api = getRendererApi()

export type SessionPhase = 'initializing' | 'idle' | 'launching' | 'running' | 'stopped' | 'error'
export type CopilotThreadStatus =
  'idle' | 'working' | 'input' | 'done' | 'connecting' | 'error' | 'disconnected'

export type ThreadSessionState = {
  phase: SessionPhase
  exitCode: number | null
  errorMessage: string | null
  runtimeTitle: string | null
  lastUserMessage: string | null
  copilotStatus?: CopilotThreadStatus
  copilotPhase?: CopilotSessionSnapshot['phase']
}

export type ThreadTerminalHandle = {
  start: () => Promise<void>
  stop: () => Promise<void>
  refit: () => void
}

type ThreadTerminalProps = {
  thread: ThreadSnapshot
  settings: AppSettingsSnapshot
  visible: boolean
  launchKey: number
  onStateChange: (state: ThreadSessionState) => void
  onRefresh: () => Promise<void>
}

type XtermCore = {
  _renderService: {
    clear: () => void
    dimensions: {
      css: {
        cell: {
          width: number
          height: number
        }
      }
    }
  }
}

/**
 * The terminal follows the active theme: it sits on the panel, writes in the text color and
 * selects with the accent. ANSI colors come from the status and syntax tokens, so they keep
 * enough contrast on Porcelain as well as on the dark themes. Null when colors can't be
 * resolved (tests), which leaves xterm's defaults.
 */
function buildTerminalTheme(element: Element, appearance: 'dark' | 'light'): ITheme | null {
  if (!canResolveColors()) return null
  const token = (name: string): Rgba => readThemeRgba(`--color-${name}`, element)
  const panel = token('panel')
  const fg = token('fg')
  const accent = token('accent')
  const red = token('danger')
  const green = token('positive')
  const yellow = token('warning')
  const blue = token('accent')
  const magenta = token('syntax-keyword')
  const cyan = mixColors(green, blue, 0.5)
  // Bright variants lean towards the text color: lighter on dark themes, deeper on Porcelain.
  const bright = (color: Rgba): string => toHex(mixColors(fg, color, 0.3))
  const [black, white, brightBlack, brightWhite] =
    appearance === 'dark'
      ? [token('fg-faint'), token('fg-muted'), token('fg-subtle'), fg]
      : [fg, token('fg-subtle'), token('fg-muted'), token('fg-faint')]
  return {
    background: toHex(panel),
    foreground: toHex(fg),
    cursor: toHex(accent),
    cursorAccent: toHex(panel),
    selectionBackground: toHex(withAlpha(accent, appearance === 'dark' ? 0.32 : 0.22)),
    selectionInactiveBackground: toHex(withAlpha(accent, 0.16)),
    black: toHex(black),
    red: toHex(red),
    green: toHex(green),
    yellow: toHex(yellow),
    blue: toHex(blue),
    magenta: toHex(magenta),
    cyan: toHex(cyan),
    white: toHex(white),
    brightBlack: toHex(brightBlack),
    brightRed: bright(red),
    brightGreen: bright(green),
    brightYellow: bright(yellow),
    brightBlue: bright(blue),
    brightMagenta: bright(magenta),
    brightCyan: bright(cyan),
    brightWhite: toHex(brightWhite)
  }
}

function withTheme(theme: ITheme | null): { theme?: ITheme } {
  return theme ? { theme } : {}
}

const MINIMUM_TERMINAL_COLS = 2
const MINIMUM_TERMINAL_ROWS = 1
const FALLBACK_TERMINAL_FONT_FAMILY =
  "'CaskaydiaCove Nerd Font Mono', 'CaskaydiaMono Nerd Font', 'MesloLGM Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'SauceCodePro Nerd Font Mono', Consolas, 'Cascadia Mono', 'Cascadia Code', 'SFMono-Regular', Menlo, Monaco, 'Geist Mono Variable', monospace"

function getTerminalFontFamily(settings: AppSettingsSnapshot): string {
  return settings.resolvedTerminalFontFamily || FALLBACK_TERMINAL_FONT_FAMILY
}

function fitTerminal(term: Terminal, container: HTMLElement): void {
  const core = (term as Terminal & { _core?: XtermCore })._core
  const cellWidth = core?._renderService.dimensions.css.cell.width ?? 0
  const cellHeight = core?._renderService.dimensions.css.cell.height ?? 0

  if (cellWidth <= 0 || cellHeight <= 0) return

  const cols = Math.max(MINIMUM_TERMINAL_COLS, Math.floor(container.clientWidth / cellWidth))
  const rows = Math.max(MINIMUM_TERMINAL_ROWS, Math.floor(container.clientHeight / cellHeight))

  if (term.cols === cols && term.rows === rows) return

  core?._renderService.clear()
  term.resize(cols, rows)
}

function hasBlockingModal(document: Document): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function getTerminalHelperTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  const helper = container.querySelector('.xterm-helper-textarea')
  return helper instanceof HTMLTextAreaElement ? helper : null
}

function isTextEntryElement(element: HTMLElement | null): boolean {
  if (!element) return false
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLInputElement) {
    return ![
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit'
    ].includes(element.type)
  }
  return element.isContentEditable
}

const ThreadTerminal = forwardRef<ThreadTerminalHandle, ThreadTerminalProps>(
  function ThreadTerminal({ thread, settings, visible, launchKey, onStateChange, onRefresh }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const terminalIdRef = useRef<string | null>(null)
    const threadRef = useRef(thread)
    const settingsRef = useRef(settings)
    const visibleRef = useRef(visible)
    const onRefreshRef = useRef(onRefresh)
    const onStateChangeRef = useRef(onStateChange)
    const phaseRef = useRef<SessionPhase>('idle')
    const lastConsumedLaunchKeyRef = useRef(0)
    const [phase, setPhase] = useState<SessionPhase>('idle')
    const [exitCode, setExitCode] = useState<number | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [runtimeTitle, setRuntimeTitle] = useState<string | null>(null)
    const theme = useTheme()
    const appearanceRef = useRef(theme.appearance)
    // Hidden terminals stay mounted (display: none); switching fades them in and out.
    const presence = usePresence(visible)

    useEffect(() => {
      threadRef.current = thread
    }, [thread])

    useEffect(() => {
      settingsRef.current = settings
      const term = terminalRef.current
      const container = containerRef.current
      if (!term || !container) return

      const nextFontFamily = getTerminalFontFamily(settings)
      if (term.options.fontFamily === nextFontFamily) return

      term.options.fontFamily = nextFontFamily
      const frameId = window.requestAnimationFrame(() => {
        fitTerminal(term, container)
        if (terminalIdRef.current) {
          api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
      })
      return () => window.cancelAnimationFrame(frameId)
    }, [settings])

    useEffect(() => {
      visibleRef.current = visible
    }, [visible])

    useEffect(() => {
      onRefreshRef.current = onRefresh
    }, [onRefresh])

    useEffect(() => {
      onStateChangeRef.current = onStateChange
    }, [onStateChange])

    useEffect(() => {
      phaseRef.current = phase
      onStateChangeRef.current({
        phase,
        exitCode,
        errorMessage,
        runtimeTitle,
        lastUserMessage: null
      })
    }, [phase, exitCode, errorMessage, runtimeTitle])

    const start = useCallback(async (): Promise<void> => {
      const term = terminalRef.current
      const container = containerRef.current
      if (
        !term ||
        !container ||
        terminalIdRef.current ||
        phaseRef.current === 'launching' ||
        phaseRef.current === 'running'
      )
        return

      phaseRef.current = 'launching'
      setPhase('launching')
      setErrorMessage(null)
      term.reset()
      setRuntimeTitle(null)
      fitTerminal(term, container)

      const currentThread = threadRef.current
      const result = await api.terminal.create({
        kind: 'shell',
        threadId: currentThread.id,
        threadMode: currentThread.mode,
        branchName: currentThread.branchName,
        cols: term.cols,
        rows: term.rows,
        cwd: currentThread.cwd,
        executionCwd: currentThread.executionCwd,
        backend: currentThread.backend
      })

      if (!result.ok) {
        await onRefreshRef.current()
        phaseRef.current = 'error'
        setPhase('error')
        setErrorMessage(result.error)
        return
      }

      terminalIdRef.current = result.terminalId
      setExitCode(null)
      setErrorMessage(null)
      phaseRef.current = 'running'
      setPhase('running')
      term.focus()
      await onRefreshRef.current()
    }, [])

    const stop = useCallback(async (): Promise<void> => {
      const id = terminalIdRef.current
      if (id) {
        terminalIdRef.current = null
        await api.terminal.kill(id)
      }
      phaseRef.current = 'idle'
      setPhase('idle')
      setRuntimeTitle(null)
      setExitCode(null)
      setErrorMessage(null)
      if (id) await onRefreshRef.current()
    }, [])

    const refit = useCallback((): void => {
      const term = terminalRef.current
      const container = containerRef.current
      if (!term || !container) return
      fitTerminal(term, container)
      if (terminalIdRef.current) {
        api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
      }
    }, [])

    useImperativeHandle(ref, () => ({ start, stop, refit }), [start, stop, refit])

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const term = new Terminal({
        customGlyphs: true,
        cursorBlink: true,
        convertEol: true,
        drawBoldTextInBrightColors: true,
        fontFamily: getTerminalFontFamily(settingsRef.current),
        fontSize: 13,
        fontWeight: 400,
        fontWeightBold: 600,
        lineHeight: 1.05,
        letterSpacing: 0,
        minimumContrastRatio: 1,
        rescaleOverlappingGlyphs: true,
        scrollback: 5000,
        ...withTheme(buildTerminalTheme(container, appearanceRef.current))
      })
      term.open(container)
      fitTerminal(term, container)

      const handlePointerDown = (): void => term.focus()
      container.addEventListener('pointerdown', handlePointerDown)

      const syncSize = (): void => {
        fitTerminal(term, container)
        if (terminalIdRef.current) {
          api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
      }
      const resizeObserver = new ResizeObserver(syncSize)
      resizeObserver.observe(container)

      if (document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (terminalRef.current === term) syncSize()
        })
      }

      const titleDisposable = term.onTitleChange((title) => {
        setRuntimeTitle(title?.trim() || null)
      })

      const dataCleanup = api.terminal.onData((payload) => {
        if (payload.terminalId !== terminalIdRef.current) return
        term.write(payload.data)
        if (!visibleRef.current) return

        const document = container.ownerDocument
        const activeElement = document.activeElement as HTMLElement | null
        if (
          !hasBlockingModal(document) &&
          !isTextEntryElement(activeElement) &&
          activeElement !== getTerminalHelperTextarea(container)
        ) {
          term.focus()
        }
      })

      const exitCleanup = api.terminal.onExit((payload) => {
        if (payload.terminalId !== terminalIdRef.current) return
        terminalIdRef.current = null
        phaseRef.current = 'stopped'
        setPhase('stopped')
        setExitCode(payload.exitCode)
        setRuntimeTitle(null)
        void onRefreshRef.current()
      })

      const inputDisposable = term.onData((data) => {
        if (terminalIdRef.current) api.terminal.input(terminalIdRef.current, data)
      })

      const pasteTerminalText = (text: string): void => {
        if (!terminalIdRef.current || !text) return
        term.focus()
        term.paste(text)
      }
      const pasteClipboard = async (): Promise<void> => {
        try {
          pasteTerminalText(await api.terminal.readClipboardText())
        } catch (error) {
          console.error('Could not read terminal clipboard:', error)
        }
      }
      const handlePaste = (event: ClipboardEvent): void => {
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return
        event.preventDefault()
        event.stopPropagation()
        pasteTerminalText(text)
      }
      container.addEventListener('paste', handlePaste)

      const handleWindowFocus = (): void => {
        if (!visibleRef.current || !terminalIdRef.current) return
        const document = container.ownerDocument
        if (hasBlockingModal(document)) return
        if (isTextEntryElement(document.activeElement as HTMLElement | null)) return
        term.focus()
      }
      window.addEventListener('focus', handleWindowFocus)

      term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
        if (event.type !== 'keydown' || !terminalIdRef.current) return true
        const onlyCtrl = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey
        const onlyShift = event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
        if (onlyCtrl && (event.key === 'c' || event.key === 'C')) {
          const selection = term.getSelection()
          if (!selection) return true
          void navigator.clipboard.writeText(selection)
        } else if (
          (onlyCtrl && (event.key === 'v' || event.key === 'V')) ||
          (onlyShift && event.key === 'Insert')
        ) {
          void pasteClipboard()
        } else {
          return true
        }
        event.preventDefault()
        event.stopPropagation()
        return false
      })

      terminalRef.current = term
      return () => {
        container.removeEventListener('pointerdown', handlePointerDown)
        container.removeEventListener('paste', handlePaste)
        window.removeEventListener('focus', handleWindowFocus)
        resizeObserver.disconnect()
        exitCleanup()
        dataCleanup()
        inputDisposable.dispose()
        titleDisposable.dispose()
        if (terminalIdRef.current) {
          void api.terminal.kill(terminalIdRef.current)
          terminalIdRef.current = null
        }
        terminalRef.current = null
        term.dispose()
      }
    }, [])

    useEffect(() => {
      if (launchKey === 0 || lastConsumedLaunchKeyRef.current === launchKey) return
      if (phase === 'launching' || phase === 'running') return
      lastConsumedLaunchKeyRef.current = launchKey
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void start()
    }, [launchKey, phase, start])

    useEffect(() => {
      appearanceRef.current = theme.appearance
      const term = terminalRef.current
      const container = containerRef.current
      if (!term || !container) return
      const next = buildTerminalTheme(container, theme.appearance)
      if (next) term.options.theme = next
    }, [theme.appearance, theme.id])

    useEffect(() => {
      if (!visible) return
      const term = terminalRef.current
      const container = containerRef.current
      if (!term || !container) return
      const id = window.requestAnimationFrame(() => {
        fitTerminal(term, container)
        if (terminalIdRef.current) {
          api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
        term.focus()
      })
      return () => window.cancelAnimationFrame(id)
    }, [visible])

    return (
      <div
        className="tm-terminal"
        data-motion="fade"
        data-state={presence.state}
        style={{ display: presence.mounted ? 'block' : 'none' }}
      >
        <div className="tm-terminal__screen" ref={containerRef} />
      </div>
    )
  }
)

export default ThreadTerminal
