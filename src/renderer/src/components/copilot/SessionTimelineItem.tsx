import { memo } from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionMarkdown, { CopyButton } from './SessionMarkdown'

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
      <details className="tm-session-activity">
        <summary>
          <span className={item.streaming ? 'tm-pulse-dot' : ''}>✧</span>
          <span>{item.streaming ? 'Thinking…' : 'Reasoning'}</span>
        </summary>
        <div className="tm-session-activity-detail">
          <SessionMarkdown>{item.content}</SessionMarkdown>
        </div>
      </details>
    )
  }
  const user = item.type === 'user'
  return (
    <article
      className={user ? 'tm-session-message tm-session-message--user' : 'tm-session-message'}
      aria-label={user ? 'Your message' : 'Copilot message'}
    >
      {user ? (
        <div className="whitespace-pre-wrap break-words">{item.content}</div>
      ) : (
        <SessionMarkdown>{item.content}</SessionMarkdown>
      )}
      {user && item.attachments?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.attachments.map((name, index) => (
            <span className="tm-session-attachment" key={`${name}:${index}`}>
              {name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="tm-session-message-footer">
        <span>
          {user ? 'You' : 'Copilot'}
          {item.model ? ` · ${item.model}` : ''}
        </span>
        <CopyButton text={item.content} label="Copy message" />
      </div>
    </article>
  )
})
