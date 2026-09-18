import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CopilotAttachment,
  CopilotInteractionResponse,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSessionSnapshot,
  CopilotStartResult,
  ThreadSnapshot
} from '../../../shared/app-types'
import { getRendererApi } from '../shared/api/client'
import type { ThreadSessionState } from './TerminalSessions'
import Button from './ui/Button'
import { toCopilotThreadSessionState } from '../lib/copilot-thread-status'
import InteractionPanel from './copilot/InteractionPanel'
import SessionTimelineItem from './copilot/SessionTimelineItem'
import { useSessionDraft } from './copilot/session-drafts'
import '../assets/copilot-session.css'

const api = getRendererApi()
type Props = {
  thread: ThreadSnapshot
  onSessionChange: (threadId: string, state: ThreadSessionState) => void
}
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function fileToAttachment(file: File): Promise<CopilotAttachment> {
  const path = api.copilot.getPathForFile(file)
  if (path) return { id: crypto.randomUUID(), type: 'file', path, displayName: file.name }
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
    displayName: file.name || 'Pasted file'
  }
}

// Key the entire session lifecycle, including pending async work, to its thread.
export default function CopilotThreadView(props: Props): React.JSX.Element {
  return <SessionView key={props.thread.id} {...props} />
}

function SessionView({ thread, onSessionChange }: Props): React.JSX.Element {
  const [session, setSession] = useState<CopilotSessionSnapshot | null>(null)
  const [sdk, setSdk] = useState<CopilotSdkStatus | null>(null)
  const [draft, updateDraft] = useSessionDraft(thread.id)
  const { prompt, attachments } = draft
  const agentMode = draft.agentMode ?? session?.agentMode ?? 'interactive'
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const followOutput = useRef(true)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(false)
  const sessionRevision = useRef(0)
  const onSessionChangeRef = useRef(onSessionChange)
  onSessionChangeRef.current = onSessionChange

  const updateSession = useCallback(
    (next: CopilotSessionSnapshot): void => {
      if (!mounted.current || next.threadId !== thread.id) return
      setSession(next)
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
    let receivedStatus = false
    const unsubscribeSession = api.copilot.onSession(({ snapshot }) => {
      if (snapshot.threadId !== thread.id) return
      sessionRevision.current++
      updateSession(snapshot)
    })
    const unsubscribeStatus = api.copilot.onSdkStatus(({ status }) => {
      receivedStatus = true
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
        if (!cancelled && !receivedStatus) setSdk(status)
      })
      .catch((cause) => {
        if (!cancelled) setError(message(cause))
      })
    void api.copilot
      .checkForSdkUpdate()
      .then((status) => {
        if (!cancelled) setSdk(status)
      })
      .catch(() => {
        /* Update checks must not prevent the conversation from loading. */
      })
    return () => {
      cancelled = true
      mounted.current = false
      unsubscribeSession()
      unsubscribeStatus()
    }
  }, [thread.id, updateSession, acceptResult])

  const jumpToLatest = useCallback(() => {
    followOutput.current = true
    setAtBottom(true)
    const element = timelineRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [])
  useLayoutEffect(() => {
    if (followOutput.current) jumpToLatest()
  }, [session?.timeline, session?.phase, session?.pendingInteraction, jumpToLatest])
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followOutput.current) jumpToLatest()
    })
    if (contentRef.current) observer.observe(contentRef.current)
    if (timelineRef.current) observer.observe(timelineRef.current)
    return () => observer.disconnect()
  }, [jumpToLatest])
  useLayoutEffect(() => {
    const element = promptRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 192)}px`
  }, [prompt])

  const addFiles = (files: File[]): void => {
    void run('attachments', async () => {
      const next = await Promise.all(files.map(fileToAttachment))
      updateDraft((current) => ({ ...current, attachments: [...current.attachments, ...next] }))
    })
  }
  const running = session?.phase === 'running'
  const ready = session?.phase === 'idle' && !session.pendingInteraction
  const selectedModel = session?.models.find((model) => model.id === session.model)
  const send = (): void => {
    if (!ready || (!prompt.trim() && !attachments.length)) return
    void run('send', async () => {
      const revision = sessionRevision.current
      const result = await api.copilot.send({
        threadId: thread.id,
        prompt: prompt.trim(),
        attachments,
        agentMode
      })
      acceptResult(result, revision)
      if (result.ok) {
        // Keep any draft changes made while this request was in flight.
        updateDraft((current) => ({
          ...current,
          prompt: current.prompt === prompt ? '' : current.prompt,
          agentMode: current.agentMode === draft.agentMode ? null : current.agentMode,
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
  const changeModel = (model: string, reasoningEffort: CopilotReasoningEffort | null): void => {
    void run('model', async () => {
      const revision = sessionRevision.current
      acceptResult(
        await api.copilot.setModel({ threadId: thread.id, model, reasoningEffort }),
        revision
      )
    })
  }
  const status = session?.pendingInteraction
    ? 'Needs your input'
    : running
      ? 'Working…'
      : session?.phase === 'idle'
        ? 'Ready'
        : session?.phase === 'error' || (error && !session)
          ? 'Could not connect'
          : session?.phase === 'disconnected'
            ? 'Disconnected'
            : 'Connecting…'

  return (
    <section
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
      <div className="tm-session-header">
        <span
          className={`tm-session-dot ${running ? 'tm-session-dot--running' : session?.phase === 'error' ? 'tm-session-dot--failed' : ''}`}
        />
        <span role="status">{status}</span>
        <span
          className="ml-auto text-[var(--color-fg-subtle)]"
          title={`Copilot SDK ${sdk?.installedVersion ?? '…'}${sdk?.runtimeVersion ? ` · Runtime ${sdk.runtimeVersion}` : ''}`}
        >
          Copilot
        </span>
        {sdk?.updateAvailable ? (
          <Button
            disabled={Boolean(busy) || running || sdk.updateState === 'installing'}
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
            {sdk.updateState === 'installing' ? 'Updating…' : 'Update available'}
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          className="tm-session-scroll"
          ref={timelineRef}
          role="region"
          aria-label="Conversation"
          tabIndex={0}
          onScroll={() => {
            const element = timelineRef.current
            if (!element) return
            const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64
            followOutput.current = bottom
            setAtBottom(bottom)
          }}
        >
          <div className="tm-session-transcript" ref={contentRef}>
            {session?.timeline.length ? (
              session.timeline.map((item) => <SessionTimelineItem item={item} key={item.id} />)
            ) : (
              <div className="tm-session-empty">
                <span className="tm-session-empty-icon" aria-hidden="true">
                  ✧
                </span>
                <h2>What would you like to work on?</h2>
                <p>Ask a question, plan a change, or build something together.</p>
                <div className="flex flex-wrap justify-center gap-2 mt-5">
                  {['Explain this project', 'Find and fix a bug', 'Plan a change'].map(
                    (suggestion) => (
                      <Button
                        key={suggestion}
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          updateDraft((current) => ({ ...current, prompt: suggestion }))
                          promptRef.current?.focus()
                        }}
                      >
                        {suggestion}
                      </Button>
                    )
                  )}
                </div>
              </div>
            )}
            {running ? (
              <div className="tm-session-working">
                <span className="tm-pulse-dot">✧</span>
                {session?.pendingInteraction ? 'Waiting for your response' : 'Copilot is working…'}
              </div>
            ) : null}
          </div>
        </div>
        {!atBottom ? (
          <button type="button" className="tm-session-jump" onClick={jumpToLatest}>
            ↓ Jump to latest
          </button>
        ) : null}
      </div>
      <div className="tm-session-bottom">
        {error || session?.error || sdk?.updateError ? (
          <div className="tm-session-error" role="alert">
            <span>{error ?? session?.error ?? sdk?.updateError}</span>
            {error && error !== session?.error && error !== sdk?.updateError ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
              >
                Dismiss
              </Button>
            ) : null}
          </div>
        ) : null}
        {session?.phase === 'error' || session?.phase === 'disconnected' || (!session && error) ? (
          <div className="mb-3 flex justify-end">
            <Button size="sm" disabled={Boolean(busy)} onClick={start}>
              {busy === 'start' ? 'Reconnecting…' : 'Reconnect'}
            </Button>
          </div>
        ) : null}
        <div className="tm-session-composer">
          {session?.pendingInteraction ? (
            <div
              className="tm-session-interaction"
              role="region"
              aria-label={session.pendingInteraction.title}
            >
              <InteractionPanel
                interaction={session.pendingInteraction}
                key={session.pendingInteraction.id}
                threadId={thread.id}
                onRespond={respond}
                busy={Boolean(busy)}
              />
            </div>
          ) : null}
          {attachments.length ? (
            <div className="tm-session-attachments">
              {attachments.map((attachment) => (
                <button
                  type="button"
                  className="tm-session-attachment"
                  key={attachment.id}
                  aria-label={`Remove ${attachment.displayName}`}
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      attachments: current.attachments.filter((item) => item.id !== attachment.id)
                    }))
                  }
                >
                  {attachment.displayName}
                  <span aria-hidden="true"> ×</span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={promptRef}
            autoFocus
            aria-label="Message Copilot"
            rows={2}
            value={prompt}
            onChange={(event) =>
              updateDraft((current) => ({ ...current, prompt: event.target.value }))
            }
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length) {
                event.preventDefault()
                addFiles(files)
              }
            }}
            placeholder={running ? 'Draft your next message…' : 'Ask Copilot anything…'}
          />
          <div className="tm-session-controls">
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(busy)}
              aria-label="Attach files"
              title="Attach files (or drop them anywhere in this session)"
              onClick={() =>
                void run('attachments', async () => {
                  const result = await api.copilot.pickAttachments()
                  if (!result.ok && !result.cancelled)
                    throw new Error(result.error ?? 'Could not attach files.')
                  if (result.attachments)
                    updateDraft((current) => ({
                      ...current,
                      attachments: [...current.attachments, ...result.attachments!]
                    }))
                })
              }
            >
              ＋<span className="sr-only"> Attach files</span>
            </Button>
            <select
              aria-label="Agent mode"
              value={agentMode}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  agentMode: event.target.value as typeof agentMode
                }))
              }
              title="Mode for your next message"
            >
              <option value="interactive">Interactive</option>
              <option value="plan">Plan</option>
              <option value="autopilot">Autopilot</option>
            </select>
            <select
              aria-label="Model"
              disabled={!ready || Boolean(busy)}
              value={session?.model ?? ''}
              onChange={(event) =>
                changeModel(
                  event.target.value,
                  session?.models.find((model) => model.id === event.target.value)
                    ?.defaultReasoningEffort ?? null
                )
              }
            >
              {!session?.model ? (
                <option value="">Choose model</option>
              ) : !selectedModel ? (
                <option value={session.model}>{session.model}</option>
              ) : null}
              {session?.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            {selectedModel?.supportedReasoningEfforts.length ? (
              <select
                aria-label="Reasoning effort"
                title="Reasoning effort"
                disabled={!ready || Boolean(busy)}
                value={session?.reasoningEffort ?? ''}
                onChange={(event) => {
                  if (session?.model)
                    changeModel(
                      session.model,
                      (event.target.value || null) as CopilotReasoningEffort | null
                    )
                }}
              >
                <option value="">Default effort</option>
                {selectedModel.supportedReasoningEfforts.map((effort) => (
                  <option value={effort} key={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {running || session?.pendingInteraction ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('stop', async () => {
                      if (!(await api.copilot.abort(thread.id)))
                        throw new Error('This session is no longer running.')
                    })
                  }
                >
                  {busy === 'stop' ? 'Stopping…' : 'Stop'}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                disabled={Boolean(busy) || !ready || (!prompt.trim() && !attachments.length)}
                title={
                  running
                    ? 'Send when Copilot finishes, or stop the current response'
                    : 'Send message (Enter)'
                }
                onClick={send}
              >
                {busy === 'send' ? 'Sending…' : 'Send ↑'}
              </Button>
            </div>
          </div>
        </div>
        <div className="tm-session-hint">
          {busy === 'attachments'
            ? 'Adding attachments…'
            : agentMode === 'plan'
              ? 'Plan mode · Explore and plan before making changes'
              : agentMode === 'autopilot'
                ? 'Autopilot · Copilot continues autonomously'
                : 'Enter to send · Shift + Enter for a new line'}
        </div>
      </div>
      {dragging ? <div className="tm-session-drop">Drop files to attach</div> : null}
    </section>
  )
}
