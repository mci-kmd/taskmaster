import { describe, expect, it } from 'vitest'
import type { CopilotSessionSnapshot } from '../../../shared/app-types'
import {
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

  it('marks background completion done until the thread is selected', () => {
    const working = toCopilotThreadSessionState(snapshot('running'))
    const idle = toCopilotThreadSessionState(snapshot('idle'))
    const done = mergeCopilotThreadSessionState(working, idle, false)

    expect(done.copilotStatus).toBe('done')
    expect(mergeCopilotThreadSessionState(done, idle, false).copilotStatus).toBe('done')
    expect(mergeCopilotThreadSessionState(done, idle, true).copilotStatus).toBe('idle')
  })
})
