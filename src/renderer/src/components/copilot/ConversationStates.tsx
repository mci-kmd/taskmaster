import Button from '../ui/Button'
import { SparkIcon } from '../Icons'

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

/** The live row at the end of the transcript while Copilot works. */
export function WorkingIndicator({
  waiting,
  ...motion
}: {
  /** Copilot is blocked on a request in the composer. */
  waiting: boolean
} & MotionProps): React.JSX.Element {
  return (
    <div className="tm-session-working" data-waiting={waiting || undefined} {...motion}>
      <SparkIcon className="tm-session-working-spark" aria-hidden="true" />
      <span key={String(waiting)} className="tm-fade-in">
        {waiting ? 'Waiting for your response' : 'Copilot is working…'}
      </span>
    </div>
  )
}
