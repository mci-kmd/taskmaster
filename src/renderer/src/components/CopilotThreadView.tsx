import Select from './ui/Select'
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
import { PaperclipIcon } from './Icons'
import { toCopilotThreadSessionState } from '../lib/copilot-thread-status'
import InteractionPanel from './copilot/InteractionPanel'
import SessionModelControls from './copilot/SessionModelControls'
import SessionTimeline from './copilot/SessionTimeline'
import SessionPromptInput from './copilot/SessionPromptInput'
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
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
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
    const updateCheckRevision = statusRevision
    void api.copilot
      .checkForSdkUpdate()
      .then((status) => {
        if (!cancelled && statusRevision === updateCheckRevision) setSdk(status)
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

  const addFiles = (files: File[]): void => {
    if (busyRef.current) {
      setError('Wait for the current action to finish, then attach your files again.')
      return
    }
    void run('attachments', async () => {
      const next = await Promise.all(files.map(fileToAttachment))
      updateDraft((current) => ({ ...current, attachments: [...current.attachments, ...next] }))
    })
  }
  const running = session?.phase === 'running'
  const ready = session?.phase === 'idle' && !session.pendingInteraction && !stopping
  const send = (): void => {
    if (!ready || stoppingRef.current || (!prompt.trim() && !attachments.length)) return
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
        <span
          role="status"
          title={`Copilot SDK ${sdk?.installedVersion ?? '…'}${sdk?.runtimeVersion ? ` · Runtime ${sdk.runtimeVersion}` : ''}`}
        >
          {status}
        </span>
        {sdk?.updateAvailable ? (
          <Button
            className="ml-auto"
            disabled={
              Boolean(busy) ||
              running ||
              stopping ||
              Boolean(session?.pendingInteraction) ||
              session?.phase === 'connecting' ||
              sdk.updateState === 'installing'
            }
            title={`Update Copilot to ${sdk.latestVersion ?? 'the latest version'}`}
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
              <SessionTimeline items={session.timeline} />
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
        {error || session?.error ? (
          <div className="tm-session-error" role="alert">
            <span>{error ?? session?.error}</span>
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
        {sdk?.updateError ? (
          <div className="tm-session-notice tm-session-notice--warning mb-3" role="status">
            Copilot update: {sdk.updateError}
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
                busy={Boolean(busy) || stopping}
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
          <SessionPromptInput
            threadId={thread.id}
            sessionId={session?.sessionId ?? null}
            connected={session?.phase === 'idle' || session?.phase === 'running'}
            inputRef={promptRef}
            prompt={prompt}
            timeline={session?.timeline ?? []}
            hasAttachments={attachments.length > 0}
            hasInteraction={Boolean(session?.pendingInteraction)}
            running={running}
            onChange={(value) => updateDraft((current) => ({ ...current, prompt: value }))}
            onSend={send}
            onFiles={addFiles}
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
                  if (result.attachments)
                    updateDraft((current) => ({
                      ...current,
                      attachments: [...current.attachments, ...result.attachments!]
                    }))
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
              disabled={!ready || Boolean(busy)}
              busy={busy === 'model'}
              disabledReason={
                running
                  ? 'Stop the current response or wait for it to finish before changing models'
                  : session?.pendingInteraction
                    ? 'Respond to the pending request before changing models'
                    : busy
                      ? 'Wait for the current action to finish'
                      : 'Connect to Copilot to change models'
              }
              onChange={changeModel}
            />
            <div className="ml-auto flex items-center gap-2">
              {running || session?.pendingInteraction || stopping ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  {stopping ? 'Stopping…' : 'Stop'}
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
      </div>
      {dragging ? <div className="tm-session-drop">Drop files to attach</div> : null}
    </section>
  )
}
