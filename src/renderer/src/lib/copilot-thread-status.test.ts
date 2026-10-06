import { describe, expect, it } from 'vitest'
import type { CopilotSessionSnapshot } from '../../../shared/app-types'
import {
  dismissCopilotThreadDone,
  isDoneDismissKey,
  mergeCopilotThreadSessionState,
  toCopilotThreadSessionState
} from './copilot-thread-status'

function snapshot(
  phase: CopilotSessionSnapshot['phase'],
  pendingInteraction: CopilotSessionSnapshot['pendingInteraction'] = null
): CopilotSessionSnapshot {
  return {
    threadId: 'thread-1',
    sessionId: 'session-1',
    title: null,
    phase,
    model: null,
    reasoningEffort: null,
    nextModelSelection: null,
    agentMode: 'interactive',
    models: [],
    timeline: [],
    pendingInteraction,
    mcpServersNeedingAuth: [],
    mcpServersSigningIn: [],
    queuedMessages: [],
    steeringMessages: [],
    error: phase === 'error' ? 'Failed' : null
  }
}

describe('Copilot thread status', () => {
  it('maps runtime phases and pending input', () => {
    expect(toCopilotThreadSessionState(snapshot('idle')).copilotStatus).toBe('idle')
    expect(toCopilotThreadSessionState(snapshot('running')).copilotStatus).toBe('working')
    expect(toCopilotThreadSessionState(snapshot('connecting')).copilotStatus).toBe('connecting')
    expect(toCopilotThreadSessionState(snapshot('error')).copilotStatus).toBe('error')
    expect(toCopilotThreadSessionState(snapshot('disconnected')).copilotStatus).toBe('disconnected')
    expect(
      toCopilotThreadSessionState(
        snapshot('running', {
          id: 'input-1',
          kind: 'user-input',
          title: 'Question',
          description: 'Choose',
          choices: [],
          allowFreeform: true
        })
      ).copilotStatus
    ).toBe('input')
  })

  it('keeps completion done until dismissed', () => {
    const working = toCopilotThreadSessionState(snapshot('running'))
    const idle = toCopilotThreadSessionState(snapshot('idle'))
    const done = mergeCopilotThreadSessionState(working, idle)

    expect(done.copilotStatus).toBe('done')
    expect(mergeCopilotThreadSessionState(done, idle).copilotStatus).toBe('done')

    const dismissed = dismissCopilotThreadDone(done)
    expect(dismissed.copilotStatus).toBe('idle')
    expect(mergeCopilotThreadSessionState(dismissed, idle).copilotStatus).toBe('idle')
    expect(dismissCopilotThreadDone(working)).toBe(working)
  })

  it('clears done when a new turn starts', () => {
    const done = mergeCopilotThreadSessionState(
      toCopilotThreadSessionState(snapshot('running')),
      toCopilotThreadSessionState(snapshot('idle'))
    )
    const working = toCopilotThreadSessionState(snapshot('running'))
    expect(mergeCopilotThreadSessionState(done, working).copilotStatus).toBe('working')
  })

  it('ignores modifier-only keys as dismiss interactions', () => {
    expect(isDoneDismissKey('Alt')).toBe(false)
    expect(isDoneDismissKey('Control')).toBe(false)
    expect(isDoneDismissKey('Enter')).toBe(true)
    expect(isDoneDismissKey('a')).toBe(true)
  })
})
