import type { SessionEvent } from '@github/copilot-sdk'
import { describe, expect, it } from 'vitest'
import {
  describeHistory,
  eventsBefore,
  findTurnEndBoundary,
  latestTurnStart
} from './session-branching'

const user = (id: string, content: string, data: Record<string, unknown> = {}): SessionEvent =>
  ({ id, type: 'user.message', data: { content, ...data } }) as unknown as SessionEvent
const assistant = (id: string, messageId: string, agentId?: string): SessionEvent =>
  ({
    id,
    type: 'assistant.message',
    agentId,
    data: { messageId, content: messageId }
  }) as unknown as SessionEvent
const idle = (id: string): SessionEvent =>
  ({ id, type: 'session.idle', data: {} }) as unknown as SessionEvent

const events = [
  user('e1', 'first'),
  assistant('e2', 'a1'),
  assistant('e3', 'a2'),
  idle('e4'),
  user('e5', 'steer', { delivery: 'steering' }),
  user('e6', 'auto', { isAutopilotContinuation: true }),
  assistant('e7', 'sub', 'agent-1'),
  user('e8', 'second'),
  assistant('e9', 'a3'),
  idle('e10')
]

describe('session branching', () => {
  it('cuts at the start of the next turn, skipping steering and autopilot input', () => {
    expect(findTurnEndBoundary(events, 'assistant:a1')).toEqual({ eventId: 'e8' })
    expect(findTurnEndBoundary(events, 'user:e1')).toEqual({ eventId: 'e8' })
    expect(findTurnEndBoundary(events, 'assistant:a3')).toEqual({ eventId: null })
  })

  it("doesn't find messages that are gone or belong to sub-agents", () => {
    expect(findTurnEndBoundary(events, 'assistant:missing')).toBeUndefined()
    expect(findTurnEndBoundary(events, 'assistant:sub')).toBeUndefined()
  })

  it('finds the latest turn start', () => {
    expect(latestTurnStart(events)).toBe('e8')
    expect(latestTurnStart([idle('x')])).toBeNull()
  })

  it('describes what remains before a boundary', () => {
    expect(describeHistory(eventsBefore(events, 'e8'))).toEqual({
      lastUserMessage: 'steer',
      messageIds: ['assistant:a1', 'assistant:a2']
    })
    expect(describeHistory(eventsBefore(events, null))).toEqual({
      lastUserMessage: 'second',
      messageIds: ['assistant:a1', 'assistant:a2', 'assistant:a3']
    })
  })
})
