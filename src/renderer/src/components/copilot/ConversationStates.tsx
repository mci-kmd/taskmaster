import { useEffect, useState } from 'react'
import type { CopilotRunningSubagent } from '../../../../shared/app-types'
import Button from '../ui/Button'
import { AgentIcon, SparkIcon } from '../Icons'
import { useLastValue } from '../../lib/motion'
import { formatElapsed } from './prompt-cost'

const SUGGESTIONS = ['Explain this project', 'Find and fix a bug', 'Plan a change']

type MotionProps = { 'data-motion'?: string; 'data-state'?: string }

/** Shown in place of the transcript until the first message. */
export function EmptyConversation({
  onSuggest,
  ...motion
}: { onSuggest: (prompt: string) => void } & MotionProps): React.JSX.Element {
  return (
    <div className="tm-session-empty" {...motion}>
      <SparkIcon className="tm-session-empty-icon" aria-hidden="true" />
      <h2>What would you like to work on?</h2>
      <p>Ask a question, plan a change, or build something together.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            size="sm"
            variant="secondary"
            onClick={() => onSuggest(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  )
}

function useElapsed(since: string | null | undefined): number | null {
  const start = since ? Date.parse(since) : NaN
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!Number.isFinite(start)) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [start])
  return Number.isFinite(start) ? Math.max(0, now - start) : null
}

/** The live row at the end of the transcript while Copilot works. */
export function WorkingIndicator({
  waiting,
  since,
  ...motion
}: {
  /** Copilot is blocked on a request in the composer. */
  waiting: boolean
  /** When Copilot started working on the current prompt. */
  since?: string | null
} & MotionProps): React.JSX.Element {
  const elapsed = useElapsed(since)
  return (
    <div className="tm-session-working" data-waiting={waiting || undefined} {...motion}>
      <SparkIcon className="tm-session-working-spark" aria-hidden="true" />
      <span key={String(waiting)} className="tm-fade-in">
        {waiting ? 'Waiting for your response' : 'Copilot is working…'}
      </span>
      {elapsed !== null && !waiting ? (
        <span className="tm-session-working-time" title="Time spent on this prompt">
          {formatElapsed(elapsed)}
        </span>
      ) : null}
    </div>
  )
}

/** Sub-agents running now, below the working row. Background ones may outlive the turn. */
export function RunningSubagents({
  agents,
  ...motion
}: { agents: CopilotRunningSubagent[] } & MotionProps): React.JSX.Element {
  // Keeps the last agents on screen while the list animates out.
  const shown = useLastValue(agents.length > 0 ? agents : null) ?? []
  return (
    <ul className="tm-session-running-agents" aria-label="Running sub-agents" {...motion}>
      {shown.map((agent) => (
        <RunningSubagent key={agent.id} agent={agent} />
      ))}
    </ul>
  )
}

function RunningSubagent({ agent }: { agent: CopilotRunningSubagent }): React.JSX.Element {
  const elapsed = useElapsed(agent.startedAt)
  return (
    <li className="tm-session-running-agent tm-fade-in">
      <AgentIcon className="tm-session-running-agent-icon" aria-hidden="true" />
      <span className="tm-session-running-agent-name">{agent.name}</span>
      {agent.description ? (
        <span className="tm-session-running-agent-description" title={agent.description}>
          {agent.description}
        </span>
      ) : null}
      <span className="tm-session-running-agent-meta">
        {[agent.model, elapsed === null ? null : formatElapsed(elapsed)]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </li>
  )
}
