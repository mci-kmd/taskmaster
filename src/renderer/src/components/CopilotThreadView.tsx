import Select from './ui/Select'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CopilotAttachment,
  CopilotInteractionResponse,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSendDelivery,
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
import SendButton from './copilot/SendButton'
import PendingMessages from './copilot/PendingMessages'
import { useSessionDraft } from './copilot/session-drafts'
import {
  attachmentPreview,
  hasAttachmentMarker,
  insertAttachmentMarkers,
  removeAttachmentMarkers,
  withUniqueNames
} from './copilot/attachment-markers'
import '../assets/copilot-session.css'

const api = getRendererApi()
type Props = {
  thread: ThreadSnapshot
  onSessionChange: (threadId: string, state: ThreadSessionState) => void
}
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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

function SessionView({ thread, onSessionChange }: Props): React.JSX.Element {
  const [session, setSession] = useState<CopilotSessionSnapshot | null>(null)
  const [sdk, setSdk] = useState<CopilotSdkStatus | null>(null)
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
  const send = (): void => {
    if (
      !(ready || sendWhileRunning) ||
      stoppingRef.current ||
      (!prompt.trim() && !attachments.length)
    )
      return
    const sentDelivery = sendWhileRunning ? delivery : undefined
    void run('send', async () => {
      const revision = sessionRevision.current
      const result = await api.copilot.send({
        threadId: thread.id,
        prompt: prompt.trim(),
        attachments,
        agentMode,
        ...(sentDelivery ? { delivery: sentDelivery } : {})
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
      <span
        className="sr-only"
        role="status"
        title={`Copilot SDK ${sdk?.installedVersion ?? '…'}${sdk?.runtimeVersion ? ` · Runtime ${sdk.runtimeVersion}` : ''}`}
      >
        {status}
      </span>
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
        {sdk?.updateAvailable ? (
          <div className="mb-3 flex justify-end">
            <Button
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
          </div>
        ) : null}
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
        {session?.mcpServersNeedingAuth.map((serverName) => {
          const started = session.mcpServersSigningIn.includes(serverName)
          return (
            <div className="tm-session-notice mb-3" key={serverName} role="status">
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
          )
        })}
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
          <PendingMessages
            steering={session?.steeringMessages ?? []}
            queued={session?.queuedMessages ?? []}
            cancelling={cancelling}
            onCancel={cancelQueued}
          />
          {attachments.length ? (
            <div className="tm-session-attachments">
              {attachments.map((attachment) => {
                const preview = attachmentPreview(attachment)
                return (
                  <button
                    type="button"
                    className="tm-session-attachment tm-session-attachment--removable"
                    key={attachment.id}
                    aria-label={`Remove ${attachment.displayName}`}
                    title={`Remove ${attachment.displayName}`}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        prompt: removeAttachmentMarkers(current.prompt, attachment.displayName),
                        attachments: current.attachments.filter((item) => item.id !== attachment.id)
                      }))
                    }
                  >
                    {preview ? (
                      <img className="tm-session-attachment-thumb" src={preview} alt="" />
                    ) : (
                      <PaperclipIcon className="tm-session-attachment-icon" aria-hidden="true" />
                    )}
                    <span className="tm-session-attachment-name">{attachment.displayName}</span>
                    <span className="tm-session-attachment-remove" aria-hidden="true">
                      ×
                    </span>
                  </button>
                )
              })}
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
            mode={running ? delivery : 'send'}
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
              disabled={
                (session?.phase !== 'idle' && session?.phase !== 'running') ||
                (session?.phase === 'idle' && Boolean(session.pendingInteraction)) ||
                Boolean(busy) ||
                stopping
              }
              busy={busy === 'model'}
              disabledReason={
                session?.pendingInteraction && !running
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
                  title={
                    session?.queuedMessages.length || session?.steeringMessages.length
                      ? 'Stop the current response and discard waiting messages'
                      : 'Stop the current response'
                  }
                  onClick={() => void stop()}
                >
                  {stopping ? 'Stopping…' : 'Stop'}
                </Button>
              ) : null}
              <SendButton
                running={running}
                delivery={delivery}
                onDeliveryChange={(value) => {
                  setDelivery(value)
                  promptRef.current?.focus()
                }}
                busy={busy === 'send'}
                disabled={
                  Boolean(busy) ||
                  !(ready || sendWhileRunning) ||
                  (!prompt.trim() && !attachments.length)
                }
                onSend={send}
              />
            </div>
          </div>
        </div>
      </div>
      {dragging ? <div className="tm-session-drop">Drop files to attach</div> : null}
    </section>
  )
}
