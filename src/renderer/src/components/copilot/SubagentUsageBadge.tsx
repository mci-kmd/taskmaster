import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CopilotSubagentUsage } from '../../../../shared/app-types'
import { AgentIcon } from '../Icons'
import { formatCredits, formatDkk, formatPromptDuration, PROMPT_COST_BASIS } from './prompt-cost'
import { groupSubagentUsage, type SubagentUsageTotals } from './subagent-usage'

const MARGIN = 8
const GAP = 6

function UsageCells({ totals }: { totals: SubagentUsageTotals }): React.JSX.Element {
  return (
    <>
      <td className="tm-num">{totals.count}</td>
      <td className="tm-num">
        {totals.durationMs === null ? '—' : formatPromptDuration(totals.durationMs)}
      </td>
      <td className="tm-num">{totals.nanoAiu === null ? '—' : formatCredits(totals.nanoAiu)}</td>
      <td className="tm-num">{totals.nanoAiu === null ? '—' : formatDkk(totals.nanoAiu)}</td>
    </>
  )
}

export default function SubagentUsageBadge({
  agents
}: {
  agents: CopilotSubagentUsage[]
}): React.JSX.Element {
  const tooltipId = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const label = `${agents.length} sub-${agents.length === 1 ? 'agent' : 'agents'}`

  // The transcript scrolls and clips overflow, so the tooltip is fixed and flips below when needed.
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!open || !anchorRef.current || !tooltip) return
    const anchor = anchorRef.current.getBoundingClientRect()
    const { width, height } = tooltip.getBoundingClientRect()
    const above = anchor.top - GAP - height
    tooltip.style.left = `${Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN))}px`
    tooltip.style.top = `${above >= MARGIN ? above : anchor.bottom + GAP}px`
    tooltip.style.visibility = 'visible'
  }, [open, agents])

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const { groups, total } = open ? groupSubagentUsage(agents) : { groups: [], total: null }

  return (
    <span
      ref={anchorRef}
      className="tm-session-subagents"
      tabIndex={0}
      aria-label={label}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <AgentIcon aria-hidden="true" />
      <span>{agents.length}</span>
      {open && total ? (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="tm-session-subagents-tooltip"
        >
          <strong>Sub-agents</strong>
          <table>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Effort</th>
                <th scope="col" className="tm-num">
                  Agents
                </th>
                <th scope="col" className="tm-num">
                  Runtime
                </th>
                <th scope="col" className="tm-num">
                  Credits
                </th>
                <th scope="col" className="tm-num">
                  ≈DKK
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <td>{group.model ?? 'Unknown'}</td>
                  <td>{group.reasoningEffort ?? '—'}</td>
                  <UsageCells totals={group} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total
                </th>
                <UsageCells totals={total} />
              </tr>
            </tfoot>
          </table>
          <small>{PROMPT_COST_BASIS}</small>
        </div>
      ) : null}
    </span>
  )
}
