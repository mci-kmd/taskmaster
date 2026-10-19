import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CleanupRepositoryWorktreeInput,
  ListRepositoryWorktreesResult,
  MutationResult,
  RepositoryWorktreeStatus
} from '../../../../shared/app-types'
import { getWorktreeCleanupBlocker } from '../../../../shared/worktrees'
import { RefreshIcon } from '../Icons'
import Button from '../ui/Button'
import { SettingRow } from '../settings/SettingsLayout'

export type WorktreeOverviewProps = {
  repositoryId: string
  onListWorktrees: (repositoryId: string) => Promise<ListRepositoryWorktreesResult>
  onCleanupWorktree: (input: CleanupRepositoryWorktreeInput) => Promise<MutationResult>
}

type Chip = { label: string; tone?: 'danger' | 'accent' }

function worktreeChips(worktree: RepositoryWorktreeStatus): Chip[] {
  const chips: Chip[] = []
  if (worktree.isMain) chips.push({ label: 'Main checkout' })
  if (worktree.branchName) {
    chips.push({ label: worktree.hasLocalBranch ? 'Local branch' : 'No local branch' })
    chips.push(
      worktree.hasRemoteBranch ? { label: 'Remote branch', tone: 'accent' } : { label: 'No remote' }
    )
  }
  if (worktree.missing) {
    chips.push({ label: 'Missing', tone: 'danger' })
  } else if (worktree.hasLocalChanges === null) {
    chips.push({ label: 'Status unknown', tone: 'danger' })
  } else {
    chips.push(
      worktree.hasLocalChanges
        ? { label: 'Uncommitted changes', tone: 'danger' }
        : { label: 'No changes' }
    )
  }
  if (worktree.locked) chips.push({ label: 'Locked' })
  return chips
}

function worktreeName(worktree: RepositoryWorktreeStatus): string {
  return worktree.branchName ?? 'Detached HEAD'
}

/** Lists the project's git worktrees and cleans up those that are safe to remove. */
export default function WorktreeOverview({
  repositoryId,
  onListWorktrees,
  onCleanupWorktree
}: WorktreeOverviewProps): React.JSX.Element {
  const [worktrees, setWorktrees] = useState<RepositoryWorktreeStatus[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null)
  const [cleaningPath, setCleaningPath] = useState<string | null>(null)
  const [cleanupError, setCleanupError] = useState<{ path: string; message: string } | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const result = await onListWorktrees(repositoryId)
      if (id !== requestId.current) return
      if (result?.ok) {
        setWorktrees(result.worktrees)
        setListError(null)
      } else {
        setListError(result?.error ?? "Couldn't list the worktrees.")
      }
    } catch (error) {
      if (id !== requestId.current) return
      setListError(error instanceof Error ? error.message : String(error))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [onListWorktrees, repositoryId])

  useEffect(() => {
    void load()
  }, [load])

  async function cleanUp(worktree: RepositoryWorktreeStatus): Promise<void> {
    setConfirmingPath(null)
    setCleaningPath(worktree.path)
    setCleanupError(null)
    try {
      const result = await onCleanupWorktree({ repositoryId, path: worktree.path })
      if (!result.ok) {
        setCleanupError({
          path: worktree.path,
          message: result.error ?? "Couldn't clean up the worktree."
        })
      }
    } catch (error) {
      setCleanupError({
        path: worktree.path,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setCleaningPath(null)
    }
    await load()
  }

  return (
    <SettingRow
      hint="Clean up removes a worktree without a remote branch or uncommitted changes, and deletes its local branch."
      label="Current worktrees"
      stacked
    >
      <div className="mb-2 flex justify-end">
        <Button
          disabled={loading || cleaningPath !== null}
          onClick={() => {
            setCleanupError(null)
            void load()
          }}
          size="sm"
          title="Refresh the worktree list"
          variant="secondary"
        >
          <RefreshIcon aria-hidden height={13} width={13} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {listError ? (
        <p className="pb-2 text-[12px] leading-[18px] text-danger" role="alert">
          {listError}
        </p>
      ) : null}
      {worktrees === null ? (
        loading ? (
          <p className="text-[12.5px] text-fg-subtle">Loading worktrees…</p>
        ) : null
      ) : worktrees.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle">No worktrees.</p>
      ) : (
        <ul aria-busy={loading || undefined} aria-label="Worktrees" className="tm-worktree-list">
          {worktrees.map((worktree) => {
            const name = worktreeName(worktree)
            const blocker = getWorktreeCleanupBlocker(worktree)
            const confirming = confirmingPath === worktree.path
            const cleaning = cleaningPath === worktree.path
            const error = cleanupError?.path === worktree.path ? cleanupError.message : null
            return (
              <li aria-label={name} className="tm-worktree-row" key={worktree.path}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-fg" title={name}>
                      {name}
                    </p>
                    <p className="break-all font-mono text-[11.5px] leading-[18px] text-fg-subtle">
                      {worktree.path}
                    </p>
                    <ul aria-label="Status" className="mt-1.5 flex flex-wrap gap-1.5">
                      {worktreeChips(worktree).map((chip) => (
                        <li className="tm-label-chip" data-tone={chip.tone} key={chip.label}>
                          {chip.label}
                        </li>
                      ))}
                    </ul>
                    {worktree.threadTitles.length > 0 ? (
                      <p className="mt-1.5 text-[12px] leading-[18px] text-fg-muted">
                        Used by {worktree.threadTitles.join(', ')}
                      </p>
                    ) : null}
                  </div>
                  {confirming ? null : (
                    <Button
                      aria-label={`Clean up ${name}`}
                      className="shrink-0"
                      disabled={blocker !== null || cleaningPath !== null}
                      onClick={() => setConfirmingPath(worktree.path)}
                      size="sm"
                      title={blocker ?? 'Remove this worktree and its local branch'}
                      variant="secondary"
                    >
                      {cleaning ? 'Cleaning up…' : 'Clean up'}
                    </Button>
                  )}
                </div>
                {confirming ? (
                  <div className="tm-worktree-confirm" role="group" aria-label="Confirm clean up">
                    <p className="min-w-0 flex-1 text-[12px] leading-[18px] text-fg-muted">
                      {worktree.branchName && worktree.hasLocalBranch
                        ? `Removes the worktree and deletes the local branch ${worktree.branchName}, including commits that are on no other branch.`
                        : 'Removes the worktree.'}
                    </p>
                    <Button
                      autoFocus
                      onClick={() => setConfirmingPath(null)}
                      size="sm"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                    <Button onClick={() => void cleanUp(worktree)} size="sm" variant="danger">
                      Clean up
                    </Button>
                  </div>
                ) : null}
                {error ? (
                  <p className="mt-1.5 text-[12px] leading-[18px] text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </SettingRow>
  )
}
