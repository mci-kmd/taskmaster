import type { PersistedThread } from '../../../shared/app-types'

type DriftThread = Pick<PersistedThread, 'id' | 'mode' | 'branchName' | 'pendingSetup'>

/** Whether the thread works on the primary branch in the project's own checkout. */
export function isOnPrimaryBranch(thread: DriftThread, primaryBranch: string | null): boolean {
  return (
    Boolean(primaryBranch) &&
    thread.mode !== 'worktree' &&
    !thread.pendingSetup &&
    thread.branchName === primaryBranch
  )
}

/**
 * The branch the project's checkout moved to while the thread is recorded on the primary branch,
 * e.g. after the agent ran `git switch -c`. Null when the thread isn't on the primary branch, the
 * checkout is still there or detached, or another thread is recorded on that branch (then the
 * checkout was switched for that thread).
 */
export function findCheckoutDrift(input: {
  thread: DriftThread
  /** The project's threads, including this one. */
  threads: Pick<PersistedThread, 'id' | 'branchName'>[]
  primaryBranch: string | null
  /** The branch the project's checkout is on, or null when detached or unknown. */
  liveBranch: string | null
}): string | null {
  const { thread, liveBranch } = input
  if (!liveBranch || !isOnPrimaryBranch(thread, input.primaryBranch)) return null
  if (liveBranch === input.primaryBranch) return null
  const claimed = input.threads.some(
    (other) => other.id !== thread.id && other.branchName === liveBranch
  )
  return claimed ? null : liveBranch
}
