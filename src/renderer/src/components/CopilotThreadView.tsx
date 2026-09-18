import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CopilotAgentMode,
  CopilotAttachment,
  CopilotInteraction,
  CopilotInteractionResponse,
  CopilotReasoningEffort,
  CopilotSdkStatus,
  CopilotSessionSnapshot,
  CopilotTimelineItem,
  ThreadSnapshot
} from '../../../shared/app-types'
import { getRendererApi } from '../shared/api/client'
import type { ThreadSessionState } from './TerminalSessions'
import Button from './ui/Button'
import SegmentedControl from './ui/SegmentedControl'
import { toCopilotThreadSessionState } from '../lib/copilot-thread-status'

const api = getRendererApi()

type Props = {
  thread: ThreadSnapshot
  onSessionChange: (threadId: string, state: ThreadSessionState) => void
}

async function fileToAttachment(file: File): Promise<CopilotAttachment> {
  const path = api.copilot.getPathForFile(file)
  if (path) {
    return {
      id: crypto.randomUUID(),
      type: 'file',
      path,
      displayName: file.name
    }
  }

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

function TimelineItem({ item }: { item: CopilotTimelineItem }): React.JSX.Element {
  const copy = (): void => {
    const text = item.type === 'tool' ? item.detail : item.content
    void navigator.clipboard.writeText(text)
  }

  if (item.type === 'tool') {
    return (
      <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <span
            className={`size-1.5 rounded-full ${
              item.status === 'running'
                ? 'tm-pulse-dot bg-[var(--color-warning)]'
                : item.status === 'failed'
                  ? 'bg-[var(--color-danger)]'
                  : 'bg-[var(--color-positive)]'
            }`}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--color-fg)]">
            {item.title}
          </span>
          <button
            className="text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            onClick={copy}
            type="button"
          >
            Copy
          </button>
        </div>
        {item.detail ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11.5px] leading-5 text-[var(--color-fg-muted)]">
            {item.detail}
          </pre>
        ) : null}
      </article>
    )
  }

  if (item.type === 'notice') {
    return (
      <div
        className={`rounded-md border px-3 py-2.5 text-[12px] leading-5 ${
          item.tone === 'error'
            ? 'border-[rgba(240,140,140,0.4)] bg-[rgba(240,140,140,0.07)] text-[var(--color-danger)]'
            : item.tone === 'warning'
              ? 'border-[rgba(245,201,122,0.35)] bg-[rgba(245,201,122,0.06)] text-[var(--color-warning)]'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)]'
        }`}
      >
        {item.content}
      </div>
    )
  }

  const user = item.type === 'user'
  return (
    <article
      className={`group relative rounded-xl border px-4 py-3 ${
        user
          ? 'ml-auto max-w-[82%] border-[#35506d] bg-[#172536]'
          : item.type === 'reasoning'
            ? 'mr-auto max-w-[90%] border-[var(--color-border)] bg-[#171717]'
            : 'mr-auto max-w-[90%] border-[var(--color-border)] bg-[var(--color-panel)]'
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        <span>{user ? 'You' : item.type === 'reasoning' ? 'Reasoning' : 'Copilot'}</span>
        {item.model ? <span className="normal-case tracking-normal">{item.model}</span> : null}
        {item.streaming ? <span className="tm-pulse-dot">live</span> : null}
        <button
          className="ml-auto opacity-0 transition-opacity hover:text-[var(--color-fg)] group-hover:opacity-100 focus:opacity-100"
          onClick={copy}
          type="button"
        >
          Copy
        </button>
      </div>
      <div
        className={`whitespace-pre-wrap break-words text-[13px] leading-6 ${
          item.type === 'reasoning'
            ? 'font-mono text-[var(--color-fg-muted)]'
            : 'text-[var(--color-fg)]'
        }`}
      >
        {item.content}
      </div>
      {item.type === 'user' && item.attachments?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.attachments.map((attachment) => (
            <span
              className="rounded border border-[#496987] bg-[#1c3146] px-2 py-1 font-mono text-[10.5px] text-[#bcd8f5]"
              key={attachment}
            >
              {attachment}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function InteractionPanel({
  interaction,
  threadId,
  onRespond
}: {
  interaction: CopilotInteraction
  threadId: string
  onRespond: (response: CopilotInteractionResponse) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>(() =>
    Object.fromEntries(
      Object.entries(
        interaction.kind === 'elicitation' ? (interaction.schema?.properties ?? {}) : {}
      )
        .filter(([, field]) => field.default !== undefined)
        .map(([name, field]) => [name, field.default!])
    )
  )

  if (interaction.kind === 'permission') {
    return (
      <div className="border-t border-[var(--color-border)] bg-[#211e18] px-4 py-3">
        <div className="text-[12.5px] font-medium text-[var(--color-warning)]">
          {interaction.title}
        </div>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-[var(--color-fg-muted)]">
          {interaction.description}
        </pre>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            onClick={() =>
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'reject'
              })
            }
            size="sm"
            variant="ghost"
          >
            Reject
          </Button>
          {interaction.allowSessionApproval ? (
            <Button
              onClick={() =>
                onRespond({
                  threadId,
                  interactionId: interaction.id,
                  action: 'approve-session'
                })
              }
              size="sm"
              variant="secondary"
            >
              Allow for session
            </Button>
          ) : null}
          <Button
            onClick={() =>
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'approve-once'
              })
            }
            size="sm"
            variant="primary"
          >
            Allow once
          </Button>
        </div>
      </div>
    )
  }

  if (interaction.kind === 'user-input') {
    return (
      <div className="border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
        <div className="text-[12.5px] font-medium">{interaction.description}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {interaction.choices.map((choice) => (
            <Button
              key={choice}
              onClick={() =>
                onRespond({
                  threadId,
                  interactionId: interaction.id,
                  action: 'accept',
                  value: choice,
                  wasFreeform: false
                })
              }
              size="sm"
              variant="secondary"
            >
              {choice}
            </Button>
          ))}
        </div>
        {interaction.allowFreeform ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!value.trim()) return
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'accept',
                value: value.trim(),
                wasFreeform: true
              })
            }}
          >
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[12.5px]"
              onChange={(event) => setValue(event.target.value)}
              placeholder="Type an answer"
              value={value}
            />
            <Button disabled={!value.trim()} size="sm" type="submit" variant="primary">
              Answer
            </Button>
          </form>
        ) : null}
      </div>
    )
  }

  const fields = Object.entries(interaction.schema?.properties ?? {})
  return (
    <form
      className="border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        onRespond({
          threadId,
          interactionId: interaction.id,
          action: 'accept',
          values
        })
      }}
    >
      <div className="text-[12.5px] font-medium">{interaction.description}</div>
      {interaction.mode === 'url' && interaction.url ? (
        <Button
          className="mt-3"
          onClick={() => window.open(interaction.url, '_blank')}
          size="sm"
          type="button"
          variant="secondary"
        >
          Open sign-in page
        </Button>
      ) : (
        <div className="mt-3 grid gap-3">
          {fields.map(([name, field]) => (
            <label className="grid gap-1.5" key={name}>
              <span className="text-[11.5px] text-[var(--color-fg-muted)]">
                {field.title ?? name}
              </span>
              {field.type === 'boolean' ? (
                <input
                  checked={Boolean(values[name] ?? field.default)}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [name]: event.target.checked }))
                  }
                  type="checkbox"
                />
              ) : field.options ? (
                <select
                  className="tm-select rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[12.5px]"
                  multiple={field.type === 'array'}
                  onChange={(event) => {
                    const next =
                      field.type === 'array'
                        ? Array.from(event.target.selectedOptions, (option) => option.value)
                        : event.target.value
                    setValues((current) => ({ ...current, [name]: next }))
                  }}
                  value={
                    field.type === 'array'
                      ? ((values[name] as string[] | undefined) ?? [])
                      : String(values[name] ?? field.default ?? '')
                  }
                >
                  {field.type !== 'array' ? <option value="">Select</option> : null}
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[12.5px]"
                  defaultValue={String(field.default ?? '')}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [name]:
                        field.type === 'number' || field.type === 'integer'
                          ? Number(event.target.value)
                          : event.target.value
                    }))
                  }
                  required={interaction.schema?.required.includes(name)}
                  type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                />
              )}
              {field.description ? (
                <span className="text-[10.5px] text-[var(--color-fg-subtle)]">
                  {field.description}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          onClick={() =>
            onRespond({
              threadId,
              interactionId: interaction.id,
              action: 'cancel'
            })
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button size="sm" type="submit" variant="primary">
          Continue
        </Button>
      </div>
    </form>
  )
}

export default function CopilotThreadView({ thread, onSessionChange }: Props): React.JSX.Element {
  const [session, setSession] = useState<CopilotSessionSnapshot | null>(null)
  const [sdk, setSdk] = useState<CopilotSdkStatus | null>(null)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<CopilotAttachment[]>([])
  const [agentMode, setAgentMode] = useState<CopilotAgentMode>('interactive')
  const [busy, setBusy] = useState(false)
  const timelineRef = useRef<HTMLDivElement | null>(null)

  const updateSession = useCallback(
    (next: CopilotSessionSnapshot): void => {
      setSession(next)
      onSessionChange(thread.id, toCopilotThreadSessionState(next))
    },
    [onSessionChange, thread.id]
  )

  useEffect(() => {
    const unsubscribeSession = api.copilot.onSession(({ snapshot }) => {
      if (snapshot.threadId === thread.id) updateSession(snapshot)
    })
    const unsubscribeStatus = api.copilot.onSdkStatus(({ status }) => setSdk(status))
    let cancelled = false
    void Promise.all([api.copilot.getSdkStatus(), api.copilot.getSession(thread.id)]).then(
      ([status, existing]) => {
        if (cancelled) return
        setSdk(status)
        if (existing) {
          updateSession(existing)
          return
        }
        void api.copilot.start(thread.id).then((result) => {
          if (!cancelled && result.snapshot) updateSession(result.snapshot)
        })
      }
    )
    void api.copilot.checkForSdkUpdate().then((status) => {
      if (cancelled) return
      setSdk(status)
    })
    return () => {
      cancelled = true
      unsubscribeSession()
      unsubscribeStatus()
    }
  }, [thread.id, updateSession])

  useEffect(() => {
    const element = timelineRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [session?.timeline])

  const selectedModel = useMemo(
    () => session?.models.find((model) => model.id === session.model) ?? null,
    [session]
  )

  const addFiles = useCallback(async (files: File[]): Promise<void> => {
    const next = await Promise.all(files.map(fileToAttachment))
    setAttachments((current) => [...current, ...next])
  }, [])

  const send = useCallback(async (): Promise<void> => {
    if (!session || busy || (!prompt.trim() && attachments.length === 0)) return
    setBusy(true)
    const result = await api.copilot.send({
      threadId: thread.id,
      prompt: prompt.trim(),
      attachments,
      agentMode
    })
    if (result.ok) {
      setPrompt('')
      setAttachments([])
    }
    if (result.snapshot) updateSession(result.snapshot)
    setBusy(false)
  }, [agentMode, attachments, busy, prompt, session, thread.id, updateSession])

  const respond = useCallback((response: CopilotInteractionResponse): void => {
    void api.copilot.respond(response)
  }, [])

  const updateSdk = useCallback(async (): Promise<void> => {
    const status = await api.copilot.updateSdk()
    setSdk(status)
    if (status.blockingThreads.length > 0) return
    const result = await api.copilot.start(thread.id)
    if (result.snapshot) updateSession(result.snapshot)
  }, [thread.id, updateSession])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#111315]">
      <div className="flex min-h-11 items-center gap-3 border-b border-[var(--color-border)] bg-[#15191d] px-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${
              session?.phase === 'running'
                ? 'tm-pulse-dot bg-[var(--color-warning)]'
                : session?.phase === 'error'
                  ? 'bg-[var(--color-danger)]'
                  : session?.phase === 'idle'
                    ? 'bg-[var(--color-positive)]'
                    : 'bg-[var(--color-fg-faint)]'
            }`}
          />
          <span className="text-[11.5px] text-[var(--color-fg-muted)]">
            SDK {sdk?.installedVersion ?? '...'}
          </span>
          {sdk?.runtimeVersion ? (
            <span className="text-[10.5px] text-[var(--color-fg-subtle)]">
              runtime {sdk.runtimeVersion}
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {sdk?.updateAvailable ? (
            <Button
              disabled={sdk.updateState === 'installing'}
              onClick={() => void updateSdk()}
              size="sm"
              title={`Install Copilot SDK ${sdk.latestVersion}`}
              variant="secondary"
            >
              {sdk.updateState === 'installing' ? 'Updating…' : `Update ${sdk.latestVersion}`}
            </Button>
          ) : null}
          <select
            className="tm-select max-w-52 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-[11.5px]"
            disabled={!session || session.phase === 'connecting'}
            onChange={(event) => {
              const model = session?.models.find((item) => item.id === event.target.value)
              void api.copilot
                .setModel({
                  threadId: thread.id,
                  model: event.target.value,
                  reasoningEffort: model?.defaultReasoningEffort ?? null
                })
                .then((result) => {
                  if (result.snapshot) updateSession(result.snapshot)
                })
            }}
            title="Current model"
            value={session?.model ?? ''}
          >
            {!session?.model ? <option value="">Select model</option> : null}
            {session?.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          <select
            className="tm-select rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-[11.5px]"
            disabled={!selectedModel?.supportedReasoningEfforts.length}
            onChange={(event) => {
              if (!session?.model) return
              void api.copilot
                .setModel({
                  threadId: thread.id,
                  model: session.model,
                  reasoningEffort: (event.target.value || null) as CopilotReasoningEffort | null
                })
                .then((result) => {
                  if (result.snapshot) updateSession(result.snapshot)
                })
            }}
            title="Reasoning effort"
            value={session?.reasoningEffort ?? ''}
          >
            {!selectedModel?.supportedReasoningEfforts.length ? (
              <option value="">No reasoning control</option>
            ) : null}
            {selectedModel?.supportedReasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" ref={timelineRef}>
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          {session?.timeline.length ? (
            session.timeline.map((item) => <TimelineItem item={item} key={item.id} />)
          ) : session?.phase === 'error' ? (
            <div className="mx-auto mt-16 max-w-lg text-center">
              <div className="text-[14px] font-medium text-[var(--color-danger)]">
                Copilot could not start
              </div>
              <div className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
                {session.error}
              </div>
              <Button
                className="mt-4"
                onClick={() =>
                  void api.copilot.start(thread.id).then((result) => {
                    if (result.snapshot) updateSession(result.snapshot)
                  })
                }
                size="sm"
                variant="secondary"
              >
                Try again
              </Button>
            </div>
          ) : (
            <div className="mx-auto mt-20 max-w-lg text-center">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-info)]">
                Custom UI preview
              </div>
              <h2 className="mt-3 text-[18px] font-medium">
                Drive Copilot without leaving Taskmaster
              </h2>
              <p className="mt-2 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
                Messages, tool activity, approvals, questions, model controls, and attachments stay
                in this thread.
              </p>
            </div>
          )}
        </div>
      </div>

      {session?.pendingInteraction ? (
        <InteractionPanel
          interaction={session.pendingInteraction}
          key={session.pendingInteraction.id}
          onRespond={respond}
          threadId={thread.id}
        />
      ) : null}

      <div
        className="border-t border-[var(--color-border)] bg-[#15191d] p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void addFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <div className="mx-auto max-w-4xl">
          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <button
                  className="rounded-md border border-[#35506d] bg-[#172536] px-2 py-1 font-mono text-[10.5px] text-[#bcd8f5] hover:border-[#527ca6]"
                  key={attachment.id}
                  onClick={() =>
                    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                  }
                  title="Remove attachment"
                  type="button"
                >
                  {attachment.displayName} ×
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            className="block max-h-48 min-h-20 w-full resize-y rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-input)] px-3 py-2.5 text-[13px] leading-5 placeholder:text-[var(--color-fg-subtle)] focus:border-[#527ca6]"
            disabled={!session || session.phase === 'connecting'}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length) void addFiles(files)
            }}
            placeholder="Ask Copilot. Paste text or files here."
            value={prompt}
          />
          <div className="mt-2 flex items-center gap-2">
            <div className="w-64">
              <SegmentedControl<CopilotAgentMode>
                ariaLabel="Agent mode"
                onChange={setAgentMode}
                options={[
                  { value: 'interactive', label: 'Interactive', description: 'Ask before acting' },
                  { value: 'plan', label: 'Plan', description: 'Plan without changes' },
                  { value: 'autopilot', label: 'Autopilot', description: 'Continue autonomously' }
                ]}
                value={agentMode}
              />
            </div>
            <Button
              onClick={() =>
                void api.copilot.pickAttachments().then((result) => {
                  if (result.ok && result.attachments) {
                    setAttachments((current) => [...current, ...result.attachments!])
                  }
                })
              }
              size="sm"
              variant="ghost"
            >
              Attach files
            </Button>
            <div className="ml-auto flex gap-2">
              {session?.phase === 'running' ? (
                <Button
                  onClick={() => void api.copilot.abort(thread.id)}
                  size="sm"
                  variant="secondary"
                >
                  Stop
                </Button>
              ) : null}
              <Button
                disabled={busy || !session || (!prompt.trim() && attachments.length === 0)}
                onClick={() => void send()}
                size="sm"
                variant="primary"
              >
                Send
              </Button>
            </div>
          </div>
          {sdk?.updateError ? (
            <div className="mt-2 text-[11px] text-[var(--color-danger)]">{sdk.updateError}</div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
