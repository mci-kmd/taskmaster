import { memo } from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionMarkdown, { CopyButton } from './SessionMarkdown'
import {
  ChevronRightIcon,
  ForkIcon,
  PaperclipIcon,
  PinIcon,
  QuestionIcon,
  RewindIcon,
  SparkIcon
} from '../Icons'
import Button from '../ui/Button'
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

type SkillItem = Extract<CopilotTimelineItem, { type: 'skill' }>

/** One line naming skills loaded together; each name shows its description on hover. */
export function SkillLine({
  items,
  enter = false
}: {
  items: SkillItem[]
  enter?: boolean
}): React.JSX.Element {
  const names = items.map((item) => item.name)
  const byUser = items[0]?.invokedBy === 'user'
  const plural = items.length > 1 ? 's' : ''
  return (
    <div
      className={`tm-session-skill${enter ? ' tm-rise-in' : ''}`}
      role="note"
      aria-label={`Skill${plural} ${names.join(', ')} loaded`}
    >
      <SparkIcon className="tm-session-skill-icon" aria-hidden="true" />
      <span className="tm-session-skill-label">
        {byUser ? `Loaded skill${plural}` : `Copilot loaded skill${plural}`}
      </span>
      {items.map((item) => (
        <span className="tm-session-skill-name" key={item.id} title={item.description ?? undefined}>
          {item.name}
        </span>
      ))}
    </div>
  )
}

export default memo(function SessionTimelineItem({
  item,
  enter = false,
  pinned = false,
  onTogglePin,
  onReset,
  onFork,
  resetDisabled = false,
  forkDisabled = false
}: {
  item: CopilotTimelineItem
  /** Rise into place: set for items that arrive while the conversation is open. */
  enter?: boolean
  /** Whether this Copilot message is pinned to the pin rail. */
  pinned?: boolean
  /** Shows a pin toggle on Copilot messages. */
  onTogglePin?: (id: string, pinned: boolean) => void
  /** Shows a button that cuts the conversation back to the end of this message's turn. */
  onReset?: (id: string) => void
  /** Shows a button that opens a new thread from the end of this message's turn. */
  onFork?: (id: string) => void
  resetDisabled?: boolean
  forkDisabled?: boolean
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
  if (item.type === 'skill') return <SkillLine items={[item]} enter={enter} />
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
      data-message-id={user ? undefined : item.id}
      data-pinned={pinned || undefined}
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
        {!user && onTogglePin ? (
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            className="tm-session-pin"
            aria-pressed={pinned}
            aria-label={pinned ? 'Unpin message' : 'Pin message'}
            title={pinned ? 'Unpin message' : 'Pin message for later reference'}
            onClick={() => onTogglePin(item.id, !pinned)}
          >
            <PinIcon filled={pinned} aria-hidden="true" />
          </Button>
        ) : null}
        {!user && onReset ? (
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            className="tm-session-message-action"
            aria-label="Reset to here"
            title="Reset to here: remove everything after this message"
            disabled={resetDisabled}
            onClick={() => onReset(item.id)}
          >
            <RewindIcon aria-hidden="true" />
          </Button>
        ) : null}
        {!user && onFork ? (
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            className="tm-session-message-action"
            aria-label="Fork from here"
            title="Fork from here: continue the conversation up to this message in a new thread"
            disabled={forkDisabled}
            onClick={() => onFork(item.id)}
          >
            <ForkIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </article>
  )
})
