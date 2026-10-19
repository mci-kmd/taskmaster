import type { RepositoryWorktreeStatus } from './app-types'

/** Why a worktree can't be cleaned up, or null when it can. */
export function getWorktreeCleanupBlocker(worktree: RepositoryWorktreeStatus): string | null {
  if (worktree.isMain) {
    return "The project's main checkout can't be cleaned up."
  }
  if (worktree.threadTitles.length > 0) {
    return `In use by ${worktree.threadTitles.map((title) => `"${title}"`).join(', ')}.`
  }
  if (worktree.locked) {
    return 'The worktree is locked.'
  }
  if (worktree.hasRemoteBranch) {
    return 'The branch exists on the remote.'
  }
  if (!worktree.missing && worktree.hasLocalChanges !== false) {
    return worktree.hasLocalChanges === null
      ? "Couldn't check for uncommitted changes."
      : 'The worktree has uncommitted changes.'
  }
  return null
}
