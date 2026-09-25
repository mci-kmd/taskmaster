import { memo } from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionMarkdown, { CopyButton } from './SessionMarkdown'
import { PaperclipIcon } from '../Icons'
import { splitAttachmentMarkers } from './attachment-markers'

export default memo(function SessionTimelineItem({
  item
}: {
  item: CopilotTimelineItem
}): React.JSX.Element {
  if (item.type === 'tool') {
    return (
      <details className="tm-session-activity" open={item.status === 'failed' ? true : undefined}>
        <summary>
          <span className={`tm-session-dot tm-session-dot--${item.status}`} />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            {item.status === 'running'
              ? 'Running'
              : item.status === 'failed'
                ? 'Failed'
                : item.status === 'cancelled'
                  ? 'Stopped'
                  : 'Done'}
          </span>
        </summary>
        <div className="tm-session-activity-detail">
          <CopyButton text={item.detail} label="Copy output" />
          <pre>{item.detail || 'No output.'}</pre>
        </div>
      </details>
    )
  }
  if (item.type === 'notice') {
    return <div className={`tm-session-notice tm-session-notice--${item.tone}`}>{item.content}</div>
  }
  if (item.type === 'reasoning') {
    return (
      <div className="tm-session-activity tm-session-activity--reasoning">
        <div className="tm-session-activity-heading">
          <span className={item.streaming ? 'tm-pulse-dot' : ''}>✧</span>
          <span>{item.streaming ? 'Thinking…' : 'Reasoning'}</span>
        </div>
        <div className="tm-session-activity-detail">
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
      className={user ? 'tm-session-message tm-session-message--user' : 'tm-session-message'}
      aria-label={user ? 'Your message' : 'Copilot message'}
    >
      {user ? (
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
      ) : (
        <SessionMarkdown>{item.content}</SessionMarkdown>
      )}
      {unplaced.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {unplaced.map((name, index) => (
            <span className="tm-session-attachment" key={`${name}:${index}`}>
              <PaperclipIcon className="tm-session-attachment-icon" aria-hidden="true" />
              <span className="tm-session-attachment-name">{name}</span>
            </span>
          ))}
        </div>
      ) : null}
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
