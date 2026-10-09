import { memo, useId, useMemo, useState } from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import { ChevronRightIcon } from '../Icons'
import Presence from '../ui/Presence'
import SessionTimelineItem, { ToolStatusDot } from './SessionTimelineItem'
import { TOOL_STATUS_LABELS } from './tool-status'

type ToolItem = Extract<CopilotTimelineItem, { type: 'tool' }>
type TimelineRow =
  { type: 'item'; item: CopilotTimelineItem } | { type: 'tools'; id: string; items: ToolItem[] }

const rowKey = (row: TimelineRow): string => (row.type === 'tools' ? row.id : row.item.id)

const ToolGroup = memo(function ToolGroup({
  items,
  enter
}: {
  items: ToolItem[]
  enter: boolean
}): React.JSX.Element {
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
      .join(' · ') || TOOL_STATUS_LABELS.complete

  return (
    <div className={enter ? 'tm-session-tool-group tm-rise-in' : 'tm-session-tool-group'}>
      <button
        type="button"
        className="tm-session-tool-group-toggle"
        data-status={status}
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <ToolStatusDot status={status} />
        <span className="tm-session-tool-group-count">
          {items.length} tool {items.length === 1 ? 'call' : 'calls'}
        </span>
        <span className="tm-session-tool-group-summary" title={summary}>
          {summary}
        </span>
        <span className="tm-session-tool-group-status">{statusLabel}</span>
        <ChevronRightIcon className="tm-session-chevron" aria-hidden="true" />
      </button>
      <Presence show={expanded} motion="collapse">
        <div className="tm-session-tool-group-body">
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
        </div>
      </Presence>
    </div>
  )
})

export default function SessionTimeline({
  items,
  animateInitial = false
}: {
  items: CopilotTimelineItem[]
  /**
   * Whether the items present on mount rise in too. Off when opening a conversation, so its
   * history appears at once; only items that arrive afterwards animate.
   */
  animateInitial?: boolean
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
  const [initialKeys] = useState(
    () => new Set(animateInitial ? [] : rows.map((row) => rowKey(row)))
  )

  return (
    <>
      {rows.map((row) => {
        const key = rowKey(row)
        const enter = !initialKeys.has(key)
        return row.type === 'tools' ? (
          <ToolGroup key={key} items={row.items} enter={enter} />
        ) : (
          <SessionTimelineItem key={key} item={row.item} enter={enter} />
        )
      })}
    </>
  )
}
