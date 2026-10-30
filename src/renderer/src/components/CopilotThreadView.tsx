import Select from './ui/Select'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import { flushSync } from 'react-dom'
import type {
  BranchStatusSnapshot,
  CopilotAttachment,
  CopilotInteractionResponse,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSendDelivery,
  CopilotSessionSnapshot,
  CopilotStartResult,
  RepositorySnapshot,
  ThreadCommitPhase,
  ThreadSetup,
  ThreadSnapshot
} from '../../../shared/app-types'
import { getRendererApi } from '../shared/api/client'
import type { ThreadSessionState } from './TerminalSessions'
import Button from './ui/Button'
import Presence from './ui/Presence'
import { AsideIcon, CloseIcon, PaperclipIcon, RefreshIcon } from './Icons'
import { canAnimate, usePresence } from '../lib/motion'
import { usePresenceList } from '../lib/use-presence-list'
import { toCopilotThreadSessionState } from '../lib/copilot-thread-status'
import InteractionPanel from './copilot/InteractionPanel'
import SessionModelControls from './copilot/SessionModelControls'
import SessionTimeline from './copilot/SessionTimeline'
import { reconcileSessionSnapshot } from '../lib/session-snapshot'
import PromptRail from './copilot/PromptRail'
import { messagePreview, type RailPrompt } from './copilot/prompt-rail'
import SessionPromptInput from './copilot/SessionPromptInput'
import ThreadSetupPanel from './copilot/ThreadSetupPanel'
import SendButton from './copilot/SendButton'
import CommitButton, { type CommitButtonAction } from './copilot/CommitButton'
import PendingMessages from './copilot/PendingMessages'
import AttachmentChips from './copilot/AttachmentChips'
import { EmptyConversation, RunningSubagents, WorkingIndicator } from './copilot/ConversationStates'
import { registerComposer, useSessionDraft } from './copilot/session-drafts'
import {
  expandPastedText,
  hasAttachmentMarker,
  insertAttachmentMarkers,
  markerRanges,
  removeAttachmentMarkers,
  withUniqueNames,
  type DraftAttachment
} from './copilot/attachment-markers'
import { stepReasoningEffort } from '../../../shared/reasoning-effort'
import { asideSessionKey } from '../../../shared/aside'

const api = getRendererApi()
type Props = {
  thread: ThreadSnapshot
  onSessionChange: (threadId: string, state: ThreadSessionState) => void
  // Another session is working in this thread's checkout, so committing now would race it.
  sharedCheckoutBusy?: boolean
  /** Model ids the model picker tucks under a Legacy row. */
  legacyModels?: string[]
  /** Shows the agent mode picker; otherwise every message is sent in interactive mode. */
  showModePicker?: boolean
  /** Pins or unpins a Copilot message; without it messages can't be pinned. */
  onSetMessagePinned?: (messageId: string, pinned: boolean) => Promise<unknown> | void
  /** Opens a new thread from the end of a message's turn, or from the latest turn without one. */
  onForkThread?: (messageId?: string) => Promise<unknown> | void
  /** The thread's project, for picking the checkout of a thread that has none yet. */
  repository?: RepositorySnapshot | null
  /** Changes the checkout a new thread gets with its first message. */
  onChangeSetup?: (setup: ThreadSetup) => Promise<unknown> | void
}
type SessionViewProps = Props & {
  /** The session shown: the thread's own by default, or its aside's. */
  sessionKey: string
  variant: 'thread' | 'aside'
  /** The toggle for the thread's aside panel. */
  aside?: { open: boolean; running: boolean; onToggle: () => void }
}
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const WORKING_TREE_POLL_MS = 15_000
const NONE: never[] = []
/** `instant` lands at once; `follow` glides over short distances; `jump` always glides. */
type ScrollMode = 'instant' | 'follow' | 'jump'
/** Share of the remaining distance the transcript moves per frame while following output. */
const FOLLOW_STEP = 0.25
const hasChanges = (status: BranchStatusSnapshot | null): boolean =>
  Boolean(
    status &&
    status.staged + status.modified + status.deleted + status.untracked + status.conflicted > 0
  )

async function imagePreview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return undefined
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/webp', 0.85)
  } catch {
    return undefined
  }
}

async function fileToAttachment(file: File): Promise<CopilotAttachment> {
  const path = api.copilot.getPathForFile(file)
  const previewUrl = await imagePreview(file)
  if (path)
    return { id: crypto.randomUUID(), type: 'file', path, displayName: file.name, previewUrl }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed.')))
    reader.readAsDataURL(file)
  })
  return {
    id: crypto.randomUUID(),
    type: 'blob',
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mimeType: file.type || 'application/octet-stream',
    displayName: file.name || (file.type.startsWith('image/') ? 'Pasted image' : 'Pasted file'),
    previewUrl
  }
}

// Which threads have their aside panel open, so it stays open when switching threads and back.
const openAsides = new Set<string>()

/** Whether a thread's aside is working, for its toggle while the panel is closed. */
function useAsideRunning(threadId: string, enabled: boolean): boolean {
  const key = asideSessionKey(threadId)
  const [state, setState] = useState<{ key: string; running: boolean } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let received = false
    const unsubscribe = api.copilot.onSession(({ snapshot }) => {
      if (snapshot.threadId !== key) return
      received = true
      setState({ key, running: snapshot.phase === 'running' })
    })
    void api.copilot
      .getSession(key)
      .then((snapshot) => {
        if (!cancelled && !received) setState({ key, running: snapshot?.phase === 'running' })
      })
      .catch(() => {
        /* Only the indicator depends on it. */
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [key, enabled])
  return enabled && state?.key === key && state.running
}

// Key the entire session lifecycle, including pending async work, to its thread.
export default function CopilotThreadView(props: Props): React.JSX.Element {
  const threadId = props.thread.id
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const asideOpen = openAsides.has(threadId)
  const setAsideOpen = useCallback(
    (open: boolean) => {
      if (open) openAsides.add(threadId)
      else openAsides.delete(threadId)
      rerender()
    },
    [threadId]
  )
  // Only a thread that has had an aside can have one working.
  const asideRunning = useAsideRunning(threadId, Boolean(props.thread.aside))
  return (
    <div className="tm-session-host">
      <SessionView
        key={threadId}
        {...props}
        sessionKey={threadId}
        variant="thread"
        aside={{ open: asideOpen, running: asideRunning, onToggle: () => setAsideOpen(!asideOpen) }}
      />
      <AsidePanel
        key={asideSessionKey(threadId)}
        thread={props.thread}
        open={asideOpen}
        legacyModels={props.legacyModels}
        onClose={() => setAsideOpen(false)}
      />
    </div>
  )
}

const ignoreSessionChange = (): void => undefined

/** A side conversation on a fork of the thread's session, sliding in over its right side. */
function AsidePanel({
  thread,
  open,
  legacyModels,
  onClose
}: {
  thread: ThreadSnapshot
  open: boolean
  legacyModels?: string[]
  onClose: () => void
}): React.JSX.Element | null {
  const presence = usePresence(open)
  // Remounts the conversation once it starts over.
  const [generation, setGeneration] = useState(0)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    // Let the composer mount first.
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    )
    return () => cancelAnimationFrame(frame)
  }, [open])
  const startOver = (): void => {
    if (restarting) return
    setRestarting(true)
    setError(null)
    void api.copilot
      .resetAside(thread.id)
      .then((result) => {
        if (!result.ok) setError(result.error ?? 'Could not start the aside over.')
      })
      .catch((cause) => setError(message(cause)))
      .finally(() => {
        setRestarting(false)
        setGeneration((value) => value + 1)
      })
  }
  if (!presence.mounted) return null
  return (
    <aside
      ref={panelRef}
      className="tm-aside"
      data-state={presence.state}
      aria-label="Aside"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header className="tm-aside-header">
        <AsideIcon className="tm-aside-icon" aria-hidden="true" />
        <div className="tm-aside-title">
          <h2>Aside</h2>
          <p>Talk about this thread without affecting it.</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          disabled={restarting}
          aria-label="Start over"
          title="Start over from the thread's conversation as it is now"
          onClick={startOver}
        >
          <RefreshIcon aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label="Close aside"
          title="Close aside (Esc)"
          onClick={onClose}
        >
          <CloseIcon aria-hidden="true" />
        </Button>
      </header>
      {error ? (
        <div className="tm-aside-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="tm-aside-body">
        {restarting ? (
          <div className="tm-aside-restarting" role="status">
            Starting over…
          </div>
        ) : (
          <SessionView
            key={generation}
            thread={thread}
            sessionKey={asideSessionKey(thread.id)}
            variant="aside"
            legacyModels={legacyModels}
            onSessionChange={ignoreSessionChange}
          />
        )}
      </div>
    </aside>
  )
}

function SessionView({
  thread,
  sessionKey,
  variant,
  aside,
  onSessionChange,
  sharedCheckoutBusy = false,
  legacyModels,
  showModePicker = false,
  onSetMessagePinned,
  onForkThread,
  repository,
  onChangeSetup
}: SessionViewProps): React.JSX.Element {
  const isAside = variant === 'aside'
  const [session, setSession] = useState<CopilotSessionSnapshot | null>(null)
  const [sdk, setSdk] = useState<CopilotSdkStatus | null>(null)
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [draft, updateDraft] = useSessionDraft(sessionKey)
  const { prompt, attachments } = draft
  const agentMode = showModePicker
    ? (draft.agentMode ?? session?.agentMode ?? 'interactive')
    : 'interactive'
  const [ownBusy, setBusy] = useState<string | null>(null)
  // A commit or push started before this view opened (e.g. before switching threads away and
  // back) keeps blocking the session just like one started here.
  const [commitPhase, setCommitPhase] = useState<ThreadCommitPhase | null>(null)
  const resumedCommitPhase = commitPhase === null ? (thread.commitPhase ?? null) : null
  const busy = ownBusy ?? (resumedCommitPhase ? 'commit' : null)
  const resumedCommitRef = useRef(false)
  const showSetup = !isAside && Boolean(thread.pendingSetup && repository && onChangeSetup)
  // Keeps the panel's contents while it collapses away once the checkout is made.
  const [shownSetup, setShownSetup] = useState(thread.pendingSetup)
  if (thread.pendingSetup && thread.pendingSetup !== shownSetup) setShownSetup(thread.pendingSetup)
  resumedCommitRef.current = resumedCommitPhase !== null
  const [delivery, setDelivery] = useState<CopilotSendDelivery>('steer')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const busyRef = useRef(false)
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const followOutput = useRef(true)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(false)
  const sessionRevision = useRef(0)
  const onSessionChangeRef = useRef(onSessionChange)
  onSessionChangeRef.current = onSessionChange

  const updateSession = useCallback(
    (next: CopilotSessionSnapshot): void => {
      if (!mounted.current || next.threadId !== sessionKey) return
      setSession((previous) => reconcileSessionSnapshot(previous, next))
      onSessionChangeRef.current(sessionKey, toCopilotThreadSessionState(next))
    },
    [sessionKey]
  )

  const acceptResult = useCallback(
    (result: CopilotStartResult, revision: number): void => {
      if (!mounted.current) return
      // Events are newer than an in-flight IPC response; never roll them back.
      if (result.snapshot && revision === sessionRevision.current) updateSession(result.snapshot)
      if (!result.ok) throw new Error(result.error ?? 'Copilot could not complete that action.')
    },
    [updateSession]
  )

  const run = useCallback(async (name: string, operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current || resumedCommitRef.current) return
    busyRef.current = true
    setBusy(name)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      if (mounted.current) setError(message(cause))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(null)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let statusRevision = 0
    const unsubscribeSession = api.copilot.onSession(({ snapshot }) => {
      if (snapshot.threadId !== sessionKey) return
      sessionRevision.current++
      updateSession(snapshot)
    })
    const unsubscribeStatus = api.copilot.onSdkStatus(({ status }) => {
      statusRevision++
      setSdk(status)
    })
    const revision = sessionRevision.current
    void (async () => {
      try {
        const existing = await api.copilot.getSession(sessionKey)
        if (cancelled) return
        if (existing && existing.phase !== 'disconnected') {
          if (revision === sessionRevision.current) updateSession(existing)
        } else {
          const result = await api.copilot.start(sessionKey)
          if (!cancelled) acceptResult(result, revision)
        }
      } catch (cause) {
        if (!cancelled) setError(message(cause))
      }
    })()
    void api.copilot
      .getSdkStatus()
      .then((status) => {
        if (!cancelled && statusRevision === 0) setSdk(status)
      })
      .catch((cause) => {
        if (!cancelled) setError(message(cause))
      })
    return () => {
      cancelled = true
      mounted.current = false
      unsubscribeSession()
      unsubscribeStatus()
    }
  }, [sessionKey, updateSession, acceptResult])

  useEffect(() => {
    let cancelled = false
    let changed = false
    const unsubscribe = api.copilot.onFavoriteModels(({ models }) => {
      changed = true
      setFavoriteModels(models)
    })
    void api.copilot
      .getFavoriteModels()
      .then((models) => {
        if (!cancelled && !changed) setFavoriteModels(models)
      })
      .catch(() => {
        /* Favorites are optional; the picker works without them. */
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const toggleFavoriteModel = useCallback((model: string, favorite: boolean): void => {
    setFavoriteModels((current) =>
      favorite
        ? [...current.filter((id) => id !== model), model]
        : current.filter((id) => id !== model)
    )
    void api.copilot
      .setModelFavorite({ model, favorite })
      .then(setFavoriteModels)
      .catch((cause) => setError(message(cause)))
  }, [])

  const hasTimeline = Boolean(session?.timeline.length)
  // Connecting snapshots carry no history yet, and a failed start (e.g. not signed in) may still
  // have history to restore; only a running session's empty timeline means a new conversation.
  const historyLoaded = session?.phase === 'idle' || session?.phase === 'running'
  // Whether this conversation started out empty, so its first items animate in. Loaded
  // history appears at once.
  const [startedEmptyThread, setStartedEmptyThread] = useState<string | null>(null)
  if (historyLoaded && !hasTimeline && startedEmptyThread !== sessionKey)
    setStartedEmptyThread(sessionKey)
  const startedEmpty = startedEmptyThread === sessionKey
  // The prompt rail can jump to a prompt the progressive history hasn't rendered yet.
  const [revealedThread, setRevealedThread] = useState<string | null>(null)
  const revealHistory = useCallback(() => {
    flushSync(() => setRevealedThread(sessionKey))
  }, [sessionKey])
  const emptyState = usePresence(Boolean(session && session.phase !== 'connecting') && !hasTimeline)
  const mcpNotices = usePresenceList(
    session?.mcpServersNeedingAuth ?? NONE,
    (serverName: string) => serverName,
    sessionKey
  )

  const prompts = useMemo(
    () =>
      (session?.timeline ?? []).filter(
        (item): item is typeof item & RailPrompt => item.type === 'user'
      ),
    [session?.timeline]
  )
  // The rail's gutter eases open when a conversation gets its first prompt, but not when a
  // thread opens with prompts (that would shift the whole history sideways).
  const [railAtLoad, setRailAtLoad] = useState<boolean | null>(null)
  if (session && railAtLoad === null) setRailAtLoad(prompts.length > 0)

  // Pins show at once and settle when the saved snapshot arrives.
  const [pinOverrides, setPinOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const savedPins = isAside ? undefined : thread.pinnedMessageIds
  const pinnedIds = useMemo(() => {
    const ids = new Set(savedPins ?? NONE)
    for (const [id, pinned] of pinOverrides) {
      if (pinned) ids.add(id)
      else ids.delete(id)
    }
    return ids
  }, [savedPins, pinOverrides])
  const pins = useMemo(
    () =>
      (session?.timeline ?? []).filter(
        (item): item is typeof item & RailPrompt =>
          item.type === 'assistant' && pinnedIds.has(item.id)
      ),
    [session?.timeline, pinnedIds]
  )
  const [pinsAtLoad, setPinsAtLoad] = useState<boolean | null>(null)
  if (session && pinsAtLoad === null) setPinsAtLoad(pins.length > 0)
  // Generated headings arrive a moment after pinning; until then the message's start shows.
  const pinTitles = isAside ? undefined : thread.pinnedMessageTitles
  const pinPreview = useCallback(
    (item: RailPrompt) => pinTitles?.[item.id] ?? messagePreview(item),
    [pinTitles]
  )
  const pinRef = useRef(onSetMessagePinned)
  useLayoutEffect(() => {
    pinRef.current = onSetMessagePinned
  })
  const togglePin = useCallback((messageId: string, pinned: boolean) => {
    const save = pinRef.current
    if (!save) return
    setPinOverrides((current) => new Map(current).set(messageId, pinned))
    const settle = (): void =>
      setPinOverrides((current) => {
        if (current.get(messageId) !== pinned) return current
        const next = new Map(current)
        next.delete(messageId)
        return next
      })
    void (async () => {
      try {
        await save(messageId, pinned)
      } finally {
        settle()
      }
    })().catch(() => {})
  }, [])
  const stopFollowing = useCallback(() => {
    followOutput.current = false
  }, [])
  const resetToMessage = useCallback(
    (messageId: string) =>
      void run('reset', async () => {
        const revision = sessionRevision.current
        const result = await api.copilot.resetToMessage({ threadId: sessionKey, messageId })
        if (result.cancelled) return
        acceptResult(result, revision)
      }),
    [run, acceptResult, sessionKey]
  )
  const forkRef = useRef(onForkThread)
  useLayoutEffect(() => {
    forkRef.current = onForkThread
  })
  const forkFromMessage = useCallback(
    (messageId: string) =>
      void run('fork', async () => {
        await forkRef.current?.(messageId)
      }),
    [run]
  )

  // Following output glides towards the end a frame at a time; scroll events at the positions
  // it sets are its own, so they don't count as the user scrolling away.
  const followFrame = useRef<number | null>(null)
  const ownScrollTop = useRef<number | null>(null)
  const scrollToLatest = useCallback((mode: ScrollMode) => {
    const element = timelineRef.current
    if (!element) return
    const distance = element.scrollHeight - element.clientHeight - element.scrollTop
    // Large catch-ups (opening a thread, a burst of output) land instantly.
    const glide =
      mode !== 'instant' &&
      canAnimate() &&
      distance > 1 &&
      (mode === 'jump' || distance <= element.clientHeight)
    if (!glide) {
      if (followFrame.current !== null) cancelAnimationFrame(followFrame.current)
      followFrame.current = null
      element.scrollTop = element.scrollHeight
      ownScrollTop.current = element.scrollTop
      return
    }
    if (followFrame.current !== null) return
    const step = (): void => {
      const current = timelineRef.current
      if (!current || !followOutput.current) {
        followFrame.current = null
        return
      }
      const remaining = current.scrollHeight - current.clientHeight - current.scrollTop
      if (remaining <= 1) {
        current.scrollTop = current.scrollHeight
        ownScrollTop.current = current.scrollTop
        followFrame.current = null
        return
      }
      current.scrollTop += Math.max(1, Math.round(remaining * FOLLOW_STEP))
      ownScrollTop.current = current.scrollTop
      followFrame.current = requestAnimationFrame(step)
    }
    followFrame.current = requestAnimationFrame(step)
  }, [])
  useEffect(
    () => () => {
      if (followFrame.current !== null) cancelAnimationFrame(followFrame.current)
    },
    []
  )
  const jumpToLatest = useCallback(
    (mode: ScrollMode = 'follow') => {
      followOutput.current = true
      setAtBottom(true)
      scrollToLatest(mode)
    },
    [scrollToLatest]
  )
  // The first snapshot lands at the end at once; later output glides there.
  const timelineLoaded = useRef(false)
  const sessionLoaded = session !== null
  useLayoutEffect(() => {
    if (followOutput.current) jumpToLatest(timelineLoaded.current ? 'follow' : 'instant')
    if (sessionLoaded) timelineLoaded.current = true
  }, [sessionLoaded, session?.timeline, session?.phase, session?.pendingInteraction, jumpToLatest])
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followOutput.current) jumpToLatest()
    })
    if (contentRef.current) observer.observe(contentRef.current)
    if (timelineRef.current) observer.observe(timelineRef.current)
    return () => observer.disconnect()
  }, [jumpToLatest])

  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    promptRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [prompt])
  // Insert a marker at the caret so the message shows where each file belongs.
  const attach = (added: DraftAttachment[], replaceSelection = false): void => {
    if (!added.length) return
    const element = promptRef.current
    updateDraft((current) => {
      const named = withUniqueNames(added, current.attachments)
      let end = element?.selectionEnd ?? current.prompt.length
      let start = replaceSelection ? (element?.selectionStart ?? end) : end
      // A selection that cuts into a marker replaces all of it.
      for (const range of markerRanges(
        current.prompt,
        current.attachments.map((item) => item.displayName)
      ))
        if (start < end && range.start < end && range.end > start) {
          start = Math.min(start, range.start)
          end = Math.max(end, range.end)
        }
      const next = insertAttachmentMarkers(
        current.prompt,
        named.map((item) => item.displayName),
        start,
        end,
        // Pasted text goes back exactly where it was pasted.
        named.some((item) => item.type !== 'text')
      )
      pendingCaret.current = next.caret
      return {
        ...current,
        prompt: next.prompt,
        // Attachments whose markers the selection replaced are gone.
        attachments: [...current.attachments, ...named].filter((item) =>
          hasAttachmentMarker(next.prompt, item.displayName)
        )
      }
    })
    if (mounted.current) promptRef.current?.focus()
  }
  const attachRef = useRef(attach)
  attachRef.current = attach
  useEffect(() => registerComposer(sessionKey, (added) => attachRef.current(added)), [sessionKey])
  const addFiles = (files: File[], replaceSelection = false): void => {
    if (busyRef.current) {
      setError('Wait for the current action to finish, then attach your files again.')
      return
    }
    void run('attachments', async () => {
      attach(await Promise.all(files.map(fileToAttachment)), replaceSelection)
    })
  }
  const running = session?.phase === 'running'
  const ready = session?.phase === 'idle' && !session.pendingInteraction && !stopping
  // Messages sent while Copilot works steer the current turn or wait in the queue.
  const sendWhileRunning = running && !session?.pendingInteraction && !stopping
  // A pending request can be skipped by replying from the composer instead.
  const replyTo = stopping ? undefined : session?.pendingInteraction
  const replying = Boolean(replyTo?.replyMode) && (replyTo?.replyMode === 'feedback' || running)
  const send = (): void => {
    if (
      !(ready || sendWhileRunning || replying) ||
      stoppingRef.current ||
      (!prompt.trim() && !attachments.length)
    )
      return
    const sentDelivery = replying ? 'steer' : sendWhileRunning ? delivery : undefined
    void run('send', async () => {
      const revision = sessionRevision.current
      const message = expandPastedText(prompt, attachments)
      const result = await api.copilot.send({
        threadId: sessionKey,
        prompt: message.prompt.trim(),
        attachments: message.attachments,
        ...(message.pastedTexts.length ? { pastedTexts: message.pastedTexts } : {}),
        agentMode,
        ...(replying && replyTo
          ? { replyToInteractionId: replyTo.id }
          : sentDelivery
            ? { delivery: sentDelivery }
            : {})
      })
      acceptResult(result, revision)
      if (result.ok) {
        // Keep any draft changes made while this request was in flight.
        updateDraft((current) => {
          const nextPrompt = current.prompt === prompt ? '' : current.prompt
          return {
            ...current,
            prompt: nextPrompt,
            // Steering joins the running turn, so the chosen mode still applies to the next one.
            agentMode:
              sentDelivery !== 'steer' && current.agentMode === draft.agentMode
                ? null
                : current.agentMode,
            // An edited draft keeps the attachments its markers still refer to.
            attachments: current.attachments.filter(
              (item) =>
                !attachments.some((sent) => sent.id === item.id) ||
                hasAttachmentMarker(nextPrompt, item.displayName)
            )
          }
        })
        if (mounted.current) {
          jumpToLatest()
          promptRef.current?.focus()
        }
      }
    })
  }
  const cancelQueued = (queuedId: string): void => {
    setCancelling(queuedId)
    setError(null)
    void (async () => {
      try {
        const revision = sessionRevision.current
        acceptResult(await api.copilot.cancelQueued({ threadId: sessionKey, queuedId }), revision)
      } catch (cause) {
        if (mounted.current) setError(message(cause))
      } finally {
        if (mounted.current) setCancelling(null)
      }
    })()
  }
  const start = (): void => {
    void run('start', async () => {
      const revision = sessionRevision.current
      acceptResult(await api.copilot.start(sessionKey), revision)
    })
  }
  const respond = (response: CopilotInteractionResponse): void => {
    void run('respond', async () => {
      if (!(await api.copilot.respond(response)))
        throw new Error('This request is no longer available. Please try again.')
      promptRef.current?.focus()
    })
  }
  const signInToMcpServer = (serverName: string): void => {
    void run(`mcp-auth:${serverName}`, async () => {
      const revision = sessionRevision.current
      const result = await api.copilot.authenticateMcpServer({ threadId: sessionKey, serverName })
      acceptResult(result, revision)
    })
  }
  const stop = async (): Promise<void> => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    setError(null)
    try {
      if (!(await api.copilot.abort(sessionKey)))
        throw new Error('This session is no longer running.')
    } catch (cause) {
      if (mounted.current) setError(message(cause))
    } finally {
      stoppingRef.current = false
      if (mounted.current) setStopping(false)
    }
  }
  const changeModel = (model: string, reasoningEffort: CopilotReasoningEffort | null): void => {
    void run('model', async () => {
      const revision = sessionRevision.current
      acceptResult(
        await api.copilot.setModel({ threadId: sessionKey, model, reasoningEffort }),
        revision
      )
    })
  }

  const modelControlsDisabled =
    (session?.phase !== 'idle' && session?.phase !== 'running') ||
    (session?.phase === 'idle' && Boolean(session.pendingInteraction)) ||
    Boolean(busy) ||
    stopping
  const stepEffort = (direction: 1 | -1): void => {
    if (modelControlsDisabled || !session) return
    const selection = session.nextModelSelection ?? {
      model: session.model,
      reasoningEffort: session.reasoningEffort
    }
    const model = session.models.find((option) => option.id === selection.model)
    if (!model) return
    const next = stepReasoningEffort(
      model.supportedReasoningEfforts,
      selection.reasoningEffort,
      model.defaultReasoningEffort,
      direction
    )
    if (next) changeModel(model.id, next)
  }

  const usesGit = !isAside && thread.projectKind !== 'general'
  const idle = session?.phase === 'idle'
  const [workingTree, setWorkingTree] = useState<BranchStatusSnapshot | null>(null)
  const commitActive = useRef(false)
  const workingTreeRevision = useRef(0)
  const refreshWorkingTree = useCallback(async (): Promise<void> => {
    const revision = ++workingTreeRevision.current
    try {
      const status = await api.appState.getBranchStatus({ threadId: thread.id })
      if (mounted.current && revision === workingTreeRevision.current) setWorkingTree(status)
    } catch {
      /* Without a status the commit button just stays hidden. */
    }
  }, [thread.id])
  // Re-check whenever a session connects (e.g. after a restart) or a turn ends, then keep it
  // fresh while idle.
  const connectedSessionId = idle ? (session?.sessionId ?? null) : null
  useEffect(() => {
    if (!usesGit || !idle) return
    void refreshWorkingTree()
    const interval = window.setInterval(() => void refreshWorkingTree(), WORKING_TREE_POLL_MS)
    const onFocus = (): void => void refreshWorkingTree()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [usesGit, idle, connectedSessionId, sharedCheckoutBusy, refreshWorkingTree])
  useEffect(
    () =>
      api.appState.onCommitProgress(({ threadId, phase }) => {
        if (threadId === thread.id && commitActive.current) setCommitPhase(phase)
      }),
    [thread.id]
  )
  // Once a resumed commit finishes, check what's left to commit or push.
  const resumedCommit = resumedCommitPhase !== null
  useEffect(() => {
    if (!resumedCommit) return
    return () => void refreshWorkingTree()
  }, [resumedCommit, refreshWorkingTree])
  const canCommit = usesGit && ready && !sharedCheckoutBusy && hasChanges(workingTree)
  const canPush = usesGit && ready && !sharedCheckoutBusy && (workingTree?.ahead ?? 0) > 0
  const [commitAction, setCommitAction] = useState<CommitButtonAction>('commit')
  const shownPhase = commitPhase ?? resumedCommitPhase
  const shownAction: CommitButtonAction =
    commitPhase !== null
      ? commitAction
      : resumedCommitPhase !== null
        ? // Pushing without auto-push can only be a plain push.
          resumedCommitPhase === 'pushing' && !thread.commitAutoPush
          ? 'push'
          : 'commit'
        : canCommit
          ? 'commit'
          : 'push'
  const showCommit = shownPhase !== null || canCommit || canPush
  const commitDisabledReason =
    (workingTree?.conflicted ?? 0) > 0 && shownAction === 'commit'
      ? 'Resolve merge conflicts before committing'
      : busy
        ? 'Wait for the current action to finish'
        : null
  const commit = (): void => {
    if (!canCommit || shownPhase || commitDisabledReason || busyRef.current) return
    setCommitAction('commit')
    commitActive.current = true
    setCommitPhase('generating')
    void run('commit', async () => {
      try {
        const result = await api.appState.commitThreadChanges(thread.id)
        // Hide the button until a fresh status confirms what's left to commit.
        if (result.committed && mounted.current) setWorkingTree(null)
        if (!result.ok) throw new Error(result.error ?? 'Could not commit the changes.')
      } finally {
        commitActive.current = false
        if (mounted.current) setCommitPhase(null)
        void refreshWorkingTree()
      }
    })
  }
  const push = (): void => {
    if (!canPush || shownPhase || busy || busyRef.current) return
    setCommitAction('push')
    commitActive.current = true
    setCommitPhase('pushing')
    void run('push', async () => {
      try {
        const result = await api.appState.pushThreadChanges(thread.id)
        if (result.pushed && mounted.current) setWorkingTree(null)
        if (!result.ok) throw new Error(result.error ?? 'Could not push the commits.')
      } finally {
        commitActive.current = false
        if (mounted.current) setCommitPhase(null)
        void refreshWorkingTree()
      }
    })
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  const pushRef = useRef(push)
  pushRef.current = push
  useEffect(() => {
    if (isAside) return
    const handler = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        (key !== 's' && key !== 'd') ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        // A view that is crossfading out (or otherwise inert) no longer owns the shortcut.
        sectionRef.current?.closest('[data-state="closed"], [inert]')
      )
        return
      event.preventDefault()
      if (event.repeat) return
      if (key === 's') commitRef.current()
      else pushRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isAside])
  const status = stopping
    ? 'Stopping…'
    : busy === 'start'
      ? 'Reconnecting…'
      : session?.pendingInteraction
        ? 'Needs your input'
        : running
          ? 'Working…'
          : session?.phase === 'idle'
            ? 'Ready'
            : session?.phase === 'error' || (error && !session)
              ? session?.sessionId
                ? 'Session error'
                : 'Could not connect'
              : session?.phase === 'disconnected'
                ? 'Disconnected'
                : 'Connecting…'

  return (
    <section
      ref={sectionRef}
      className="tm-session"
      aria-label="Copilot session"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        if (event.dataTransfer.files.length) addFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <span
        className="sr-only"
        role="status"
        title={`Copilot SDK ${sdk?.installedVersion ?? '…'}${sdk?.runtimeVersion ? ` · Runtime ${sdk.runtimeVersion}` : ''}`}
      >
        {status}
      </span>
      <div className="relative min-h-0 flex-1">
        <div
          className={[
            'tm-session-scroll',
            prompts.length > 0 ? 'tm-session-scroll--with-rail' : '',
            pins.length > 0 ? 'tm-session-scroll--with-pins' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          data-rail-motion={railAtLoad === false || pinsAtLoad === false || undefined}
          ref={timelineRef}
          role="region"
          aria-label="Conversation"
          tabIndex={0}
          onScroll={() => {
            const element = timelineRef.current
            if (!element) return
            if (
              ownScrollTop.current !== null &&
              Math.abs(element.scrollTop - ownScrollTop.current) < 1
            )
              return
            ownScrollTop.current = null
            const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64
            followOutput.current = bottom
            setAtBottom(bottom)
          }}
        >
          <div className="tm-session-transcript" ref={contentRef}>
            {/* Fades out over the first message; a thread that opens with history skips it. */}
            {emptyState.mounted && (!hasTimeline || startedEmpty) ? (
              <EmptyConversation
                data-motion="fade"
                data-state={emptyState.state}
                variant={variant}
                onSuggest={(suggestion) => {
                  updateDraft((current) => ({ ...current, prompt: suggestion }))
                  promptRef.current?.focus()
                }}
              />
            ) : null}
            {session && hasTimeline ? (
              <SessionTimeline
                animateInitial={startedEmpty}
                items={session.timeline}
                key={sessionKey}
                showAll={revealedThread === sessionKey}
                pinnedIds={pinnedIds}
                onTogglePin={!isAside && onSetMessagePinned ? togglePin : undefined}
                running={running}
                onReset={isAside ? undefined : resetToMessage}
                onFork={!isAside && onForkThread ? forkFromMessage : undefined}
                resetDisabled={!ready || Boolean(busy)}
                forkDisabled={Boolean(busy) || stopping}
              />
            ) : null}
            <Presence show={running} motion="collapse">
              <WorkingIndicator
                waiting={Boolean(session?.pendingInteraction)}
                since={session?.workingSince}
              />
            </Presence>
            <Presence show={(session?.runningSubagents?.length ?? 0) > 0} motion="collapse">
              <RunningSubagents agents={session?.runningSubagents ?? []} />
            </Presence>
          </div>
        </div>
        <PromptRail
          prompts={prompts}
          scrollRef={timelineRef}
          onNavigate={stopFollowing}
          onRevealHistory={revealHistory}
        />
        <PromptRail
          prompts={pins}
          scrollRef={timelineRef}
          onNavigate={stopFollowing}
          onRevealHistory={revealHistory}
          side="right"
          label="Pinned messages"
          itemName="Pinned message"
          targetAttribute="data-message-id"
          minItems={1}
          preview={pinPreview}
        />
        <Presence show={!atBottom} motion="rise">
          <Button size="sm" className="tm-session-jump" onClick={() => jumpToLatest('jump')}>
            ↓ Jump to latest
          </Button>
        </Presence>
      </div>
      <div className="tm-session-bottom">
        <Presence show={!isAside && Boolean(sdk?.updateAvailable)} motion="collapse">
          <div className="tm-session-slot flex justify-end">
            <Button
              disabled={
                Boolean(busy) ||
                running ||
                stopping ||
                Boolean(session?.pendingInteraction) ||
                session?.phase === 'connecting' ||
                sdk?.updateState === 'installing'
              }
              title={`Update Copilot to ${sdk?.latestVersion ?? 'the latest version'}`}
              size="sm"
              variant="ghost"
              onClick={() =>
                void run('update', async () => {
                  const status = await api.copilot.updateSdk()
                  if (mounted.current) setSdk(status)
                  if (status.blockingThreads.length)
                    throw new Error(
                      `Finish or stop these sessions before updating: ${status.blockingThreads.map((item) => item.title).join(', ')}`
                    )
                  const revision = sessionRevision.current
                  acceptResult(await api.copilot.start(sessionKey), revision)
                })
              }
            >
              {sdk?.updateState === 'installing' ? 'Updating…' : 'Update available'}
            </Button>
          </div>
        </Presence>
        <Presence show={Boolean(error || session?.error)} motion="collapse">
          <div className="tm-session-slot">
            <div className="tm-session-error" role="alert">
              <span>{error ?? session?.error}</span>
              <Presence
                show={Boolean(error && error !== session?.error && error !== sdk?.updateError)}
                motion="fade"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                >
                  Dismiss
                </Button>
              </Presence>
            </div>
          </div>
        </Presence>
        <Presence
          show={
            session?.phase === 'error' || session?.phase === 'disconnected' || (!session && !!error)
          }
          motion="collapse"
        >
          <div className="tm-session-slot flex justify-end">
            <Button size="sm" disabled={Boolean(busy)} onClick={start}>
              {busy === 'start' ? 'Reconnecting…' : 'Reconnect'}
            </Button>
          </div>
        </Presence>
        {mcpNotices.map(({ key: serverName, exitToken }) => {
          const started = session?.mcpServersSigningIn.includes(serverName) ?? false
          return (
            <div
              className="tm-session-slot"
              key={serverName}
              data-motion="collapse"
              data-state={exitToken === null ? 'open' : 'closed'}
            >
              <div className="tm-session-notice" role="status">
                <span>
                  {started
                    ? `Finish signing in to ${serverName} in your browser.`
                    : `${serverName} needs you to sign in before Copilot can use it.`}
                </span>
                <Button
                  size="sm"
                  variant={started ? 'ghost' : 'primary'}
                  disabled={Boolean(busy)}
                  onClick={() => signInToMcpServer(serverName)}
                >
                  {busy === `mcp-auth:${serverName}`
                    ? 'Opening…'
                    : started
                      ? 'Open sign-in again'
                      : `Sign in to ${serverName}`}
                </Button>
              </div>
            </div>
          )
        })}
        <Presence show={Boolean(sdk?.updateError)} motion="collapse">
          <div className="tm-session-slot">
            <div className="tm-session-notice tm-session-notice--warning" role="status">
              Copilot update: {sdk?.updateError}
            </div>
          </div>
        </Presence>
        <div className="tm-session-composer">
          <Presence show={Boolean(session?.pendingInteraction)} motion="collapse">
            <div>
              {session?.pendingInteraction ? (
                <div
                  className="tm-session-request"
                  role="region"
                  aria-label={session.pendingInteraction.title}
                >
                  <div className="tm-fade-in" key={session.pendingInteraction.id}>
                    <InteractionPanel
                      interaction={session.pendingInteraction}
                      threadId={sessionKey}
                      onRespond={respond}
                      busy={Boolean(busy) || stopping}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </Presence>
          <PendingMessages
            steering={session?.steeringMessages ?? NONE}
            queued={session?.queuedMessages ?? NONE}
            cancelling={cancelling}
            onCancel={cancelQueued}
          />
          <AttachmentChips
            attachments={attachments}
            onRemove={(attachment) =>
              updateDraft((current) => ({
                ...current,
                prompt: removeAttachmentMarkers(current.prompt, attachment.displayName),
                attachments: current.attachments.filter((item) => item.id !== attachment.id)
              }))
            }
          />
          <SessionPromptInput
            threadId={sessionKey}
            sessionId={session?.sessionId ?? null}
            connected={session?.phase === 'idle' || session?.phase === 'running'}
            inputRef={promptRef}
            prompt={prompt}
            timeline={session?.timeline ?? []}
            hasAttachments={attachments.length > 0}
            hasInteraction={Boolean(session?.pendingInteraction)}
            mode={replying ? 'reply' : running ? delivery : 'send'}
            interactionKind={session?.pendingInteraction?.kind}
            onChange={(value) =>
              updateDraft((current) => ({
                ...current,
                prompt: value,
                // A file stays attached only while its marker is in the message.
                attachments: current.attachments.filter((item) =>
                  hasAttachmentMarker(value, item.displayName)
                )
              }))
            }
            onSend={send}
            onFiles={(files) => addFiles(files, true)}
            onPastedText={(pasted) => attach([pasted], true)}
            onStepEffort={stepEffort}
            attachmentNames={attachments.map((item) => item.displayName)}
          />
          <div className="tm-session-controls">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              disabled={Boolean(busy)}
              aria-label="Attach files"
              title="Attach files (or drop them anywhere in this session)"
              onClick={() =>
                void run('attachments', async () => {
                  const result = await api.copilot.pickAttachments()
                  if (!result.ok && !result.cancelled)
                    throw new Error(result.error ?? 'Could not attach files.')
                  if (result.attachments) attach(result.attachments)
                })
              }
            >
              <PaperclipIcon aria-hidden="true" />
            </Button>
            {aside ? (
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                className="tm-aside-toggle"
                aria-pressed={aside.open}
                aria-label={aside.open ? 'Close aside' : 'Open aside'}
                title="Aside: talk about this thread without affecting it"
                data-running={aside.running || undefined}
                onClick={aside.onToggle}
              >
                <AsideIcon aria-hidden="true" />
              </Button>
            ) : null}
            {showModePicker ? (
              <label className="tm-session-setting" title="Mode for your next message">
                <span>Mode</span>
                <Select
                  compact
                  aria-label="Agent mode"
                  value={agentMode}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      agentMode: value as typeof agentMode
                    }))
                  }
                  title="Mode for your next message"
                  options={[
                    { value: 'interactive', label: 'Interactive' },
                    { value: 'plan', label: 'Plan' },
                    { value: 'autopilot', label: 'Autopilot' }
                  ]}
                />
              </label>
            ) : null}
            <SessionModelControls
              session={session}
              disabled={modelControlsDisabled}
              busy={busy === 'model'}
              disabledReason={
                session?.pendingInteraction && !running
                  ? 'Respond to the pending request before changing models'
                  : busy
                    ? 'Wait for the current action to finish'
                    : 'Connect to Copilot to change models'
              }
              favoriteModels={favoriteModels}
              legacyModels={legacyModels}
              onChange={changeModel}
              onToggleFavorite={toggleFavoriteModel}
            />
            <div className="tm-session-actions">
              <Presence
                show={running || Boolean(session?.pendingInteraction) || stopping}
                motion="pop"
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={stopping}
                  title={
                    session?.queuedMessages.length || session?.steeringMessages.length
                      ? 'Stop the current response and discard waiting messages'
                      : 'Stop the current response'
                  }
                  onClick={() => void stop()}
                >
                  {stopping ? 'Stopping…' : 'Stop'}
                </Button>
              </Presence>
              <Presence show={showCommit} motion="pop">
                <CommitButton
                  phase={shownPhase}
                  action={shownAction}
                  autoPush={thread.commitAutoPush}
                  disabledReason={commitDisabledReason}
                  onCommit={commit}
                  onPush={push}
                />
              </Presence>
              <SendButton
                running={running}
                replying={replying}
                delivery={delivery}
                onDeliveryChange={(value) => {
                  setDelivery(value)
                  promptRef.current?.focus()
                }}
                busy={busy === 'send'}
                disabled={
                  Boolean(busy) ||
                  !(ready || sendWhileRunning || replying) ||
                  (!prompt.trim() && !attachments.length)
                }
                onSend={send}
              />
            </div>
          </div>
        </div>
        <Presence show={showSetup} motion="collapse">
          <div>
            {shownSetup && repository && onChangeSetup ? (
              <ThreadSetupPanel
                key={thread.id}
                setup={shownSetup}
                repository={repository}
                settingUp={busy === 'send' || !thread.pendingSetup}
                onChange={onChangeSetup}
              />
            ) : null}
          </div>
        </Presence>
      </div>
      <Presence show={dragging} motion="fade">
        <div className="tm-session-drop">
          <PaperclipIcon aria-hidden="true" />
          Drop files to attach
        </div>
      </Presence>
    </section>
  )
}
