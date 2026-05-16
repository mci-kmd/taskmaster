import Button from './ui/Button'
import { LogoMark, PlusIcon } from './Icons'

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
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.04), transparent 55%)'
        }}
      />

      <div className="tm-fade-in relative flex flex-col items-center text-center">
        <div className="mb-6 grid size-12 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)]">
          <LogoMark width={22} height={22} />
        </div>

        <h2 className="text-[22px] font-medium tracking-tight text-[var(--color-fg)]">
          Let&apos;s build.
        </h2>
        <p className="mt-2 max-w-sm text-[13.5px] leading-6 text-[var(--color-fg-muted)]">
          {hasRepositories
            ? hasRepository
              ? 'Pick a thread on the left, or spin up a new one to launch the agent.'
              : 'Select a repository in the sidebar to view its threads.'
            : 'Add a git repository to start orchestrating agent threads.'}
        </p>

        <div className="mt-6 flex items-center gap-2">
          {hasRepositories ? (
            <Button
              disabled={!hasRepository}
              onClick={onNewThread}
              size="md"
              title={hasRepository ? 'Create a new thread (Ctrl+N)' : 'Select a repository first'}
              variant="primary"
            >
              <PlusIcon width={12} height={12} strokeWidth={1.8} />
              New thread
            </Button>
          ) : (
            <Button
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

        <div className="mt-10 flex items-center gap-3 text-[11.5px] uppercase tracking-[0.16em] text-[var(--color-fg-faint)]">
          <span className="h-px w-8 bg-[var(--color-border)]" />
          <span>Embedded agent CLI</span>
          <span className="h-px w-8 bg-[var(--color-border)]" />
        </div>
      </div>
    </div>
  )
}
