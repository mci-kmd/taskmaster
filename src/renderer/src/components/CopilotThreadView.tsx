import Select from './ui/Select'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  ThreadCommitPhase,
  ThreadSnapshot
} from '../../../shared/app-types'
import { getRendererApi } from '../shared/api/client'
import type { ThreadSessionState } from './TerminalSessions'
import Button from './ui/Button'
import Presence from './ui/Presence'
import { PaperclipIcon } from './Icons'
import { canAnimate, usePresence } from '../lib/motion'
import { usePresenceList } from '../lib/use-presence-list'
import { toCopilotThreadSessionState } from '../lib/copilot-thread-status'
import InteractionPanel from './copilot/InteractionPanel'
import SessionModelControls from './copilot/SessionModelControls'
import SessionTimeline from './copilot/SessionTimeline'
import { reconcileSessionSnapshot } from '../lib/session-snapshot'
import PromptRail from './copilot/PromptRail'
import type { RailPrompt } from './copilot/prompt-rail'
import SessionPromptInput from './copilot/SessionPromptInput'
import SendButton from './copilot/SendButton'
import CommitButton from './copilot/CommitButton'
import PendingMessages from './copilot/PendingMessages'
import AttachmentChips from './copilot/AttachmentChips'
import { EmptyConversation, WorkingIndicator } from './copilot/ConversationStates'
import { registerComposer, useSessionDraft } from './copilot/session-drafts'
import {
  hasAttachmentMarker,
  insertAttachmentMarkers,
  removeAttachmentMarkers,
  withUniqueNames
} from './copilot/attachment-markers'
import { stepReasoningEffort } from '../../../shared/reasoning-effort'

const api = getRendererApi()
type Props = {
  thread: ThreadSnapshot
  onSessionChange: (threadId: string, state: ThreadSessionState) => void
  // Another session is working in this thread's checkout, so committing now would race it.
  sharedCheckoutBusy?: boolean
  /** Model ids the model picker tucks under a Legacy row. */
  legacyModels?: string[]
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

// Key the entire session lifecycle, including pending async work, to its thread.
export default function CopilotThreadView(props: Props): React.JSX.Element {
  return <SessionView key={props.thread.id} {...props} />
}

function SessionView({
  thread,
  onSessionChange,
  sharedCheckoutBusy = false,
  legacyModels
}: Props): React.JSX.Element {
  const [session, setSession] = useState<CopilotSessionSnapshot | null>(null)
  const [sdk, setSdk] = useState<CopilotSdkStatus | null>(null)
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [draft, updateDraft] = useSessionDraft(thread.id)
  const { prompt, attachments } = draft
  const agentMode = draft.agentMode ?? session?.agentMode ?? 'interactive'
  const [busy, setBusy] = useState<string | null>(null)
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
      if (!mounted.current || next.threadId !== thread.id) return
      setSession((previous) => reconcileSessionSnapshot(previous, next))
      onSessionChangeRef.current(thread.id, toCopilotThreadSessionState(next))
    },
    [thread.id]
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
    if (busyRef.current) return
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
      if (snapshot.threadId !== thread.id) return
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
        const existing = await api.copilot.getSession(thread.id)
        if (cancelled) return
        if (existing && existing.phase !== 'disconnected') {
          if (revision === sessionRevision.current) updateSession(existing)
        } else {
          const result = await api.copilot.start(thread.id)
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
  }, [thread.id, updateSession, acceptResult])

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
  if (historyLoaded && !hasTimeline && startedEmptyThread !== thread.id)
    setStartedEmptyThread(thread.id)
  const startedEmpty = startedEmptyThread === thread.id
  // The prompt rail can jump to a prompt the progressive history hasn't rendered yet.
  const [revealedThread, setRevealedThread] = useState<string | null>(null)
  const revealHistory = useCallback(() => {
    flushSync(() => setRevealedThread(thread.id))
  }, [thread.id])
  const emptyState = usePresence(Boolean(session && session.phase !== 'connecting') && !hasTimeline)
  const mcpNotices = usePresenceList(
    session?.mcpServersNeedingAuth ?? NONE,
    (serverName: string) => serverName,
    thread.id
  )

  const prompts = useMemo(
    () =>
      (session?.timeline ?? []).filter(
        (item): item is typeof item & RailPrompt => item.type === 'user'
      ),
    [session?.timeline]
  )
  // The rail's gutter eases open when a conversation reaches its second prompt, but not when a
  // thread opens with several (that would shift the whole history sideways).
  const [railAtLoad, setRailAtLoad] = useState<boolean | null>(null)
  if (session && railAtLoad === null) setRailAtLoad(prompts.length >= 2)
  const stopFollowing = useCallback(() => {
    followOutput.current = false
  }, [])

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
  const attach = (added: CopilotAttachment[], replaceSelection = false): void => {
    if (!added.length) return
    const element = promptRef.current
    updateDraft((current) => {
      const named = withUniqueNames(added, current.attachments)
      const end = element?.selectionEnd ?? current.prompt.length
      const start = replaceSelection ? (element?.selectionStart ?? end) : end
      const next = insertAttachmentMarkers(
        current.prompt,
        named.map((item) => item.displayName),
        start,
        end
      )
      pendingCaret.current = next.caret
      return { ...current, prompt: next.prompt, attachments: [...current.attachments, ...named] }
    })
    if (mounted.current) promptRef.current?.focus()
  }
  const attachRef = useRef(attach)
  attachRef.current = attach
  useEffect(() => registerComposer(thread.id, (added) => attachRef.current(added)), [thread.id])
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
      const result = await api.copilot.send({
        threadId: thread.id,
        prompt: prompt.trim(),
        attachments,
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
        updateDraft((current) => ({
          ...current,
          prompt: current.prompt === prompt ? '' : current.prompt,
          // Steering joins the running turn, so the chosen mode still applies to the next one.
          agentMode:
            sentDelivery !== 'steer' && current.agentMode === draft.agentMode
              ? null
              : current.agentMode,
          attachments: current.attachments.filter(
            (item) => !attachments.some((sent) => sent.id === item.id)
          )
        }))
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
        acceptResult(await api.copilot.cancelQueued({ threadId: thread.id, queuedId }), revision)
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
      acceptResult(await api.copilot.start(thread.id), revision)
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
      const result = await api.copilot.authenticateMcpServer({ threadId: thread.id, serverName })
      acceptResult(result, revision)
    })
  }
  const stop = async (): Promise<void> => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    setError(null)
    try {
      if (!(await api.copilot.abort(thread.id)))
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
        await api.copilot.setModel({ threadId: thread.id, model, reasoningEffort }),
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

  const usesGit = thread.projectKind !== 'general'
  const idle = session?.phase === 'idle'
  const [workingTree, setWorkingTree] = useState<BranchStatusSnapshot | null>(null)
  const [commitPhase, setCommitPhase] = useState<ThreadCommitPhase | null>(null)
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
  const showCommit =
    usesGit && (commitPhase !== null || (ready && !sharedCheckoutBusy && hasChanges(workingTree)))
  const commitDisabledReason =
    (workingTree?.conflicted ?? 0) > 0
      ? 'Resolve merge conflicts before committing'
      : busy
        ? 'Wait for the current action to finish'
        : null
  const commit = (): void => {
    if (!showCommit || commitPhase || commitDisabledReason || busyRef.current) return
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
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 's' ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        // A view that is crossfading out (or otherwise inert) no longer owns the shortcut.
        sectionRef.current?.closest('[data-state="closed"], [inert]')
      )
        return
      event.preventDefault()
      if (!event.repeat) commitRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
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
          className={
            prompts.length >= 2
              ? 'tm-session-scroll tm-session-scroll--with-rail'
              : 'tm-session-scroll'
          }
          data-rail-motion={railAtLoad === false || undefined}
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
                key={thread.id}
                showAll={revealedThread === thread.id}
              />
            ) : null}
            <Presence show={running} motion="collapse">
              <WorkingIndicator waiting={Boolean(session?.pendingInteraction)} />
            </Presence>
          </div>
        </div>
        <PromptRail
          prompts={prompts}
          scrollRef={timelineRef}
          onNavigate={stopFollowing}
          onRevealHistory={revealHistory}
        />
        <Presence show={!atBottom} motion="rise">
          <Button size="sm" className="tm-session-jump" onClick={() => jumpToLatest('jump')}>
            ↓ Jump to latest
          </Button>
        </Presence>
      </div>
      <div className="tm-session-bottom">
        <Presence show={Boolean(sdk?.updateAvailable)} motion="collapse">
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
                  acceptResult(await api.copilot.start(thread.id), revision)
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
                      threadId={thread.id}
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
            threadId={thread.id}
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
            <label className="tm-session-setting" title="Mode for your next message">
              <span>Mode</span>
              <Select
                compact
                aria-label="Agent mode"
                value={agentMode}
                onChange={(value) =>
                  updateDraft((current) => ({ ...current, agentMode: value as typeof agentMode }))
                }
                title="Mode for your next message"
                options={[
                  { value: 'interactive', label: 'Interactive' },
                  { value: 'plan', label: 'Plan' },
                  { value: 'autopilot', label: 'Autopilot' }
                ]}
              />
            </label>
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
                  phase={commitPhase}
                  autoPush={thread.commitAutoPush}
                  disabledReason={commitDisabledReason}
                  onCommit={commit}
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
