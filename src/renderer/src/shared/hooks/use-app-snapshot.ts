import { useCallback, useEffect, useState } from 'react'
import { type AppSnapshot, type MutationResult } from '../../../../shared/app-types'
import { getRendererApi } from '../api/client'

const api = getRendererApi()

type UseAppSnapshotOptions = {
  onSnapshotLoaded?: (snapshot: AppSnapshot) => void
  onMutationResult?: (result: MutationResult) => void
}

export function useAppSnapshot(options: UseAppSnapshotOptions = {}): {
  snapshot: AppSnapshot | null
  setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot | null>>
  refreshSnapshot: () => Promise<void>
  applyMutation: (action: Promise<MutationResult>) => Promise<MutationResult>
} {
  const { onMutationResult, onSnapshotLoaded } = options
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)

  useEffect(() => {
    let isMounted = true

    void api.appState.getSnapshot().then((nextSnapshot) => {
      if (!isMounted) {
        return
      }

      setSnapshot(nextSnapshot)
      onSnapshotLoaded?.(nextSnapshot)

      void api.appState.refresh().then((refreshedSnapshot) => {
        if (!isMounted) {
          return
        }

        setSnapshot(refreshedSnapshot)
      })
    })

    return () => {
      isMounted = false
    }
  }, [onSnapshotLoaded])

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const nextSnapshot = await api.appState.refresh()
    setSnapshot(nextSnapshot)
  }, [])

  useEffect(() => {
    return api.appState.onThreadRunState(() => {
      void refreshSnapshot()
    })
  }, [refreshSnapshot])

  const applyMutation = useCallback(
    async (action: Promise<MutationResult>): Promise<MutationResult> => {
      const result = await action

      if (result.snapshot) {
        setSnapshot(result.snapshot)
      }

      onMutationResult?.(result)
      return result
    },
    [onMutationResult]
  )

  return {
    snapshot,
    setSnapshot,
    refreshSnapshot,
    applyMutation
  }
}
