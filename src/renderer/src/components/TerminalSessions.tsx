import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import type { AppSettingsSnapshot, TerminalStatus, ThreadSnapshot } from '../../../shared/app-types'
import ThreadTerminal, {
  type ThreadSessionState,
  type ThreadTerminalHandle
} from './ThreadTerminal'

export type { SessionPhase, ThreadSessionState } from './ThreadTerminal'

export type SessionMap = Map<string, ThreadSessionState>

export type TerminalSessionsHandle = {
  start: (threadId: string) => void
  stop: (threadId: string) => Promise<void>
}

type TerminalSessionsProps = {
  threads: ThreadSnapshot[]
  selectedThreadId: string | null
  settings: AppSettingsSnapshot
  copilotStatus: TerminalStatus | null
  onSessionsChange: (sessions: SessionMap) => void
  onRefresh: () => Promise<void>
}

type LiveEntry = {
  thread: ThreadSnapshot
  launchKey: number
}

const TerminalSessions = forwardRef<TerminalSessionsHandle, TerminalSessionsProps>(
  function TerminalSessions(
    { threads, selectedThreadId, settings, copilotStatus, onSessionsChange, onRefresh },
    ref
  ) {
    const [launchKeys, setLaunchKeys] = useState<Map<string, number>>(new Map())
    const [sessionStates, setSessionStates] = useState<SessionMap>(new Map())
    const handlesRef = useRef<Map<string, ThreadTerminalHandle>>(new Map())

    // Live = threads that have been launched at least once.
    // Idle, never-launched threads wait to mount until launch is requested.
    const liveEntries = useMemo<LiveEntry[]>(() => {
      const seen = new Set<string>()
      const result: LiveEntry[] = []

      const pushIfThread = (id: string, launchKey: number): void => {
        if (seen.has(id)) return
        const thread = threads.find((t) => t.id === id)
        if (!thread) return
        seen.add(id)
        result.push({ thread, launchKey })
      }

      for (const [id, key] of launchKeys) {
        pushIfThread(id, key)
      }

      return result
    }, [threads, launchKeys])

    useEffect(() => {
      onSessionsChange(sessionStates)
    }, [sessionStates, onSessionsChange])

    const handleStateChange = useCallback((threadId: string, state: ThreadSessionState): void => {
      setSessionStates((current) => {
        const previous = current.get(threadId)
        if (
          previous &&
          previous.phase === state.phase &&
          previous.exitCode === state.exitCode &&
          previous.errorMessage === state.errorMessage &&
          previous.runtimeTitle === state.runtimeTitle &&
          previous.lastUserMessage === state.lastUserMessage
        ) {
          return current
        }
        const next = new Map(current)
        next.set(threadId, state)
        return next
      })
    }, [])

    const start = useCallback((threadId: string): void => {
      setLaunchKeys((current) => {
        const next = new Map(current)
        next.set(threadId, (next.get(threadId) ?? 0) + 1)
        return next
      })
    }, [])

    const stop = useCallback(async (threadId: string): Promise<void> => {
      const handle = handlesRef.current.get(threadId)
      if (!handle) return
      await handle.stop()
    }, [])

    useImperativeHandle(ref, () => ({ start, stop }), [start, stop])

    const setHandle = useCallback((threadId: string, handle: ThreadTerminalHandle | null): void => {
      if (handle) {
        handlesRef.current.set(threadId, handle)
      } else {
        handlesRef.current.delete(threadId)
      }
    }, [])

    return (
      <div className="absolute inset-0">
        {liveEntries.map((entry) => (
          <ThreadTerminal
            copilotStatus={copilotStatus}
            key={entry.thread.id}
            launchKey={entry.launchKey}
            onRefresh={onRefresh}
            onStateChange={(state) => handleStateChange(entry.thread.id, state)}
            ref={(handle) => setHandle(entry.thread.id, handle)}
            settings={settings}
            thread={entry.thread}
            visible={selectedThreadId === entry.thread.id}
          />
        ))}
      </div>
    )
  }
)

export default TerminalSessions
