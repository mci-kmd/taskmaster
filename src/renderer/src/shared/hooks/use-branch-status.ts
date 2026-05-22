import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BranchStatusRequest,
  BranchStatusSnapshot,
  RepositorySnapshot,
  ThreadSnapshot
} from '../../../../shared/app-types'
import type { ThreadSessionState } from '../../components/TerminalSessions'
import { getRendererApi } from '../api/client'

const api = getRendererApi()
const ACTIVE_BRANCH_STATUS_POLL_MS = 4_000
const IDLE_BRANCH_STATUS_POLL_MS = 15_000

function formatBranchStatusTokens(status: BranchStatusSnapshot): string[] {
  const tokens: string[] = []
  if (status.ahead > 0) tokens.push(`↑${status.ahead}`)
  if (status.behind > 0) tokens.push(`↓${status.behind}`)
  if (status.staged > 0) tokens.push(`+${status.staged}`)
  if (status.modified > 0) tokens.push(`~${status.modified}`)
  if (status.deleted > 0) tokens.push(`-${status.deleted}`)
  if (status.untracked > 0) tokens.push(`?${status.untracked}`)
  if (status.conflicted > 0) tokens.push(`!${status.conflicted}`)
  return tokens
}

function formatBranchStatusTitle(status: BranchStatusSnapshot): string {
  return [
    `${status.ahead} ahead`,
    `${status.behind} behind`,
    `${status.staged} staged`,
    `${status.modified} modified`,
    `${status.deleted} deleted`,
    `${status.untracked} untracked`,
    `${status.conflicted} conflicted`
  ].join(' · ')
}

export function useBranchStatus(params: {
  selectedRepository: RepositorySnapshot | null
  selectedThread: ThreadSnapshot | null
  selectedAgentSession: ThreadSessionState
  selectedTerminalSession: ThreadSessionState
}): {
  branchStatus: BranchStatusSnapshot | null
  branchStatusSummary: string | null
  branchStatusTitle: string | null
} {
  const [branchStatusState, setBranchStatusState] = useState<{
    key: string | null
    value: BranchStatusSnapshot | null
  }>({
    key: null,
    value: null
  })
  const branchStatusPollMsRef = useRef(IDLE_BRANCH_STATUS_POLL_MS)

  const branchStatusTarget = useMemo<BranchStatusRequest | null>(() => {
    if (params.selectedThread) {
      return { threadId: params.selectedThread.id }
    }
    if (params.selectedRepository) {
      return { repositoryId: params.selectedRepository.id }
    }
    return null
  }, [params.selectedRepository, params.selectedThread])

  const branchStatusTargetKey = params.selectedThread
    ? `thread:${params.selectedThread.id}`
    : params.selectedRepository
      ? `repository:${params.selectedRepository.id}`
      : null

  useEffect(() => {
    const hasActiveThreadSession =
      Boolean(params.selectedThread) &&
      [params.selectedAgentSession, params.selectedTerminalSession].some(
        (session) => session.phase === 'running' || session.phase === 'launching'
      )

    branchStatusPollMsRef.current = hasActiveThreadSession
      ? ACTIVE_BRANCH_STATUS_POLL_MS
      : IDLE_BRANCH_STATUS_POLL_MS
  }, [params.selectedAgentSession, params.selectedTerminalSession, params.selectedThread])

  useEffect(() => {
    if (!branchStatusTarget || !branchStatusTargetKey) {
      return
    }

    let cancelled = false
    let timeoutId: number | null = null

    const load = async (): Promise<void> => {
      const nextStatus = await api.appState.getBranchStatus(branchStatusTarget)
      if (cancelled) {
        return
      }

      setBranchStatusState({
        key: branchStatusTargetKey,
        value: nextStatus
      })
      timeoutId = window.setTimeout(() => {
        void load()
      }, branchStatusPollMsRef.current)
    }

    void load()

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    branchStatusTarget,
    branchStatusTargetKey,
    params.selectedAgentSession.phase,
    params.selectedTerminalSession.phase
  ])

  const branchStatus =
    branchStatusTargetKey && branchStatusState.key === branchStatusTargetKey
      ? branchStatusState.value
      : null

  const branchStatusSummary = useMemo(() => {
    if (!branchStatus) {
      return null
    }

    const tokens = formatBranchStatusTokens(branchStatus)
    return tokens.length > 0 ? tokens.join(' ') : 'clean'
  }, [branchStatus])

  const branchStatusTitle = useMemo(() => {
    if (!branchStatus) {
      return null
    }

    const tokens = formatBranchStatusTokens(branchStatus)
    return tokens.length > 0 ? formatBranchStatusTitle(branchStatus) : 'Working tree clean'
  }, [branchStatus])

  return {
    branchStatus,
    branchStatusSummary,
    branchStatusTitle
  }
}
