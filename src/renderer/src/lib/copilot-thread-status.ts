import type { CopilotSessionSnapshot } from '../../../shared/app-types'
import type { CopilotThreadStatus, ThreadSessionState } from '../components/ThreadTerminal'

function getCopilotStatus(snapshot: CopilotSessionSnapshot): CopilotThreadStatus {
  if (snapshot.pendingInteraction) return 'input'

  switch (snapshot.phase) {
    case 'connecting':
      return 'connecting'
    case 'running':
      return 'working'
    case 'error':
      return 'error'
    case 'disconnected':
      return 'disconnected'
    default:
      // The agent's turn is over, but what it left running in the background isn't.
      if (snapshot.runningSubagents?.length) return 'working'
      if (snapshot.backgroundShells) return 'watching'
      return 'idle'
  }
}

export function toCopilotThreadSessionState(snapshot: CopilotSessionSnapshot): ThreadSessionState {
  const lastUserMessage = [...snapshot.timeline].reverse().find((item) => item.type === 'user')
  return {
    phase:
      snapshot.phase === 'connecting'
        ? 'launching'
        : snapshot.phase === 'idle' || snapshot.phase === 'running'
          ? 'running'
          : snapshot.phase === 'error'
            ? 'error'
            : 'stopped',
    exitCode: null,
    errorMessage: snapshot.error,
    runtimeTitle: snapshot.title,
    lastUserMessage: lastUserMessage?.type === 'user' ? lastUserMessage.content : null,
    copilotStatus: getCopilotStatus(snapshot),
    copilotPhase: snapshot.phase
  }
}

// 'done' sticks (even for the open thread) until explicitly dismissed or a new turn starts. A turn
// is also done once the background work it left running (sub-agents, watched shells) finishes.
export function mergeCopilotThreadSessionState(
  previous: ThreadSessionState | undefined,
  next: ThreadSessionState
): ThreadSessionState {
  if (next.copilotStatus !== 'idle') return next

  const completed =
    previous?.copilotPhase === 'running' ||
    (previous?.copilotPhase === 'idle' &&
      (previous.copilotStatus === 'done' ||
        previous.copilotStatus === 'working' ||
        previous.copilotStatus === 'watching'))

  return completed ? { ...next, copilotStatus: 'done' } : next
}

export function dismissCopilotThreadDone(state: ThreadSessionState): ThreadSessionState {
  return state.copilotStatus === 'done' ? { ...state, copilotStatus: 'idle' } : state
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph'])

export function isDoneDismissKey(key: string): boolean {
  return !MODIFIER_KEYS.has(key)
}
