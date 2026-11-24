import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import { ChevronRightIcon } from '../Icons'
import Button from '../ui/Button'
import Presence from '../ui/Presence'
import SessionTimelineItem, { SkillLine, ToolStatusDot } from './SessionTimelineItem'
import { TOOL_STATUS_LABELS } from './tool-status'
import { findTurnEnds } from './turn-ends'

type ToolItem = Extract<CopilotTimelineItem, { type: 'tool' }>
type SkillItem = Extract<CopilotTimelineItem, { type: 'skill' }>
type TimelineRow =
  | { type: 'item'; item: CopilotTimelineItem }
  | { type: 'tools'; id: string; items: ToolItem[] }
  | { type: 'skills'; id: string; items: SkillItem[] }

export type TimelineRevealRequest = { id: string | null; nonce: number }

const rowKey = (row: TimelineRow): string => (row.type === 'item' ? row.item.id : row.id)

const rowContainsId = (row: TimelineRow, id: string): boolean =>
  row.type === 'item' ? row.item.id === id : row.items.some((item) => item.id === id)

/** Rows rendered as soon as a conversation opens: its newest end, which is what's in view. */
export const INITIAL_ROWS = 30
/** Older rows loaded per scroll-up or button click. */
export const ROWS_PER_CHUNK = 30
/** Distance from the top of the scroll container at which the next older chunk loads. */
const LOAD_MORE_THRESHOLD_PX = 320
/** Trim oldest off-screen rows while following at the bottom once visible rows exceed this. */
export const MAX_FOLLOW_ROWS = 80
/** Rows kept mounted after trimming while following at the bottom. */
export const TRIM_KEEP_ROWS = 50
/** Extra rows rendered above a jump target so scrolling slightly up doesn't hit the edge. */
const REVEAL_BUFFER_ROWS = 8

/** The nearest ancestor that scrolls vertically. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

const ToolGroup = memo(
  function ToolGroup({ items, enter }: { items: ToolItem[]; enter: boolean }): React.JSX.Element {
    const [expanded, setExpanded] = useState(false)
    const detailId = useId()
    const running = items.filter((item) => item.status === 'running')
    const failed = items.filter((item) => item.status === 'failed').length
    const stopped = items.filter((item) => item.status === 'cancelled').length
    const status = running.length
      ? 'running'
      : failed
        ? 'failed'
        : stopped
          ? 'cancelled'
          : 'complete'
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
  },
  // Rows are regrouped on every update; a group only needs to render when its calls changed.
  (previous, next) =>
    previous.enter === next.enter &&
    previous.items.length === next.items.length &&
    previous.items.every((item, index) => item === next.items[index])
)

const SessionTimeline = memo(function SessionTimeline({
  items,
  animateInitial = false,
  showAll = false,
  following = false,
  revealRequest = null,
  onScrollAdjusted,
  pinnedIds,
  onTogglePin,
  onReset,
  onFork,
  running = false,
  resetDisabled = false,
  forkDisabled = false
}: {
  items: CopilotTimelineItem[]
  /** Renders the whole history right away instead of loading older rows on demand. */
  showAll?: boolean
  /**
   * Whether the items present on mount rise in too. Off when opening a conversation, so its
   * history appears at once; only items that arrive afterwards animate.
   */
  animateInitial?: boolean
  /** When true, trims oldest off-screen rows once visible rows exceed MAX_FOLLOW_ROWS. */
  following?: boolean
  /** Synchronous reveal request (e.g. from the prompt/pin rail) to mount down to a target id. */
  revealRequest?: TimelineRevealRequest | null
  /** Called right after prepending or trimming adjusts scrollTop so scroll listeners ignore it. */
  onScrollAdjusted?: (scrollTop: number) => void
  /** Ids of pinned Copilot messages. */
  pinnedIds?: ReadonlySet<string>
  /** Shows a pin toggle on Copilot messages; keep it stable so messages needn't re-render. */
  onTogglePin?: (id: string, pinned: boolean) => void
  /** Offers to cut the conversation back to the end of an earlier turn; keep it stable. */
  onReset?: (id: string) => void
  /** Offers to fork the conversation from the end of a turn; keep it stable. */
  onFork?: (id: string) => void
  /** Whether Copilot is working on the latest turn, which can't be forked from until it ends. */
  running?: boolean
  resetDisabled?: boolean
  forkDisabled?: boolean
}): React.JSX.Element {
  const turnEnds = useMemo(() => findTurnEnds(items, running), [items, running])
  const rows = useMemo(() => {
    const result: TimelineRow[] = []
    for (const item of items) {
      // Empty assistant and reasoning events have no visible content to separate tool calls.
      if ((item.type === 'assistant' || item.type === 'reasoning') && !item.content.trim()) continue
      const previous = result[result.length - 1]
      if (item.type === 'skill') {
        // Skills loaded together by the same party share one line.
        if (previous?.type === 'skills' && previous.items[0].invokedBy === item.invokedBy)
          previous.items.push(item)
        else result.push({ type: 'skills', id: item.id, items: [item] })
      } else if (item.type !== 'tool') {
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
  // Keys that should never replay the rise-in animation (initial history + trimmed older rows).
  const [staticKeys, setStaticKeys] = useState(
    () => new Set(animateInitial ? [] : rows.map((row) => rowKey(row)))
  )
  // How many of the oldest rows are unmounted. Older rows load on demand when scrolling up.
  const [pending, setPending] = useState(() => Math.max(0, rows.length - INITIAL_ROWS))
  const [appliedRevealNonce, setAppliedRevealNonce] = useState<number | null>(null)
  let effectivePending = pending
  if (revealRequest && revealRequest.nonce !== appliedRevealNonce) {
    setAppliedRevealNonce(revealRequest.nonce)
    const targetIndex = revealRequest.id
      ? rows.findIndex((row) => rowContainsId(row, revealRequest.id!))
      : 0
    const nextPending = targetIndex >= 0 ? Math.max(0, targetIndex - REVEAL_BUFFER_ROWS) : 0
    if (nextPending < effectivePending) {
      effectivePending = nextPending
      setPending(nextPending)
    }
  }

  const maxPending = Math.max(0, rows.length - INITIAL_ROWS)
  let hidden = showAll ? 0 : Math.min(effectivePending, maxPending)
  // Keep long-running live sessions bounded in the DOM while following the newest output.
  if (following && !showAll && rows.length - hidden > MAX_FOLLOW_ROWS) {
    const nextPending = Math.max(0, rows.length - TRIM_KEEP_ROWS)
    const nextStatic = new Set(staticKeys)
    for (let i = hidden; i < nextPending; i++) nextStatic.add(rowKey(rows[i]))
    hidden = nextPending
    setPending(nextPending)
    setStaticKeys(nextStatic)
  }

  const edge = useRef<HTMLSpanElement>(null)
  const previousHidden = useRef(hidden)
  const scrollAnchor = useRef<{
    scroller: HTMLElement
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const onScrollAdjustedRef = useRef(onScrollAdjusted)
  useLayoutEffect(() => {
    onScrollAdjustedRef.current = onScrollAdjusted
  })

  const loadEarlier = useCallback(() => {
    const scroller = scrollParent(edge.current)
    if (scroller && !scrollAnchor.current) {
      scrollAnchor.current = {
        scroller,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop
      }
    }
    setPending((count) => Math.max(0, Math.min(count, maxPending) - ROWS_PER_CHUNK))
  }, [maxPending])

  // Compensate scrollTop synchronously after prepending or trimming so visible items stay put.
  useLayoutEffect(() => {
    const prevHidden = previousHidden.current
    previousHidden.current = hidden
    const anchor = scrollAnchor.current
    if (anchor) {
      scrollAnchor.current = null
      const delta = anchor.scroller.scrollHeight - anchor.scrollHeight
      if (delta !== 0) {
        anchor.scroller.scrollTop = Math.max(0, anchor.scrollTop + delta)
        onScrollAdjustedRef.current?.(anchor.scroller.scrollTop)
      }
      return
    }
    if (hidden > prevHidden && following) {
      const scroller = scrollParent(edge.current)
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight
        onScrollAdjustedRef.current?.(scroller.scrollTop)
      }
    }
  }, [hidden, following])

  // Load older rows on demand when the reader scrolls near the top.
  useEffect(() => {
    if (hidden === 0) return
    const scroller = scrollParent(edge.current)
    if (!scroller) return
    const onScroll = (): void => {
      if (following || scrollAnchor.current) return
      if (scroller.scrollTop <= LOAD_MORE_THRESHOLD_PX) loadEarlier()
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY >= 0 || scrollAnchor.current) return
      if (scroller.scrollTop <= 1) loadEarlier()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [hidden, following, loadEarlier])

  return (
    <>
      <span hidden ref={edge} />
      {hidden > 0 ? (
        <div className="tm-session-load-earlier">
          <Button size="xs" variant="ghost" onClick={loadEarlier}>
            Load earlier messages ({hidden} more)
          </Button>
        </div>
      ) : null}
      {rows.slice(hidden).map((row) => {
        const key = rowKey(row)
        const enter = !staticKeys.has(key)
        return row.type === 'tools' ? (
          <ToolGroup key={key} items={row.items} enter={enter} />
        ) : row.type === 'skills' ? (
          <SkillLine key={key} items={row.items} enter={enter} />
        ) : (
          <SessionTimelineItem
            key={key}
            item={row.item}
            enter={enter}
            pinned={pinnedIds?.has(row.item.id) ?? false}
            onTogglePin={onTogglePin}
            onReset={turnEnds.get(row.item.id)?.reset ? onReset : undefined}
            onFork={turnEnds.get(row.item.id)?.fork ? onFork : undefined}
            resetDisabled={resetDisabled}
            forkDisabled={forkDisabled}
          />
        )
      })}
    </>
  )
})

export default SessionTimeline
