import type {
  BranchStatusRequest,
  BranchStatusSnapshot,
  RepositoryBackend
} from '../../../shared/app-types'
import { tryGitAsync } from '../../backends/git-client'
import { parseBranchStatus } from './parse-branch-status'

const BRANCH_STATUS_CACHE_TTL_MS = 1_500

/** A branch without an upstream reports no ahead count; its commits still need pushing. */
function needsUnpushedCount(statusOutput: string): boolean {
  const lines = statusOutput.split(/\r?\n/)
  return (
    !lines.some((line) => line.startsWith('# branch.upstream ')) &&
    lines.some(
      (line) => line.startsWith('# branch.head ') && line !== '# branch.head (detached)'
    ) &&
    !lines.includes('# branch.oid (initial)')
  )
}

async function countUnpushedCommits(cwd: string, backend: RepositoryBackend): Promise<number> {
  const remotes = await tryGitAsync(cwd, ['remote'], backend)
  if (!remotes.ok || !remotes.stdout.trim()) return 0
  const count = await tryGitAsync(
    cwd,
    ['rev-list', '--count', 'HEAD', '--not', '--remotes'],
    backend
  )
  const value = count.ok ? Number(count.stdout.trim()) : 0
  return Number.isFinite(value) ? value : 0
}

export function createBranchStatusService(dependencies: {
  resolveBranchStatusContext: (
    input: BranchStatusRequest
  ) => { cwd: string; backend: RepositoryBackend } | null
}): {
  getBranchStatus: (input: BranchStatusRequest) => Promise<BranchStatusSnapshot | null>
  invalidate: (cwd: string) => void
} {
  const branchStatusCache = new Map<
    string,
    { expiresAt: number; value: BranchStatusSnapshot | null }
  >()
  const branchStatusInflight = new Map<string, Promise<BranchStatusSnapshot | null>>()

  return {
    invalidate: (cwd: string): void => {
      const suffix = `:${cwd.toLowerCase()}`
      for (const key of branchStatusCache.keys()) {
        if (key.endsWith(suffix)) branchStatusCache.delete(key)
      }
    },
    getBranchStatus: async (input: BranchStatusRequest): Promise<BranchStatusSnapshot | null> => {
      const context = dependencies.resolveBranchStatusContext(input)
      if (!context) {
        return null
      }

      const cacheKey = `${context.backend.kind}:${context.cwd.toLowerCase()}`
      const cached = branchStatusCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value
      }

      const inflight = branchStatusInflight.get(cacheKey)
      if (inflight) {
        return inflight
      }

      const request = (async (): Promise<BranchStatusSnapshot | null> => {
        const result = await tryGitAsync(
          context.cwd,
          ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
          context.backend
        )
        const value = result.ok ? parseBranchStatus(result.stdout) : null
        if (value && result.ok && needsUnpushedCount(result.stdout)) {
          value.ahead = await countUnpushedCommits(context.cwd, context.backend)
        }

        branchStatusCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + BRANCH_STATUS_CACHE_TTL_MS
        })
        branchStatusInflight.delete(cacheKey)
        return value
      })()

      branchStatusInflight.set(cacheKey, request)
      return request
    }
  }
}
