import type {
  BranchStatusRequest,
  BranchStatusSnapshot,
  RepositoryBackend
} from '../../../shared/app-types'
import { tryGitAsync } from '../../backends/git-client'
import { parseBranchStatus } from './parse-branch-status'

const BRANCH_STATUS_CACHE_TTL_MS = 1_500

export function createBranchStatusService(dependencies: {
  resolveBranchStatusContext: (
    input: BranchStatusRequest
  ) => { cwd: string; backend: RepositoryBackend } | null
}): {
  getBranchStatus: (input: BranchStatusRequest) => Promise<BranchStatusSnapshot | null>
} {
  const branchStatusCache = new Map<
    string,
    { expiresAt: number; value: BranchStatusSnapshot | null }
  >()
  const branchStatusInflight = new Map<string, Promise<BranchStatusSnapshot | null>>()

  return {
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
