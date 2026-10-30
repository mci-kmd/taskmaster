import type {
  PersistedRepository,
  PersistedSettings,
  ThreadSetup,
  ThreadSetupMode
} from './app-types'

export const DEFAULT_THREAD_SETUP_MODE: ThreadSetupMode = 'trunk'

export const THREAD_SETUP_MODES: Array<{
  value: ThreadSetupMode
  label: string
  description: string
}> = [
  { value: 'trunk', label: 'Trunk', description: 'Work on the primary branch' },
  {
    value: 'branch',
    label: 'Branch',
    description: 'Check out an existing branch or create a new one'
  },
  { value: 'worktree', label: 'Worktree', description: 'Reuse a worktree or create a new one' }
]

const MAX_BRANCH_NAME_CHARS = 200

export const isThreadSetupMode = (value: unknown): value is ThreadSetupMode =>
  value === 'trunk' || value === 'branch' || value === 'worktree'

/** The project's checkout mode for new threads, falling back to the app setting. */
export function resolveThreadSetupMode(
  settings: Pick<PersistedSettings, 'threadSetupMode'>,
  repository: Pick<PersistedRepository, 'threadSetupMode'> | null | undefined
): ThreadSetupMode {
  return repository?.threadSetupMode ?? settings.threadSetupMode ?? DEFAULT_THREAD_SETUP_MODE
}

/** A valid setup, or undefined. The trunk mode has no branch. */
export function normalizeThreadSetup(value: unknown): ThreadSetup | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { mode, branchName } = value as Record<string, unknown>
  if (!isThreadSetupMode(mode)) return undefined
  const name =
    mode !== 'trunk' && typeof branchName === 'string'
      ? branchName.trim().slice(0, MAX_BRANCH_NAME_CHARS)
      : ''
  return { mode, branchName: name || null }
}

export const sameThreadSetup = (left: ThreadSetup | undefined, right: unknown): boolean => {
  if (!left || !right || typeof right !== 'object') return left === right
  const other = right as Record<string, unknown>
  return (
    left.mode === other.mode &&
    left.branchName === other.branchName &&
    Object.keys(other).length === 2
  )
}
