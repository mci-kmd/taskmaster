import { describe, expect, it } from 'vitest'
import {
  consumeTrackedUserInput,
  isMissingResumeSessionError,
  normalizeTrackedUserMessage,
  type UserInputTrackingState
} from './terminal-input'

const cleanState = (): UserInputTrackingState => ({ draft: '', dirty: false })

describe('terminal input tracking', () => {
  it('normalizes tracked user messages', () => {
    expect(normalizeTrackedUserMessage('  hello\r\nworld  ')).toBe('hello\nworld')
    expect(normalizeTrackedUserMessage(' \n ')).toBeNull()
  })

  it('tracks submitted plain input', () => {
    expect(consumeTrackedUserInput(cleanState(), 'hello world\r')).toEqual({
      state: { draft: '', dirty: false },
      submittedMessage: 'hello world'
    })
  })

  it('handles character and word deletion before submit', () => {
    let result = consumeTrackedUserInput(cleanState(), 'hello world')
    result = consumeTrackedUserInput(result.state, '\x17there\b!\n')
    expect(result).toEqual({
      state: { draft: '', dirty: false },
      submittedMessage: 'hello ther!'
    })
  })

  it('marks escape/control input dirty until next submit reset', () => {
    const dirtyResult = consumeTrackedUserInput(cleanState(), 'hello\x1b[D\r')
    expect(dirtyResult).toEqual({
      state: { draft: '', dirty: false },
      submittedMessage: null
    })

    expect(consumeTrackedUserInput(dirtyResult.state, 'fresh\n').submittedMessage).toBe('fresh')
  })

  it('detects missing resume session errors from supported CLIs', () => {
    expect(isMissingResumeSessionError('No session, task, or name matched abc')).toBe(true)
    expect(isMissingResumeSessionError('No conversation/session found')).toBe(true)
    expect(isMissingResumeSessionError('session abc not found')).toBe(true)
    expect(isMissingResumeSessionError('No sessions found')).toBe(true)
    expect(isMissingResumeSessionError('permission denied')).toBe(false)
  })
})
