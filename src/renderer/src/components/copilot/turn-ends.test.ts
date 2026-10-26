import { describe, expect, it } from 'vitest'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import { findTurnEnds } from './turn-ends'

const item = (
  id: string,
  type: 'user' | 'assistant' | 'reasoning',
  content = id,
  steered?: boolean
): CopilotTimelineItem => ({ id, type, content, timestamp: '', steered })

const items = [
  item('user:1', 'user'),
  item('assistant:1', 'assistant'),
  item('assistant:2', 'assistant'),
  item('assistant:empty', 'assistant', ' '),
  item('user:2', 'user'),
  item('assistant:3', 'assistant'),
  item('user:steer', 'user', 'steer', true),
  item('assistant:4', 'assistant'),
  item('reasoning:1', 'reasoning')
]

describe('findTurnEnds', () => {
  it("marks each turn's last message, without resetting to the latest", () => {
    expect([...findTurnEnds(items, false)]).toEqual([
      ['assistant:4', { reset: false, fork: true }],
      ['assistant:2', { reset: true, fork: true }]
    ])
  })

  it("doesn't fork the latest turn while it runs", () => {
    expect(findTurnEnds(items, true).get('assistant:4')).toEqual({ reset: false, fork: false })
    expect(findTurnEnds(items, true).get('assistant:2')).toEqual({ reset: true, fork: true })
  })
})
