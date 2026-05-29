import '@xterm/xterm/css/xterm.css'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type {
  AgentProviderId,
  AppSettingsSnapshot,
  TerminalKind,
  TerminalStatus,
  ThreadSnapshot
} from '../../../shared/app-types'
import {
  DEFAULT_AGENT_PROVIDER_ID,
  getAgentProviderDescriptor
} from '../../../shared/agent-providers'
import {
  consumeTrackedUserInput,
  isMissingResumeSessionError,
  normalizeTrackedUserMessage,
  type UserInputTrackingState
} from '../lib/terminal-input'
import { getRendererApi } from '../shared/api/client'

const api = getRendererApi()

export type SessionPhase = 'initializing' | 'idle' | 'launching' | 'running' | 'stopped' | 'error'

export type ThreadSessionState = {
  phase: SessionPhase
  exitCode: number | null
  errorMessage: string | null
  runtimeTitle: string | null
  lastUserMessage: string | null
}

export type ThreadTerminalHandle = {
  start: () => Promise<void>
  stop: () => Promise<void>
  refit: () => void
}

type ThreadTerminalProps = {
  kind: TerminalKind
  agentProviderId?: AgentProviderId
  thread: ThreadSnapshot
  settings: AppSettingsSnapshot
  agentStatus: TerminalStatus | null
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

type VisibleTextMap = {
  plain: string
  rawIndexByVisibleIndex: number[]
}

type StyledOutputState = {
  current: string
  insideToolBlock: boolean
}

const TERMINAL_THEME = {
  background: '#141414',
  foreground: '#c9d1d9',
  cursor: '#f3f3f3',
  cursorAccent: '#141414',
  selectionBackground: '#2e2e2e',
  black: '#6e7681',
  red: '#ffa198',
  green: '#7ee787',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#d2a8ff',
  cyan: '#79c0ff',
  white: '#e6edf3',
  brightBlack: '#8b949e',
  brightRed: '#ffb1af',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#e2c5ff',
  brightCyan: '#a5d6ff',
  brightWhite: '#f0f6fc'
}

const MINIMUM_TERMINAL_COLS = 2
const MINIMUM_TERMINAL_ROWS = 1
const FALLBACK_TERMINAL_FONT_FAMILY =
  "'CaskaydiaCove Nerd Font Mono', 'CaskaydiaMono Nerd Font', 'MesloLGM Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'SauceCodePro Nerd Font Mono', Consolas, 'Cascadia Mono', 'Cascadia Code', 'SFMono-Regular', Menlo, Monaco, 'Geist Mono Variable', monospace"
const ANSI_DIM = '\x1b[90m'
const ANSI_BRIGHT_WHITE = '\x1b[97m'
const ANSI_RESET_INTENSITY = '\x1b[22m'
const ANSI_RESET_FOREGROUND = '\x1b[39m'

function getTerminalFontFamily(settings: AppSettingsSnapshot | null | undefined): string {
  return settings?.resolvedTerminalFontFamily || FALLBACK_TERMINAL_FONT_FAMILY
}

function getXtermCore(term: Terminal): XtermCore | null {
  return (term as Terminal & { _core?: XtermCore })._core ?? null
}

function fitTerminal(term: Terminal, container: HTMLElement): void {
  const core = getXtermCore(term)
  const cellWidth = core?._renderService.dimensions.css.cell.width ?? 0
  const cellHeight = core?._renderService.dimensions.css.cell.height ?? 0

  if (cellWidth <= 0 || cellHeight <= 0) {
    return
  }

  const cols = Math.max(MINIMUM_TERMINAL_COLS, Math.floor(container.clientWidth / cellWidth))
  const rows = Math.max(MINIMUM_TERMINAL_ROWS, Math.floor(container.clientHeight / cellHeight))

  if (term.cols === cols && term.rows === rows) {
    return
  }

  core?._renderService.clear()
  term.resize(cols, rows)
}

function buildVisibleTextMap(raw: string): VisibleTextMap {
  let plain = ''
  const rawIndexByVisibleIndex: number[] = []

  for (let index = 0; index < raw.length; ) {
    const char = raw[index]
    if (char !== '\x1b') {
      rawIndexByVisibleIndex.push(index)
      plain += char
      index += 1
      continue
    }

    const next = raw[index + 1]
    if (next === '[') {
      index += 2
      while (index < raw.length) {
        const code = raw.charCodeAt(index)
        index += 1
        if (code >= 0x40 && code <= 0x7e) {
          break
        }
      }
      continue
    }

    if (next === ']') {
      index += 2
      while (index < raw.length) {
        if (raw[index] === '\x07') {
          index += 1
          break
        }
        if (raw[index] === '\x1b' && raw[index + 1] === '\\') {
          index += 2
          break
        }
        index += 1
      }
      continue
    }

    index += Math.min(2, raw.length - index)
  }

  return { plain, rawIndexByVisibleIndex }
}

function classifyStyledLine(
  plain: string,
  insideToolBlock: boolean
): 'tool-title' | 'tool-body' | null {
  const trimmedStart = plain.trimStart()
  if (trimmedStart.length === 0) {
    return null
  }
  if (/^[│┃║|┆┇┊┋╎╏└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣╰╭╮╯]/u.test(trimmedStart)) {
    return 'tool-body'
  }

  const bulletMatch = trimmedStart.match(/^[•●◦▪·]\s+(.*)$/u)
  if (!bulletMatch) {
    if (
      insideToolBlock &&
      /^(?:L\d+:\d+|-?\s*\d+\s+lines?(?:\.\.\.)?|['"`].*|--[\w-]+=|\.\.\.|Set-Location\b|[A-Za-z]:\\|(?:git|npm|pnpm|bun|yarn|node|python|go|if)\b|\$\w+)/u.test(
        trimmedStart
      )
    ) {
      return 'tool-body'
    }
    return null
  }

  return /[.!?]$/.test(bulletMatch[1].trim()) ? null : 'tool-title'
}

function getToolTitleVisibleStart(plain: string): number {
  const firstNonWhitespace = plain.search(/\S/u)
  if (firstNonWhitespace === -1) {
    return 0
  }

  let index = firstNonWhitespace
  if (/[•●◦▪·>›»]/u.test(plain[index] ?? '')) {
    index += 1
    while (index < plain.length && /\s/u.test(plain[index] ?? '')) {
      index += 1
    }
  }
  return index
}

function applyVisibleStyle(
  rawContent: string,
  visibleStart: number,
  prefix: string,
  suffix: string
): string {
  const visible = buildVisibleTextMap(rawContent)
  if (visible.rawIndexByVisibleIndex.length === 0) {
    return rawContent
  }

  const boundedStart = Math.max(0, Math.min(visibleStart, visible.rawIndexByVisibleIndex.length))
  const rawStart =
    boundedStart >= visible.rawIndexByVisibleIndex.length
      ? rawContent.length
      : visible.rawIndexByVisibleIndex[boundedStart]

  if (rawStart >= rawContent.length) {
    return rawContent
  }

  let styled = `${rawContent.slice(0, rawStart)}${prefix}`
  for (let index = rawStart; index < rawContent.length; ) {
    const nextEscape = rawContent.indexOf('\x1b', index)
    if (nextEscape === -1) {
      styled += rawContent.slice(index)
      break
    }

    styled += rawContent.slice(index, nextEscape)
    const escape = readEscapeSequence(rawContent, nextEscape)
    if (!escape) {
      styled += rawContent.slice(nextEscape)
      break
    }

    styled += escape.sequence
    if (escape.isSgr) {
      styled += prefix
    }
    index = escape.end
  }

  return `${styled}${suffix}`
}

function styleTerminalLine(rawLine: string, state: StyledOutputState): string {
  const lineBreakMatch = rawLine.match(/(?:\r\n|\r|\n)$/u)
  const lineBreak = lineBreakMatch?.[0] ?? ''
  const content = lineBreak.length > 0 ? rawLine.slice(0, -lineBreak.length) : rawLine
  const visible = buildVisibleTextMap(content)
  const kind = classifyStyledLine(visible.plain, state.insideToolBlock)

  state.insideToolBlock = kind === 'tool-title' || kind === 'tool-body'

  if (!kind) {
    return rawLine
  }

  if (kind === 'tool-body') {
    return `${ANSI_DIM}${content}${ANSI_RESET_INTENSITY}${ANSI_RESET_FOREGROUND}${lineBreak}`
  }

  const titleStart = getToolTitleVisibleStart(visible.plain)
  const styledContent = applyVisibleStyle(
    content,
    titleStart,
    ANSI_BRIGHT_WHITE,
    `${ANSI_RESET_INTENSITY}${ANSI_RESET_FOREGROUND}`
  )
  return `${styledContent}${lineBreak}`
}

function flushStyledLines(state: StyledOutputState): string {
  let output = ''

  while (true) {
    const newlineMatch = state.current.match(/\r\n|\r|\n/u)
    if (!newlineMatch || newlineMatch.index === undefined) {
      break
    }

    const lineBreakIndex = newlineMatch.index
    const lineBreak = newlineMatch[0]
    const endIndex = lineBreakIndex + lineBreak.length
    output += styleTerminalLine(state.current.slice(0, endIndex), state)
    state.current = state.current.slice(endIndex)
  }

  return output
}

function flushStyledPartial(state: StyledOutputState, force = false): string {
  if (state.current.length === 0) {
    return ''
  }

  if (force) {
    const output = styleTerminalLine(state.current, state)
    state.current = ''
    return output
  }

  const partialKind = classifyStyledLine(
    buildVisibleTextMap(state.current).plain,
    state.insideToolBlock
  )
  if (!partialKind) {
    const output = state.current
    state.current = ''
    state.insideToolBlock = false
    return output
  }

  return ''
}

function readEscapeSequence(
  value: string,
  start: number
): { sequence: string; end: number; isSgr: boolean } | null {
  if (value[start] !== '\x1b') {
    return null
  }

  const next = value[start + 1]
  if (!next) {
    return null
  }

  if (next === '[') {
    let cursor = start + 2
    while (cursor < value.length) {
      const code = value.charCodeAt(cursor)
      cursor += 1
      if (code >= 0x40 && code <= 0x7e) {
        return {
          sequence: value.slice(start, cursor),
          end: cursor,
          isSgr: value[cursor - 1] === 'm'
        }
      }
    }
    return null
  }

  if (next === ']') {
    let cursor = start + 2
    while (cursor < value.length) {
      if (value[cursor] === '\x07') {
        return {
          sequence: value.slice(start, cursor + 1),
          end: cursor + 1,
          isSgr: false
        }
      }
      if (value[cursor] === '\x1b' && value[cursor + 1] === '\\') {
        return {
          sequence: value.slice(start, cursor + 2),
          end: cursor + 2,
          isSgr: false
        }
      }
      cursor += 1
    }
    return null
  }

  if (start + 1 >= value.length) {
    return null
  }

  return {
    sequence: value.slice(start, start + 2),
    end: start + 2,
    isSgr: false
  }
}

function styleTerminalOutput(incoming: string, state: StyledOutputState): string {
  let output = ''

  for (let index = 0; index < incoming.length; ) {
    const char = incoming[index]
    if (char !== '\x1b') {
      const nextEscape = incoming.indexOf('\x1b', index)
      const endIndex = nextEscape === -1 ? incoming.length : nextEscape
      state.current += incoming.slice(index, endIndex)
      output += flushStyledLines(state)
      index = endIndex
      continue
    }

    const escape = readEscapeSequence(incoming, index)
    if (!escape) {
      state.current += incoming.slice(index)
      break
    }

    if (escape.isSgr) {
      state.current += escape.sequence
      index = escape.end
      continue
    }

    output += flushStyledPartial(state, true)
    output += escape.sequence
    index = escape.end
  }

  output += flushStyledPartial(state)
  return output
}

function hasBlockingModal(document: Document): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function getTerminalHelperTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  const helper = container.querySelector('.xterm-helper-textarea')
  return helper instanceof HTMLTextAreaElement ? helper : null
}

function focusTerminalInput(term: Terminal): void {
  term.focus()
}

function isTextEntryElement(element: HTMLElement | null): boolean {
  if (!element) {
    return false
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true
  }
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
  function ThreadTerminal(
    {
      kind,
      agentProviderId = DEFAULT_AGENT_PROVIDER_ID,
      thread,
      settings,
      agentStatus,
      visible,
      launchKey,
      onStateChange,
      onRefresh
    },
    ref
  ) {
    const agentProvider = getAgentProviderDescriptor(agentProviderId)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const terminalIdRef = useRef<string | null>(null)
    const launchAttemptRef = useRef<LaunchAttempt | null>(null)
    const threadRef = useRef(thread)
    const settingsRef = useRef(settings)
    const agentStatusRef = useRef(agentStatus)
    const agentProviderRef = useRef(agentProvider)
    const latestAgentProviderRef = useRef(agentProvider)
    const onRefreshRef = useRef(onRefresh)
    const onStateChangeRef = useRef(onStateChange)
    const visibleRef = useRef(visible)
    const kindRef = useRef(kind)
    const phaseRef = useRef<SessionPhase>('idle')
    const sessionNameRef = useRef(thread.sessionName)
    const resumeSessionIdRef = useRef(thread.resumeSessionId)
    const pendingStyledOutputRef = useRef<StyledOutputState>({
      current: '',
      insideToolBlock: false
    })
    const trackedUserInputRef = useRef<UserInputTrackingState>({
      draft: '',
      dirty: false
    })
    const lastConsumedLaunchKeyRef = useRef<number>(0)
    const lastPersistedCopilotTitleRef = useRef(thread.latestCopilotTitle)
    const lastPersistedUserMessageRef = useRef(thread.lastUserMessage)
    const [phase, setPhase] = useState<SessionPhase>('idle')
    const [exitCode, setExitCode] = useState<number | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [runtimeTitle, setRuntimeTitle] = useState<string | null>(null)
    const [lastUserMessage, setLastUserMessage] = useState<string | null>(
      kind === 'agent' ? thread.lastUserMessage : null
    )

    useEffect(() => {
      threadRef.current = thread
      sessionNameRef.current = thread.sessionName
      resumeSessionIdRef.current = thread.resumeSessionId
      lastPersistedCopilotTitleRef.current = thread.latestCopilotTitle
      lastPersistedUserMessageRef.current = thread.lastUserMessage
    }, [thread])

    useEffect(() => {
      settingsRef.current = settings
    }, [settings])

    useEffect(() => {
      const term = terminalRef.current
      const container = containerRef.current
      if (!term || !container) {
        return
      }

      const nextFontFamily = getTerminalFontFamily(settings)
      if (term.options.fontFamily === nextFontFamily) {
        return
      }

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
      agentStatusRef.current = agentStatus
    }, [agentStatus])

    useEffect(() => {
      latestAgentProviderRef.current = agentProvider
      if (!terminalIdRef.current) {
        agentProviderRef.current = agentProvider
      }
    }, [agentProvider])

    useEffect(() => {
      onRefreshRef.current = onRefresh
    }, [onRefresh])

    useEffect(() => {
      visibleRef.current = visible
    }, [visible])

    useEffect(() => {
      kindRef.current = kind
    }, [kind])

    useEffect(() => {
      onStateChangeRef.current = onStateChange
    }, [onStateChange])

    useEffect(() => {
      phaseRef.current = phase
    }, [phase])

    useEffect(() => {
      onStateChangeRef.current({ phase, exitCode, errorMessage, runtimeTitle, lastUserMessage })
    }, [phase, exitCode, errorMessage, runtimeTitle, lastUserMessage])

    useEffect(() => {
      if (kind !== 'agent') {
        return
      }
      const trimmedRuntimeTitle = runtimeTitle?.trim()
      if (!trimmedRuntimeTitle || trimmedRuntimeTitle === lastPersistedCopilotTitleRef.current) {
        return
      }

      lastPersistedCopilotTitleRef.current = trimmedRuntimeTitle
      void api.appState.updateThreadCopilotTitle({
        threadId: thread.id,
        title: trimmedRuntimeTitle
      })
    }, [kind, runtimeTitle, thread.id])

    useEffect(() => {
      if (kind !== 'agent') {
        return
      }
      const normalizedLastUserMessage = normalizeTrackedUserMessage(lastUserMessage ?? '')
      if (normalizedLastUserMessage === lastPersistedUserMessageRef.current) {
        return
      }

      lastPersistedUserMessageRef.current = normalizedLastUserMessage
      void api.appState.updateThreadLastUserMessage({
        threadId: thread.id,
        message: normalizedLastUserMessage
      })
    }, [kind, lastUserMessage, thread.id])

    const launchInternal = useCallback(
      async (mode: LaunchMode, retriedFromMissingSession = false): Promise<boolean> => {
        const term = terminalRef.current
        const container = containerRef.current
        const status = agentStatusRef.current
        const isAgentTerminal = kindRef.current === 'agent'

        if (!term || !container || (isAgentTerminal && !status?.available)) {
          return false
        }
        if (terminalIdRef.current) {
          return false
        }

        setPhase('launching')
        setErrorMessage(null)

        if (!retriedFromMissingSession) {
          pendingStyledOutputRef.current.current = ''
          pendingStyledOutputRef.current.insideToolBlock = false
          trackedUserInputRef.current = {
            draft: '',
            dirty: false
          }
          term.reset()
          setRuntimeTitle(null)
          fitTerminal(term, container)
        }

        const currentThread = threadRef.current
        const currentSettings = settingsRef.current
        const launchAgentProvider = latestAgentProviderRef.current
        agentProviderRef.current = launchAgentProvider
        if (!currentThread || !currentSettings) {
          setPhase('error')
          setErrorMessage('Missing thread or settings.')
          return false
        }

        const result = await api.terminal.create({
          kind: isAgentTerminal ? 'agent' : 'shell',
          agentProviderId: isAgentTerminal ? launchAgentProvider.id : undefined,
          threadId: currentThread.id,
          threadMode: currentThread.mode,
          branchName: currentThread.branchName,
          cols: term.cols,
          rows: term.rows,
          cwd: currentThread.cwd,
          executionCwd: currentThread.executionCwd,
          backend: currentThread.backend,
          agentLaunch: isAgentTerminal
            ? {
                mode,
                sessionName: sessionNameRef.current,
                resumeSessionId: resumeSessionIdRef.current,
                globalFlags: currentSettings.parsedGlobalFlags
              }
            : undefined
        })

        if (!result.ok) {
          launchAttemptRef.current = null
          await onRefreshRef.current()
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
        focusTerminalInput(term)
        await onRefreshRef.current()
        return true
      },
      []
    )

    const trackTerminalInput = useCallback((data: string): string | null => {
      const result = consumeTrackedUserInput(trackedUserInputRef.current, data)
      trackedUserInputRef.current = result.state
      if (result.submittedMessage) {
        setLastUserMessage((current) =>
          current === result.submittedMessage ? current : result.submittedMessage
        )
      }
      return result.submittedMessage
    }, [])

    const trackPromptLineBreak = useCallback((): void => {
      const current = trackedUserInputRef.current
      if (current.dirty) {
        return
      }
      trackedUserInputRef.current = {
        draft: `${current.draft}\n`,
        dirty: false
      }
    }, [])

    const markTrackedInputDirty = useCallback((): void => {
      const current = trackedUserInputRef.current
      if (current.dirty) {
        return
      }
      trackedUserInputRef.current = {
        draft: current.draft,
        dirty: true
      }
    }, [])

    const start = useCallback(async (): Promise<void> => {
      if (phaseRef.current === 'launching' || phaseRef.current === 'running') {
        return
      }
      const mode: LaunchMode =
        kindRef.current === 'agent' && resumeSessionIdRef.current ? 'resume' : 'new'
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

      await api.terminal.kill(id)
      terminalIdRef.current = null
      launchAttemptRef.current = null
      agentProviderRef.current = latestAgentProviderRef.current
      pendingStyledOutputRef.current.current = ''
      pendingStyledOutputRef.current.insideToolBlock = false
      trackedUserInputRef.current = {
        draft: '',
        dirty: false
      }
      setRuntimeTitle(null)
      setPhase('idle')
      setExitCode(null)
      setErrorMessage(null)
      await onRefreshRef.current()
    }, [])

    const refit = useCallback((): void => {
      const term = terminalRef.current
      const container = containerRef.current
      if (!term || !container) {
        return
      }
      fitTerminal(term, container)
      if (terminalIdRef.current) {
        api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
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
        theme: TERMINAL_THEME
      })
      term.open(container)
      fitTerminal(term, container)

      const handlePointerDown = (): void => focusTerminalInput(term)
      container.addEventListener('pointerdown', handlePointerDown)

      const syncSize = (): void => {
        fitTerminal(term, container)
        if (terminalIdRef.current) {
          api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
      }
      const resizeObserver = new ResizeObserver(syncSize)
      resizeObserver.observe(container)

      if (typeof document !== 'undefined' && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (!terminalRef.current || !containerRef.current) return
          syncSize()
        })
      }

      const titleDisposable = term.onTitleChange((title) => {
        setRuntimeTitle(title?.trim() || null)
      })

      const dataCleanup = api.terminal.onData((payload) => {
        if (payload.terminalId !== terminalIdRef.current) {
          return
        }
        if (launchAttemptRef.current?.terminalId === payload.terminalId) {
          launchAttemptRef.current.buffer += payload.data
        }
        let styled: string
        if (
          kindRef.current !== 'agent' ||
          !agentProviderRef.current.capabilities.usesCopilotTerminalStyling
        ) {
          styled = payload.data
        } else {
          styled = styleTerminalOutput(payload.data, pendingStyledOutputRef.current)
        }
        if (styled.length > 0) {
          term.write(styled)
          if (visibleRef.current && terminalIdRef.current) {
            const document = container.ownerDocument
            const activeElement = document.activeElement as HTMLElement | null
            const helperTextarea = getTerminalHelperTextarea(container)
            if (
              !hasBlockingModal(document) &&
              !isTextEntryElement(activeElement) &&
              activeElement !== helperTextarea
            ) {
              focusTerminalInput(term)
            }
          }
        }
      })

      const handleExit = async (code: number): Promise<void> => {
        const attempt = launchAttemptRef.current
        terminalIdRef.current = null
        launchAttemptRef.current = null
        agentProviderRef.current = latestAgentProviderRef.current

        if (
          kindRef.current === 'agent' &&
          agentProviderRef.current.capabilities.canRetryMissingResumeSession &&
          attempt &&
          attempt.mode === 'resume' &&
          !attempt.retriedFromMissingSession &&
          code === 1 &&
          isMissingResumeSessionError(attempt.buffer)
        ) {
          const ok = await launchInternal('new', true)
          if (ok) return
        }

        const trailingOutput = pendingStyledOutputRef.current.current
        if (trailingOutput.length > 0) {
          term.write(styleTerminalLine(trailingOutput, pendingStyledOutputRef.current))
          pendingStyledOutputRef.current.current = ''
          pendingStyledOutputRef.current.insideToolBlock = false
        }

        setExitCode(code)
        setRuntimeTitle(null)
        trackedUserInputRef.current = {
          draft: '',
          dirty: false
        }
        setPhase('stopped')
        await onRefreshRef.current()
      }

      const exitCleanup = api.terminal.onExit((payload) => {
        if (payload.terminalId !== terminalIdRef.current) {
          return
        }
        void handleExit(payload.exitCode)
      })

      const sessionStartCleanup = api.terminal.onSessionStart((payload) => {
        if (kindRef.current !== 'agent') {
          return
        }
        if (payload.terminalId !== terminalIdRef.current) {
          return
        }

        resumeSessionIdRef.current = payload.sessionId
        if (payload.source === 'new') {
          lastPersistedCopilotTitleRef.current = null
          setRuntimeTitle(null)
        }

        const currentThread = threadRef.current
        if (!currentThread) {
          return
        }

        void api.appState
          .updateThreadResumeSession({
            threadId: currentThread.id,
            sessionId: payload.sessionId,
            source: payload.source
          })
          .then((ok) => {
            if (!ok) {
              return
            }
            return onRefreshRef.current()
          })
      })

      const userPromptCleanup = api.terminal.onUserPrompt((payload) => {
        if (kindRef.current !== 'agent') {
          return
        }
        if (payload.terminalId !== terminalIdRef.current) {
          return
        }

        const prompt = normalizeTrackedUserMessage(payload.prompt)
        setLastUserMessage((current) => (current === prompt ? current : prompt))
        const currentThread = threadRef.current
        if (currentThread && prompt === lastPersistedUserMessageRef.current) {
          void api.appState.updateThreadLastUserMessage({
            threadId: currentThread.id,
            message: prompt
          })
        }
      })

      const forwardTerminalInput = (data: string, trackedData: string | null = data): void => {
        const activeId = terminalIdRef.current
        if (!activeId || data.length === 0) return
        if (kindRef.current === 'agent' && trackedData !== null && trackedData.length > 0) {
          trackTerminalInput(trackedData)
        }
        api.terminal.input(activeId, data)
      }
      const inputDisposable = term.onData((data) => {
        forwardTerminalInput(data)
      })
      const pasteTerminalText = (text: string): void => {
        if (!terminalIdRef.current || text.length === 0) return
        focusTerminalInput(term)
        term.paste(text)
      }
      const pasteClipboardImage = async (): Promise<void> => {
        if (kindRef.current !== 'agent') {
          return
        }
        const capabilities = agentProviderRef.current.capabilities
        const activeTerminalId = terminalIdRef.current
        if (activeTerminalId && capabilities.supportsClipboardImagePathPaste) {
          const result = await api.terminal.saveClipboardImage(activeTerminalId)
          if (result.ok) {
            pasteTerminalText(` ${result.path} `)
            return
          }
          pasteTerminalText(` [image paste failed: ${result.error}] `)
          return
        }

        if (!capabilities.supportsClipboardImagePasteShortcut) {
          return
        }

        focusTerminalInput(term)
        markTrackedInputDirty()
        forwardTerminalInput('\x1bv', null)
      }
      const clipboardHasImage = (): boolean =>
        kindRef.current === 'agent' &&
        (agentProviderRef.current.capabilities.supportsClipboardImagePathPaste ||
          agentProviderRef.current.capabilities.supportsClipboardImagePasteShortcut) &&
        api.terminal.hasClipboardImage()
      const pasteClipboard = (): void => {
        if (clipboardHasImage()) {
          void pasteClipboardImage()
          return
        }
        pasteTerminalText(api.terminal.readClipboardText())
      }
      const pasteEventHasImage = (event: ClipboardEvent): boolean =>
        Array.from(event.clipboardData?.items ?? []).some((item) => item.type.startsWith('image/'))
      const handlePaste = (event: ClipboardEvent): void => {
        if (
          kindRef.current === 'agent' &&
          (agentProviderRef.current.capabilities.supportsClipboardImagePathPaste ||
            agentProviderRef.current.capabilities.supportsClipboardImagePasteShortcut) &&
          pasteEventHasImage(event)
        ) {
          event.preventDefault()
          event.stopPropagation()
          void pasteClipboardImage()
          return
        }
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return
        event.preventDefault()
        event.stopPropagation()
        pasteTerminalText(text)
      }
      container.addEventListener('paste', handlePaste)

      const handleWindowFocus = (): void => {
        if (!visibleRef.current || !terminalIdRef.current) {
          return
        }
        const document = container.ownerDocument
        if (hasBlockingModal(document)) {
          return
        }
        const activeElement = document.activeElement as HTMLElement | null
        if (isTextEntryElement(activeElement)) {
          return
        }
        focusTerminalInput(term)
      }

      window.addEventListener('focus', handleWindowFocus)

      // Translate provider-specific keys and let Ctrl-C copy when a selection exists.
      term.attachCustomKeyEventHandler((e: KeyboardEvent): boolean => {
        if (e.type !== 'keydown') return true
        const id = terminalIdRef.current
        if (!id) return true

        const onlyCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
        const onlyShift = e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
        const cancelHandledKey = (): false => {
          e.preventDefault()
          e.stopPropagation()
          return false
        }

        if (onlyCtrl && (e.key === 'c' || e.key === 'C')) {
          const sel = term.getSelection()
          if (sel) {
            void navigator.clipboard.writeText(sel)
            return cancelHandledKey()
          }
          return true
        }
        if (onlyCtrl && (e.key === 'v' || e.key === 'V')) {
          pasteClipboard()
          return cancelHandledKey()
        }
        if (onlyShift && e.key === 'Insert') {
          pasteClipboard()
          return cancelHandledKey()
        }

        if (kindRef.current !== 'agent') {
          return true
        }

        // Shift-Enter: backslash+CR is Copilot's documented multiline trick
        if (
          agentProviderRef.current.capabilities.usesBackslashEnterForMultiline &&
          onlyShift &&
          e.key === 'Enter'
        ) {
          trackPromptLineBreak()
          forwardTerminalInput('\\\r', null)
          return cancelHandledKey()
        }
        // Ctrl-Backspace -> Ctrl-W (delete word back)
        if (onlyCtrl && e.key === 'Backspace') {
          forwardTerminalInput('\x17')
          return cancelHandledKey()
        }
        // Ctrl-Delete -> Alt-D (delete word forward)
        if (onlyCtrl && e.key === 'Delete') {
          markTrackedInputDirty()
          forwardTerminalInput('\x1bd', null)
          return cancelHandledKey()
        }
        // Ctrl-Left/Right -> Alt-B/F so readline-style word motion works reliably.
        if (onlyCtrl && e.key === 'ArrowLeft') {
          markTrackedInputDirty()
          forwardTerminalInput('\x1bb', null)
          return cancelHandledKey()
        }
        if (onlyCtrl && e.key === 'ArrowRight') {
          markTrackedInputDirty()
          forwardTerminalInput('\x1bf', null)
          return cancelHandledKey()
        }

        return true
      })

      terminalRef.current = term

      return () => {
        container.removeEventListener('pointerdown', handlePointerDown)
        container.removeEventListener('paste', handlePaste)
        window.removeEventListener('focus', handleWindowFocus)
        resizeObserver.disconnect()
        exitCleanup()
        sessionStartCleanup()
        userPromptCleanup()
        dataCleanup()
        inputDisposable.dispose()
        titleDisposable.dispose()
        if (terminalIdRef.current) {
          void api.terminal.kill(terminalIdRef.current)
          terminalIdRef.current = null
          launchAttemptRef.current = null
        }
        term.dispose()
      }
    }, [launchInternal, markTrackedInputDirty, trackPromptLineBreak, trackTerminalInput])

    // External launch trigger via launchKey: parent increments to ask the
    // pane to (re)start. Effect-driven start() is intentional — it is the
    // bridge between an external imperative request and our async PTY
    // lifecycle.
    useEffect(() => {
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
      const container = containerRef.current
      if (!term || !container) return
      // RAF so layout is settled.
      const id = window.requestAnimationFrame(() => {
        fitTerminal(term, container)
        if (terminalIdRef.current) {
          api.terminal.resize(terminalIdRef.current, term.cols, term.rows)
        }
        focusTerminalInput(term)
      })
      return () => window.cancelAnimationFrame(id)
    }, [visible])

    return (
      <div
        className="absolute inset-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#141414]"
        style={{ display: visible ? 'block' : 'none' }}
      >
        <div className="absolute inset-3" ref={containerRef} />
      </div>
    )
  }
)

export default ThreadTerminal
