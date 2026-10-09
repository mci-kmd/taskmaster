import { memo } from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionMarkdown, { CopyButton } from './SessionMarkdown'
import { ChevronRightIcon, PaperclipIcon, QuestionIcon, SparkIcon } from '../Icons'
import { splitAttachmentMarkers } from './attachment-markers'
import {
  PROMPT_COST_BASIS,
  formatPromptCredits,
  formatPromptDkk,
  formatPromptDuration
} from './prompt-cost'
import SubagentUsageBadge from './SubagentUsageBadge'
import { TOOL_STATUS_LABELS, type ToolStatus } from './tool-status'

/** A tool call's status dot; running calls get a live ring. */
export function ToolStatusDot({ status }: { status: ToolStatus }): React.JSX.Element {
  return (
    <span
      className={
        status === 'running'
          ? `tm-session-dot tm-session-dot--running tm-live-dot`
          : `tm-session-dot tm-session-dot--${status}`
      }
      aria-hidden="true"
    />
  )
}

export default memo(function SessionTimelineItem({
  item,
  enter = false
}: {
  item: CopilotTimelineItem
  /** Rise into place: set for items that arrive while the conversation is open. */
  enter?: boolean
}): React.JSX.Element {
  const motion = enter ? ' tm-rise-in' : ''
  if (item.type === 'tool') {
    return (
      <details
        className={`tm-session-activity${motion}`}
        data-status={item.status}
        open={item.status === 'failed' ? true : undefined}
      >
        <summary>
          <ToolStatusDot status={item.status} />
          <span className="tm-session-activity-title">{item.title}</span>
          <span className="tm-session-activity-status">{TOOL_STATUS_LABELS[item.status]}</span>
          <ChevronRightIcon className="tm-session-chevron" aria-hidden="true" />
        </summary>
        <div className="tm-session-activity-detail">
          <CopyButton text={item.detail} label="Copy output" />
          <pre>{item.detail || 'No output.'}</pre>
        </div>
      </details>
    )
  }
  if (item.type === 'notice') {
    return (
      <div className={`tm-session-notice tm-session-notice--${item.tone}${motion}`}>
        {item.content}
      </div>
    )
  }
  if (item.type === 'skill') {
    return (
      <div
        className={`tm-session-skill${motion}`}
        role="note"
        aria-label={`Skill ${item.name} loaded`}
        title={item.description ?? undefined}
      >
        <SparkIcon className="tm-session-skill-icon" aria-hidden="true" />
        <span className="tm-session-skill-label">
          {item.invokedBy === 'user' ? 'Loaded skill' : 'Copilot loaded skill'}
        </span>
        <span className="tm-session-skill-name">{item.name}</span>
        {item.description ? (
          <span className="tm-session-skill-description">{item.description}</span>
        ) : null}
      </div>
    )
  }
  if (item.type === 'interaction') {
    return (
      <section className={`tm-session-interaction${motion}`} aria-label={item.title}>
        <div className="tm-session-interaction-heading">
          <QuestionIcon aria-hidden="true" />
          <span>{item.title}</span>
        </div>
        <div className="tm-session-interaction-prompt">
          <SessionMarkdown>{item.prompt}</SessionMarkdown>
        </div>
        <div className="tm-session-interaction-answer" data-outcome={item.outcome}>
          <span className="tm-session-interaction-label">
            {item.outcome === 'declined' ? 'You declined' : 'You answered'}
          </span>
          <span className="tm-session-interaction-value">{item.answer}</span>
        </div>
      </section>
    )
  }
  if (item.type === 'summary') {
    return (
      <div className={`tm-session-summary${motion}`} aria-label="Prompt summary">
        <span className="tm-session-summary-costs" title={PROMPT_COST_BASIS}>
          <span>{formatPromptDuration(item.durationMs)}</span>
          {item.nanoAiu !== null ? (
            <>
              <span className="tm-session-summary-separator" aria-hidden="true">
                ·
              </span>
              <span>{formatPromptCredits(item.nanoAiu)}</span>
              <span className="tm-session-summary-separator" aria-hidden="true">
                ·
              </span>
              <span>{formatPromptDkk(item.nanoAiu)}</span>
            </>
          ) : null}
        </span>
        {item.subagents.length ? (
          <>
            <span className="tm-session-summary-separator" aria-hidden="true">
              ·
            </span>
            <SubagentUsageBadge agents={item.subagents} />
          </>
        ) : null}
      </div>
    )
  }
  if (item.type === 'reasoning') {
    return (
      <div className={`tm-session-reasoning${motion}`} data-streaming={item.streaming || undefined}>
        <div className="tm-session-reasoning-heading">
          <SparkIcon className={item.streaming ? 'tm-pulse-dot' : undefined} aria-hidden="true" />
          <span>{item.streaming ? 'Thinking…' : 'Reasoning'}</span>
        </div>
        <div className="tm-session-reasoning-detail">
          <SessionMarkdown>{item.content}</SessionMarkdown>
        </div>
      </div>
    )
  }
  const user = item.type === 'user'
  const names = user ? (item.attachments ?? []) : []
  const parts = user ? splitAttachmentMarkers(item.content, names) : []
  const inline = new Set(parts.flatMap((part) => ('attachment' in part ? [part.attachment] : [])))
  const unplaced = names.filter((name) => !inline.has(name))
  return (
    <article
      className={`${user ? 'tm-session-message tm-session-message--user' : 'tm-session-message'}${motion}`}
      aria-label={user ? 'Your message' : 'Copilot message'}
      data-prompt-id={user ? item.id : undefined}
    >
      {user ? (
        <div className="tm-session-bubble">
          <div className="whitespace-pre-wrap break-words">
            {parts.map((part, index) =>
              'text' in part ? (
                part.text
              ) : (
                <span
                  className="tm-session-inline-attachment"
                  key={index}
                  title={`Attached: ${part.attachment}`}
                >
                  <PaperclipIcon aria-hidden="true" />
                  {part.attachment}
                </span>
              )
            )}
          </div>
          {unplaced.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unplaced.map((name, index) => (
                <span className="tm-session-attachment" key={`${name}:${index}`}>
                  <PaperclipIcon className="tm-session-attachment-icon" aria-hidden="true" />
                  <span className="tm-session-attachment-name">{name}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <SessionMarkdown>{item.content}</SessionMarkdown>
      )}
      <div className="tm-session-message-footer">
        {user ? (
          <span>
            You{item.steered ? ' · steered' : ''}
            {item.model ? ` · ${item.model}` : ''}
          </span>
        ) : item.model ? (
          <span>{item.model}</span>
        ) : null}
        <CopyButton text={item.content} label="Copy message" iconOnly />
      </div>
    </article>
  )
})
