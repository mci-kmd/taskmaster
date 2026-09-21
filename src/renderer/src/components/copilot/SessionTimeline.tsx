import { memo, useId, useMemo, useState } from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionTimelineItem from './SessionTimelineItem'

type ToolItem = Extract<CopilotTimelineItem, { type: 'tool' }>
type TimelineRow =
  { type: 'item'; item: CopilotTimelineItem } | { type: 'tools'; id: string; items: ToolItem[] }

const ToolGroup = memo(function ToolGroup({ items }: { items: ToolItem[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const running = items.filter((item) => item.status === 'running')
  const failed = items.filter((item) => item.status === 'failed').length
  const stopped = items.filter((item) => item.status === 'cancelled').length
  const status = running.length ? 'running' : failed ? 'failed' : stopped ? 'cancelled' : 'complete'
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.title, (counts.get(item.title) ?? 0) + 1)
  const summary = running.length
    ? running[running.length - 1].title
    : [...counts].map(([title, count]) => (count > 1 ? `${title} ×${count}` : title)).join(', ')
  const statusLabel =
    [
      running.length ? `${running.length} running` : '',
      failed ? `${failed} failed` : '',
      stopped ? `${stopped} stopped` : ''
    ]
      .filter(Boolean)
      .join(' · ') || 'Done'

  return (
    <div className="tm-session-tool-group">
      <button
        type="button"
        className="tm-session-tool-group-toggle"
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="tm-session-tool-group-chevron" aria-hidden="true">
          ›
        </span>
        <span className={`tm-session-dot tm-session-dot--${status}`} aria-hidden="true" />
        <span className="tm-session-tool-group-count">
          {items.length} tool {items.length === 1 ? 'call' : 'calls'}
        </span>
        <span className="tm-session-tool-group-summary" title={summary}>
          {summary}
        </span>
        <span
          className={
            failed
              ? 'tm-session-tool-group-status tm-session-tool-group-status--failed'
              : 'tm-session-tool-group-status'
          }
        >
          {statusLabel}
        </span>
      </button>
      {expanded ? (
        <div
          className="tm-session-tool-group-items"
          id={detailId}
          role="region"
          aria-label="Tool calls"
          tabIndex={0}
        >
          {items.map((item) => (
            <SessionTimelineItem item={item} key={item.id} />
          ))}
        </div>
      ) : null}
    </div>
  )
})

export default function SessionTimeline({
  items
}: {
  items: CopilotTimelineItem[]
}): React.JSX.Element {
  const rows = useMemo(() => {
    const result: TimelineRow[] = []
    for (const item of items) {
      // Empty assistant and reasoning events have no visible content to separate tool calls.
      if ((item.type === 'assistant' || item.type === 'reasoning') && !item.content.trim()) continue
      const previous = result[result.length - 1]
      if (item.type !== 'tool') {
        result.push({ type: 'item', item })
      } else if (previous?.type === 'tools') {
        previous.items.push(item)
      } else {
        // Keep the first call's identity as new calls arrive or finish.
        result.push({ type: 'tools', id: item.id, items: [item] })
      }
    }
    return result
  }, [items])

  return (
    <>
      {rows.map((row) =>
        row.type === 'tools' ? (
          <ToolGroup key={row.id} items={row.items} />
        ) : (
          <SessionTimelineItem key={row.item.id} item={row.item} />
        )
      )}
    </>
  )
}
