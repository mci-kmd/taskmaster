import { describe, expect, it } from 'vitest'
import type { CopilotSessionSnapshot, CopilotTimelineItem } from '../../../shared/app-types'
import { reconcileSessionSnapshot } from './session-snapshot'

function snapshot(
  timeline: CopilotTimelineItem[],
  patch: Partial<CopilotSessionSnapshot> = {}
): CopilotSessionSnapshot {
  return {
    threadId: 'thread-1',
    sessionId: 'session-1',
    title: null,
    phase: 'idle',
    model: null,
    reasoningEffort: null,
    nextModelSelection: null,
    agentMode: 'interactive',
    models: [],
    timeline,
    pendingInteraction: null,
    mcpServersNeedingAuth: [],
    mcpServersSigningIn: [],
    queuedMessages: [],
    steeringMessages: [],
    error: null,
    ...patch
  }
}

const message = (id: string, content: string): CopilotTimelineItem => ({
  id,
  type: 'assistant',
  content,
  timestamp: '2026-01-01T00:00:00.000Z'
})

// IPC hands over fresh copies; structuredClone stands in for that.
const copy = <T>(value: T): T => structuredClone(value)

describe('reconcileSessionSnapshot', () => {
  it('keeps unchanged items and replaces changed ones', () => {
    const previous = snapshot([message('a', 'Hello'), message('b', 'Work')])
    const next = reconcileSessionSnapshot(
      previous,
      copy(snapshot([message('a', 'Hello'), message('b', 'Working on it')]))
    )

    expect(next.timeline[0]).toBe(previous.timeline[0])
    expect(next.timeline[1]).not.toBe(previous.timeline[1])
    expect(next.timeline[1]).toMatchObject({ content: 'Working on it' })
  })

  it('keeps the whole timeline when nothing in it changed', () => {
    const previous = snapshot([message('a', 'Hello')])
    const next = reconcileSessionSnapshot(previous, copy({ ...previous, phase: 'running' }))

    expect(next.timeline).toBe(previous.timeline)
    expect(next.phase).toBe('running')
  })

  it('keeps the conversation on screen while the same session reconnects', () => {
    const previous = snapshot([message('a', 'Hello')])
    const connecting = reconcileSessionSnapshot(previous, snapshot([], { phase: 'connecting' }))
    expect(connecting.timeline).toBe(previous.timeline)

    const reloaded = reconcileSessionSnapshot(connecting, copy(previous))
    expect(reloaded.timeline).toBe(previous.timeline)
  })

  it('shows another session or thread as it is', () => {
    const previous = snapshot([message('a', 'Hello')])
    expect(
      reconcileSessionSnapshot(previous, snapshot([], { phase: 'connecting', sessionId: 'new' }))
        .timeline
    ).toEqual([])
    expect(
      reconcileSessionSnapshot(previous, snapshot([], { threadId: 'thread-2' })).timeline
    ).toEqual([])
  })
})
