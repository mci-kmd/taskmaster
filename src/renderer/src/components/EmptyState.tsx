import Button from './ui/Button'
import { LogoMark, PlusIcon, PencilIcon } from './Icons'

type EmptyStateProps = {
  hasRepository: boolean
  hasRepositories: boolean
  onAddRepository: () => void
  onNewThread: () => void
}

export default function EmptyState({
  hasRepository,
  hasRepositories,
  onAddRepository,
  onNewThread
}: EmptyStateProps): React.JSX.Element {
  const message = hasRepositories
    ? hasRepository
      ? 'Pick a thread on the left, or spin up a new one to launch the agent.'
      : 'Select a repository in the sidebar to view its threads.'
    : 'Add a git repository to start orchestrating agent threads.'
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden">
      <div aria-hidden className="tm-empty-state-glow tm-fade-in" />

      <div className="tm-rise-in relative flex flex-col items-center text-center">
        <div className="tm-empty-state-mark tm-pop-in mb-6">
          <LogoMark width={22} height={22} />
        </div>

        <h2 className="text-[22px] font-medium tracking-tight text-fg">Let&apos;s build.</h2>
        <p key={message} className="tm-fade-in mt-2 max-w-sm text-[13.5px] leading-6 text-fg-muted">
          {message}
        </p>

        <div className="mt-6 flex items-center gap-2">
          {hasRepositories ? (
            <Button
              key="new-thread"
              className="tm-fade-in"
              disabled={!hasRepository}
              onClick={onNewThread}
              size="md"
              title={hasRepository ? 'Create a new thread (Ctrl+N)' : 'Select a repository first'}
              variant="primary"
            >
              <PencilIcon width={12} height={12} strokeWidth={1.8} />
              New thread
            </Button>
          ) : (
            <Button
              key="add-repository"
              className="tm-fade-in"
              onClick={onAddRepository}
              size="md"
              title="Add a git repository to begin"
              variant="primary"
            >
              <PlusIcon width={12} height={12} strokeWidth={1.8} />
              Add repository
            </Button>
          )}
        </div>

        <div className="mt-10 flex items-center gap-3 text-[11.5px] tracking-[0.16em] text-fg-subtle uppercase">
          <span className="h-px w-8 bg-border-strong" />
          <span>Copilot conversations</span>
          <span className="h-px w-8 bg-border-strong" />
        </div>
      </div>
    </div>
  )
}
